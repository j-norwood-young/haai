import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { sessions, users, auditLog } from "@haai/core";
import type { AppContext } from "./context.js";

type SessionRequest = {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  protocol: string;
};

type SessionReply = {
  setCookie: (name: string, value: string, options: Record<string, unknown>) => void;
};

export async function createSession(
  ctx: AppContext,
  req: SessionRequest,
  user: typeof users.$inferSelect,
  reply: SessionReply,
  auditAction = "login",
): Promise<number> {
  const sessionToken = randomBytes(32).toString("hex");
  const sessionId = `sess-${nanoid(12)}`;
  const now = Date.now();
  const expiresAt = now + ctx.config.security.sessionMaxAgeSecs * 1000;

  await ctx.db.db
    .insert(sessions)
    .values({
      id: sessionId,
      userId: user.id,
      token: sessionToken,
      expiresAt,
      createdAt: now,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
      ipAddress: req.ip,
    })
    .run();

  await ctx.db.db
    .update(users)
    .set({ lastLoginAt: now })
    .where(eq(users.id, user.id))
    .run();

  await ctx.db.db
    .insert(auditLog)
    .values({
      id: nanoid(),
      userId: user.id,
      username: user.username,
      action: auditAction,
      resourceType: null,
      resourceId: null,
      detail: null,
      ipAddress: req.ip,
      timestamp: now,
    })
    .run();

  reply.setCookie("haai_session", sessionToken, {
    httpOnly: true,
    secure: req.protocol === "https",
    sameSite: "lax",
    maxAge: ctx.config.security.sessionMaxAgeSecs,
    path: "/",
  });

  return expiresAt;
}
