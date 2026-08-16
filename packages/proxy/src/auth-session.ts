import { eq, and, gt } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import {
  sessions,
  users,
  apiTokens,
  ADMIN_TOKEN_PREFIX,
  verifyToken,
} from "@haai/core";
import type { AppContext } from "./context.js";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  authMethod: "session" | "token";
}

function mapUser(
  user: typeof users.$inferSelect,
  authMethod: "session" | "token",
): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    totpEnabled: user.totpEnabled,
    authMethod,
  };
}

function extractBearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token.startsWith(ADMIN_TOKEN_PREFIX)) return null;
  return token;
}

async function getUserFromBearerToken(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<AuthUser | null> {
  const token = extractBearerToken(req);
  if (!token) return null;

  const prefix = token.slice(0, 13);
  const row = await ctx.db.db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.prefix, prefix), eq(apiTokens.enabled, true)))
    .get();

  if (!row || !verifyToken(token, row.tokenHash)) return null;
  if (row.expiresAt != null && row.expiresAt < Date.now()) return null;

  const user = row.userId
    ? await ctx.db.db.select().from(users).where(eq(users.id, row.userId)).get()
    : null;

  if (user && !user.enabled) return null;

  await ctx.db.db
    .update(apiTokens)
    .set({ lastUsedAt: Date.now() })
    .where(eq(apiTokens.id, row.id))
    .run();

  if (user) return mapUser(user, "token");

  return {
    id: `token-${row.id}`,
    username: row.name,
    displayName: row.name,
    role: "admin",
    mustChangePassword: false,
    totpEnabled: false,
    authMethod: "token",
  };
}

async function getUserFromSession(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<AuthUser | null> {
  const sessionToken = req.cookies["haai_session"];
  if (!sessionToken) return null;

  const session = await ctx.db.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.token, sessionToken), gt(sessions.expiresAt, Date.now())))
    .get();

  if (!session) return null;

  const user = await ctx.db.db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();

  if (!user || !user.enabled) return null;

  return mapUser(user, "session");
}

export async function getAuthUser(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<AuthUser | null> {
  const fromToken = await getUserFromBearerToken(ctx, req);
  if (fromToken) return fromToken;
  return getUserFromSession(ctx, req);
}

/** @deprecated Use getAuthUser */
export async function getSessionUser(
  ctx: AppContext,
  req: FastifyRequest,
): Promise<AuthUser | null> {
  return getAuthUser(ctx, req);
}

export async function requireAuth(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const user = await getAuthUser(ctx, req);
  if (!user) {
    reply.status(401).send({ error: "Not authenticated" });
    return null;
  }
  return user;
}

export async function requireAdmin(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const user = await requireAuth(ctx, req, reply);
  if (!user) return null;
  if (user.role !== "admin") {
    reply.status(403).send({ error: "Admin access required" });
    return null;
  }
  return user;
}

export function serializeUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    totpEnabled: user.totpEnabled,
  };
}
