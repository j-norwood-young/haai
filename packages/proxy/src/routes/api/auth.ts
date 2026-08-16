import type { FastifyInstance } from "fastify";
import { eq, and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";
import { authenticator } from "otplib";
import {
  users,
  sessions,
  pendingTotpLogins,
  apiTokens,
  encrypt,
  decrypt,
  generateAdminToken,
  hashToken,
} from "@ai-v-models/core";
import type { AppContext } from "../../context.js";
import { getLogger } from "../../logger.js";
import {
  requireAdmin,
  requireAuth,
  serializeUser,
  getAuthUser,
} from "../../auth-session.js";
import { createSession } from "../../session.js";

const PENDING_TOTP_TTL_MS = 5 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const log = getLogger();

  app.post<{ Body: { username: string; password: string } }>(
    "/api/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: ctx.config.security.loginRateLimitMaxAttempts,
          timeWindow: ctx.config.security.loginRateLimitWindowSecs * 1000,
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;

      const user = await ctx.db.db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .get();

      if (!user || !user.enabled) {
        log.warn({ username, ip: req.ip }, "Login failed: unknown or disabled user");
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      const valid = await verify(user.passwordHash, password);
      if (!valid) {
        log.warn({ username, ip: req.ip }, "Login failed: invalid password");
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      if (user.totpEnabled && user.totpSecret) {
        const pendingToken = randomBytes(32).toString("hex");
        const now = Date.now();
        await ctx.db.db
          .insert(pendingTotpLogins)
          .values({
            id: `ptotp-${nanoid(12)}`,
            userId: user.id,
            token: pendingToken,
            expiresAt: now + PENDING_TOTP_TTL_MS,
            createdAt: now,
          })
          .run();

        return {
          requiresTotp: true,
          pendingToken,
          user: serializeUser({
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            mustChangePassword: user.mustChangePassword,
            totpEnabled: user.totpEnabled,
            authMethod: "session",
          }),
        };
      }

      const expiresAt = await createSession(ctx, req, user, reply);
      log.info({ username: user.username, ip: req.ip }, "User logged in");

      return {
        user: serializeUser({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          totpEnabled: user.totpEnabled,
          authMethod: "session",
        }),
        expiresAt,
      };
    },
  );

  app.post<{ Body: { pendingToken: string; code: string } }>(
    "/api/v1/auth/verify-totp",
    async (req, reply) => {
      const { pendingToken, code } = req.body;
      const now = Date.now();

      const pending = await ctx.db.db
        .select()
        .from(pendingTotpLogins)
        .where(
          and(
            eq(pendingTotpLogins.token, pendingToken),
            gt(pendingTotpLogins.expiresAt, now),
          ),
        )
        .get();

      if (!pending) {
        return reply.status(401).send({ error: "Invalid or expired verification" });
      }

      const user = await ctx.db.db
        .select()
        .from(users)
        .where(eq(users.id, pending.userId))
        .get();

      if (!user || !user.enabled || !user.totpEnabled || !user.totpSecret) {
        return reply.status(401).send({ error: "Invalid or expired verification" });
      }

      const secret = decrypt(user.totpSecret, ctx.masterKey);
      const valid = authenticator.verify({ token: code, secret });
      if (!valid) {
        log.warn({ username: user.username, ip: req.ip }, "TOTP verification failed");
        return reply.status(401).send({ error: "Invalid verification code" });
      }

      await ctx.db.db
        .delete(pendingTotpLogins)
        .where(eq(pendingTotpLogins.id, pending.id))
        .run();

      const expiresAt = await createSession(ctx, req, user, reply);
      log.info({ username: user.username, ip: req.ip }, "User logged in with TOTP");

      return {
        user: serializeUser({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
          totpEnabled: user.totpEnabled,
          authMethod: "session",
        }),
        expiresAt,
      };
    },
  );

  app.post("/api/v1/auth/logout", async (req, reply) => {
    const sessionToken = req.cookies["aivm_session"];
    if (sessionToken) {
      await ctx.db.db
        .delete(sessions)
        .where(eq(sessions.token, sessionToken))
        .run();
    }
    reply.clearCookie("aivm_session");
    return { success: true };
  });

  app.get("/api/v1/auth/me", async (req, reply) => {
    const authUser = await getAuthUser(ctx, req);
    if (!authUser) return reply.status(401).send({ error: "Not authenticated" });
    return serializeUser(authUser);
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/api/v1/auth/change-password",
    async (req, reply) => {
      const authUser = await requireAuth(ctx, req, reply);
      if (!authUser) return;
      if (authUser.authMethod !== "session") {
        return reply.status(403).send({ error: "Password change requires a browser session" });
      }

      const { currentPassword, newPassword } = req.body;
      const passwordError = validateNewPassword(newPassword);
      if (passwordError) return reply.status(400).send({ error: passwordError });

      const user = await ctx.db.db
        .select()
        .from(users)
        .where(eq(users.id, authUser.id))
        .get();

      if (!user) return reply.status(404).send({ error: "User not found" });

      const valid = await verify(user.passwordHash, currentPassword);
      if (!valid) return reply.status(401).send({ error: "Current password is incorrect" });

      const passwordHash = await hash(newPassword);
      const now = Date.now();
      await ctx.db.db
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          updatedAt: now,
        })
        .where(eq(users.id, user.id))
        .run();

      return {
        success: true,
        user: serializeUser({
          ...authUser,
          mustChangePassword: false,
        }),
      };
    },
  );

  app.post("/api/v1/auth/totp/setup", async (req, reply) => {
    const authUser = await requireAuth(ctx, req, reply);
    if (!authUser) return;
    if (authUser.authMethod !== "session") {
      return reply.status(403).send({ error: "TOTP setup requires a browser session" });
    }

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(authUser.username, "ai-v-models", secret);

    return { secret, otpauthUrl };
  });

  app.post<{ Body: { secret: string; code: string } }>(
    "/api/v1/auth/totp/enable",
    async (req, reply) => {
      const authUser = await requireAuth(ctx, req, reply);
      if (!authUser) return;
      if (authUser.authMethod !== "session") {
        return reply.status(403).send({ error: "TOTP setup requires a browser session" });
      }

      const { secret, code } = req.body;
      const valid = authenticator.verify({ token: code, secret });
      if (!valid) return reply.status(400).send({ error: "Invalid verification code" });

      const encryptedSecret = encrypt(secret, ctx.masterKey);
      await ctx.db.db
        .update(users)
        .set({
          totpSecret: encryptedSecret,
          totpEnabled: true,
          updatedAt: Date.now(),
        })
        .where(eq(users.id, authUser.id))
        .run();

      return { success: true, totpEnabled: true };
    },
  );

  app.post<{ Body: { code: string } }>("/api/v1/auth/totp/disable", async (req, reply) => {
    const authUser = await requireAuth(ctx, req, reply);
    if (!authUser) return;
    if (authUser.authMethod !== "session") {
      return reply.status(403).send({ error: "TOTP changes require a browser session" });
    }

    const user = await ctx.db.db
      .select()
      .from(users)
      .where(eq(users.id, authUser.id))
      .get();

    if (!user?.totpSecret) {
      return reply.status(400).send({ error: "Two-factor authentication is not enabled" });
    }

    const secret = decrypt(user.totpSecret, ctx.masterKey);
    const valid = authenticator.verify({ token: req.body.code, secret });
    if (!valid) return reply.status(401).send({ error: "Invalid verification code" });

    await ctx.db.db
      .update(users)
      .set({
        totpSecret: null,
        totpEnabled: false,
        updatedAt: Date.now(),
      })
      .where(eq(users.id, authUser.id))
      .run();

    return { success: true, totpEnabled: false };
  });

  app.get("/api/v1/admin-tokens", async (req, reply) => {
    if (!(await requireAdmin(ctx, req, reply))) return;
    const rows = await ctx.db.db.select().from(apiTokens).all();
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      prefix: t.prefix,
      enabled: t.enabled,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    }));
  });

  app.post<{ Body: { name: string; expiresInDays?: number } }>(
    "/api/v1/admin-tokens",
    async (req, reply) => {
      const authUser = await requireAdmin(ctx, req, reply);
      if (!authUser) return;

      const { name, expiresInDays } = req.body;
      if (!name?.trim()) return reply.status(400).send({ error: "Name is required" });

      const { token, prefix } = generateAdminToken();
      const now = Date.now();
      const id = `atok-${nanoid(12)}`;

      await ctx.db.db
        .insert(apiTokens)
        .values({
          id,
          name: name.trim(),
          tokenHash: hashToken(token),
          prefix,
          userId: authUser.authMethod === "session" ? authUser.id : null,
          enabled: true,
          expiresAt: expiresInDays ? now + expiresInDays * 86400 * 1000 : null,
          createdAt: now,
        })
        .run();

      return reply.status(201).send({
        id,
        name: name.trim(),
        prefix,
        token,
        expiresAt: expiresInDays ? now + expiresInDays * 86400 * 1000 : null,
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/admin-tokens/:id", async (req, reply) => {
    if (!(await requireAdmin(ctx, req, reply))) return;
    await ctx.db.db.delete(apiTokens).where(eq(apiTokens.id, req.params.id)).run();
    return { success: true };
  });

  app.get("/api/v1/users", async (req, reply) => {
    if (!(await requireAdmin(ctx, req, reply))) return;
    const rows = await ctx.db.db.select().from(users).all();
    return rows.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      enabled: u.enabled,
      mustChangePassword: u.mustChangePassword,
      totpEnabled: u.totpEnabled,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }));
  });

  app.post<{ Body: { username: string; password: string; displayName?: string; role?: string } }>(
    "/api/v1/users",
    async (req, reply) => {
      if (!(await requireAdmin(ctx, req, reply))) return;

      const { username, password, displayName, role = "viewer" } = req.body;
      const passwordError = validateNewPassword(password);
      if (passwordError) return reply.status(400).send({ error: passwordError });

      const passwordHash = await hash(password);
      const now = Date.now();
      const id = `user-${nanoid(8)}`;

      await ctx.db.db
        .insert(users)
        .values({
          id,
          username,
          displayName: displayName ?? username,
          passwordHash,
          role,
          enabled: true,
          mustChangePassword: false,
          totpEnabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return reply.status(201).send({ id, username, displayName: displayName ?? username, role });
    },
  );

  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/api/v1/users/:id/password",
    async (req, reply) => {
      if (!(await requireAdmin(ctx, req, reply))) return;

      const passwordError = validateNewPassword(req.body.password);
      if (passwordError) return reply.status(400).send({ error: passwordError });

      await ctx.db.db
        .update(users)
        .set({
          passwordHash: await hash(req.body.password),
          mustChangePassword: false,
          updatedAt: Date.now(),
        })
        .where(eq(users.id, req.params.id))
        .run();
      return { success: true };
    },
  );
}
