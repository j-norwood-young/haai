import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq, and, lt, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import {
  users,
  webauthnCredentials,
  webauthnChallenges,
} from "@haai/core";
import type { AppContext } from "../../context.js";
import { getLogger } from "../../logger.js";
import { requireAuth, serializeUser } from "../../auth-session.js";
import { createSession } from "../../session.js";
import { getWebAuthnConfig, toWebAuthnUserId } from "../../webauthn-config.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_ALGORITHM_IDS = [-7, -257] as const;

async function purgeExpiredChallenges(ctx: AppContext): Promise<void> {
  await ctx.db.db
    .delete(webauthnChallenges)
    .where(lt(webauthnChallenges.expiresAt, Date.now()))
    .run();
}

async function saveChallenge(
  ctx: AppContext,
  challenge: string,
  type: "registration" | "authentication",
  userId: string | null,
): Promise<string> {
  await purgeExpiredChallenges(ctx);
  const id = `wch-${nanoid(12)}`;
  const now = Date.now();
  await ctx.db.db
    .insert(webauthnChallenges)
    .values({
      id,
      challenge,
      userId,
      type,
      expiresAt: now + CHALLENGE_TTL_MS,
      createdAt: now,
    })
    .run();
  return id;
}

async function consumeChallenge(
  ctx: AppContext,
  challengeId: string,
  type: "registration" | "authentication",
) {
  const row = await ctx.db.db
    .select()
    .from(webauthnChallenges)
    .where(
      and(
        eq(webauthnChallenges.id, challengeId),
        eq(webauthnChallenges.type, type),
        gt(webauthnChallenges.expiresAt, Date.now()),
      ),
    )
    .get();

  if (!row) return null;

  await ctx.db.db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id)).run();
  return row;
}

function parseTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AuthenticatorTransportFuture[];
  } catch {
    return undefined;
  }
}

function toCredentialDescriptor(
  credentialId: string,
  transportsRaw: string | null,
): { id: string; transports?: AuthenticatorTransportFuture[] } {
  const descriptor: { id: string; transports?: AuthenticatorTransportFuture[] } = {
    id: credentialId,
  };
  const transports = parseTransports(transportsRaw);
  if (transports) descriptor.transports = transports;
  return descriptor;
}

function toWebAuthnUserIdBytes(userId: string) {
  return Uint8Array.from(Buffer.from(userId, "utf8")) as Uint8Array<ArrayBuffer>;
}

function decodePublicKey(base64: string) {
  return Uint8Array.from(Buffer.from(base64, "base64")) as Uint8Array<ArrayBuffer>;
}

async function getUserPasskeys(ctx: AppContext, userId: string) {
  return ctx.db.db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .all();
}

function finishLogin(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  user: typeof users.$inferSelect,
) {
  return createSession(ctx, req, user, reply, "login-passkey").then((expiresAt) => ({
    user: serializeUser({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      totpEnabled: user.totpEnabled,
      authMethod: "session" as const,
    }),
    expiresAt,
  }));
}

