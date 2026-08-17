import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));

export function playwrightCreds(): { username: string; password: string; mockUrl: string; baseURL: string } {
  return JSON.parse(readFileSync(resolve(dir, "../../.auth/credentials.json"), "utf8")) as {
    username: string;
    password: string;
    mockUrl: string;
    baseURL: string;
  };
}
