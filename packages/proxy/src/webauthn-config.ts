import type { FastifyRequest } from "fastify";
import type { AppContext } from "./context.js";

const RP_NAME = "haai";

export function getWebAuthnConfig(ctx: AppContext, req: FastifyRequest) {
  const hostHeader = req.headers.host ?? "localhost";
  const hostname = hostHeader.split(":")[0] ?? "localhost";

  let rpID = ctx.config.security.webauthnRpId;
  if (!rpID) {
    rpID = hostname === "127.0.0.1" ? "localhost" : hostname;
  }

  const requestOrigin =
    req.headers.origin ??
    `${req.protocol === "https" ? "https" : "http"}://${hostHeader}`;

  const configuredOrigins = ctx.config.security.webauthnOrigins ?? [];
  const expectedOrigin = [
    ...configuredOrigins,
    ...ctx.config.server.corsOrigins,
    requestOrigin,
  ].filter((value, index, arr) => value && arr.indexOf(value) === index) as string[];

  return { rpID, rpName: RP_NAME, expectedOrigin };
}

export function toWebAuthnUserId(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}

export function webAuthnUserIdToUserId(webauthnUserId: string): string {
  return Buffer.from(webauthnUserId, "base64url").toString("utf8");
}