export async function webauthnRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const log = getLogger();

  app.post<{ Body: { name?: string } }>(
    "/api/v1/auth/webauthn/register/options",
    async (req, reply) => {
      const authUser = await requireAuth(ctx, req, reply);
      if (!authUser) return;
      if (authUser.authMethod !== "session") {
        return reply.status(403).send({ error: "Passkey registration requires a browser session" });
      }

      const user = await ctx.db.db
        .select()
        .from(users)
        .where(eq(users.id, authUser.id))
        .get();
      if (!user) return reply.status(404).send({ error: "User not found" });

      const { rpID, rpName } = getWebAuthnConfig(ctx, req);
      const passkeys = await getUserPasskeys(ctx, user.id);

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.username,
        userDisplayName: user.displayName,
        userID: toWebAuthnUserIdBytes(user.id),
        attestationType: "none",
        excludeCredentials: passkeys.map((pk) =>
          toCredentialDescriptor(pk.credentialId, pk.transports),
        ),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
        supportedAlgorithmIDs: [...SUPPORTED_ALGORITHM_IDS],
      });

      const challengeId = await saveChallenge(ctx, options.challenge, "registration", user.id);
      return { options, challengeId, suggestedName: req.body.name ?? "Passkey" };
    },
  );

  app.post<{ Body: { challengeId: string; response: unknown; name?: string } }>(
    "/api/v1/auth/webauthn/register/verify",
    async (req, reply) => {
      const authUser = await requireAuth(ctx, req, reply);
      if (!authUser) return;
      if (authUser.authMethod !== "session") {
        return reply.status(403).send({ error: "Passkey registration requires a browser session" });
      }

      const stored = await consumeChallenge(ctx, req.body.challengeId, "registration");
      if (!stored || stored.userId !== authUser.id) {
        return reply.status(400).send({ error: "Invalid or expired registration challenge" });
      }

      const { rpID, expectedOrigin } = getWebAuthnConfig(ctx, req);
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: req.body.response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
          expectedChallenge: stored.challenge,
          expectedOrigin,
          expectedRPID: rpID,
        });
      } catch (err) {
        log.warn({ err, userId: authUser.id }, "Passkey registration verification failed");
        return reply.status(400).send({
          error: err instanceof Error ? err.message : "Registration verification failed",
        });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({ error: "Registration verification failed" });
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const now = Date.now();
      const name = req.body.name?.trim() || "Passkey";

      await ctx.db.db
        .insert(webauthnCredentials)
        .values({
          id: `wpk-${nanoid(12)}`,
          userId: authUser.id,
          credentialId: credential.id,
          webauthnUserId: toWebAuthnUserId(authUser.id),
          publicKey: Buffer.from(credential.publicKey).toString("base64"),
          counter: credential.counter,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          transports: credential.transports ? JSON.stringify(credential.transports) : null,
          name,
          createdAt: now,
        })
        .run();

      return { success: true, name };
    },
  );

  app.get("/api/v1/auth/webauthn/credentials", async (req, reply) => {
    const authUser = await requireAuth(ctx, req, reply);
    if (!authUser) return;

    const passkeys = await getUserPasskeys(ctx, authUser.id);
    return passkeys.map((pk) => ({
      id: pk.id,
      name: pk.name,
      deviceType: pk.deviceType,
      backedUp: pk.backedUp,
      createdAt: pk.createdAt,
      lastUsedAt: pk.lastUsedAt,
    }));
  });

  app.delete<{ Params: { id: string } }>(
    "/api/v1/auth/webauthn/credentials/:id",
    async (req, reply) => {
      const authUser = await requireAuth(ctx, req, reply);
      if (!authUser) return;

      const passkey = await ctx.db.db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.id, req.params.id))
        .get();

      if (!passkey || passkey.userId !== authUser.id) {
        return reply.status(404).send({ error: "Passkey not found" });
      }

      await ctx.db.db
        .delete(webauthnCredentials)
        .where(eq(webauthnCredentials.id, passkey.id))
        .run();

      return { success: true };
    },
  );

  app.post<{ Body: { username?: string } }>(
    "/api/v1/auth/webauthn/login/options",
    {
      config: {
        rateLimit: {
          max: ctx.config.security.loginRateLimitMaxAttempts,
          timeWindow: ctx.config.security.loginRateLimitWindowSecs * 1000,
        },
      },
    },
    async (req, reply) => {
      const { rpID } = getWebAuthnConfig(ctx, req);
      const username = req.body.username?.trim();

      if (username) {
        const user = await ctx.db.db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .get();

        if (!user || !user.enabled) {
          return reply.status(401).send({ error: "Invalid credentials" });
        }

        const passkeys = await getUserPasskeys(ctx, user.id);
        if (passkeys.length === 0) {
          return reply.status(400).send({ error: "No passkeys registered for this account" });
        }

        const options = await generateAuthenticationOptions({
          rpID,
          allowCredentials: passkeys.map((pk) =>
            toCredentialDescriptor(pk.credentialId, pk.transports),
          ),
          userVerification: "preferred",
        });

        const challengeId = await saveChallenge(ctx, options.challenge, "authentication", user.id);
        return { options, challengeId };
      }

      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
      });

      const challengeId = await saveChallenge(ctx, options.challenge, "authentication", null);
      return { options, challengeId };
    },
  );

  app.post<{ Body: { challengeId: string; response: unknown; username?: string } }>(
    "/api/v1/auth/webauthn/login/verify",
    async (req, reply) => {
      const stored = await consumeChallenge(ctx, req.body.challengeId, "authentication");
      if (!stored) {
        return reply.status(400).send({ error: "Invalid or expired authentication challenge" });
      }

      const response = req.body.response as Parameters<
        typeof verifyAuthenticationResponse
      >[0]["response"];
      const credentialId = response.id;

      const passkey = await ctx.db.db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.credentialId, credentialId))
        .get();

      if (!passkey) {
        return reply.status(401).send({ error: "Unknown passkey" });
      }

      if (stored.userId && stored.userId !== passkey.userId) {
        return reply.status(401).send({ error: "Passkey does not match this account" });
      }

      const username = req.body.username?.trim();
      if (username) {
        const expectedUser = await ctx.db.db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .get();
        if (!expectedUser || expectedUser.id !== passkey.userId) {
          return reply.status(401).send({ error: "Passkey does not match this account" });
        }
      }

      const user = await ctx.db.db
        .select()
        .from(users)
        .where(eq(users.id, passkey.userId))
        .get();

      if (!user || !user.enabled) {
        return reply.status(401).send({ error: "Account disabled or not found" });
      }

      const { rpID, expectedOrigin } = getWebAuthnConfig(ctx, req);
      const transports = parseTransports(passkey.transports);
      const credential = {
        id: passkey.credentialId,
        publicKey: decodePublicKey(passkey.publicKey),
        counter: passkey.counter,
        ...(transports ? { transports } : {}),
      };

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: stored.challenge,
          expectedOrigin,
          expectedRPID: rpID,
          credential,
        });
      } catch (err) {
        log.warn({ err, userId: user.id }, "Passkey authentication verification failed");
        return reply.status(401).send({
          error: err instanceof Error ? err.message : "Authentication verification failed",
        });
      }

      if (!verification.verified) {
        return reply.status(401).send({ error: "Authentication verification failed" });
      }

      const now = Date.now();
      await ctx.db.db
        .update(webauthnCredentials)
        .set({
          counter: verification.authenticationInfo.newCounter,
          lastUsedAt: now,
        })
        .where(eq(webauthnCredentials.id, passkey.id))
        .run();

      log.info({ username: user.username, ip: req.ip }, "User logged in with passkey");
      return finishLogin(ctx, req, reply, user);
    },
  );

  app.get("/api/v1/auth/webauthn/available", async (req) => {
    const username = (req.query as { username?: string }).username?.trim();
    if (!username) return { available: false };

    const user = await ctx.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), eq(users.enabled, true)))
      .get();

    if (!user) return { available: false };

    const passkeys = await getUserPasskeys(ctx, user.id);
    return { available: passkeys.length > 0 };
  });
}
