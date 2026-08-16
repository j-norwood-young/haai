import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_SIZE = 32; // 256 bits
const IV_SIZE = 12; // 96 bits for GCM
const TAG_SIZE = 16; // 128 bits auth tag

/** Load or generate the master encryption key. */
export function getMasterKey(dataDir: string): Buffer {
  const keyFile = join(dataDir, "master.key");
  if (existsSync(keyFile)) {
    const hex = readFileSync(keyFile, "utf8").trim();
    return Buffer.from(hex, "hex");
  }
  const key = randomBytes(KEY_SIZE);
  writeFileSync(keyFile, key.toString("hex"), { mode: 0o600, encoding: "utf8" });
  chmodSync(keyFile, 0o600);
  return key;
}

/** Encrypt a plaintext string. Returns base64-encoded ciphertext. */
export function encrypt(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_SIZE);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12) + tag(16) + ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString("base64");
}

/** Decrypt a base64-encoded ciphertext. */
export function decrypt(ciphertext: string, masterKey: Buffer): string {
  const combined = Buffer.from(ciphertext, "base64");
  const iv = combined.subarray(0, IV_SIZE);
  const tag = combined.subarray(IV_SIZE, IV_SIZE + TAG_SIZE);
  const encrypted = combined.subarray(IV_SIZE + TAG_SIZE);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Generate a cryptographically secure random token string. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Generate a bearer key in the format "haai-sk-<random>" */
export function generateApiKey(): { key: string; prefix: string } {
  const rand = randomBytes(24).toString("base64url");
  const key = `haai-sk-${rand}`;
  const prefix = key.slice(0, 13); // "haai-sk-xxxx"
  return { key, prefix };
}

/** Generate an admin API token in the format "haai-at-<random>" */
export function generateAdminToken(): { token: string; prefix: string } {
  const rand = randomBytes(24).toString("base64url");
  const token = `haai-at-${rand}`;
  const prefix = token.slice(0, 13); // "haai-at-xxxx"
  return { token, prefix };
}

export const ADMIN_TOKEN_PREFIX = "haai-at-";

/** Hash a token with SHA-256 for storage (not for passwords—use argon2 for those). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compare a plain token to its hash in constant time. */
export function verifyToken(token: string, hash: string): boolean {
  const tokenHash = Buffer.from(hashToken(token), "hex");
  const storedHash = Buffer.from(hash, "hex");
  if (tokenHash.length !== storedHash.length) return false;
  return timingSafeEqual(tokenHash, storedHash);
}
