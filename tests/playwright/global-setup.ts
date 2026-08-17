import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeAllVModelHealth } from "@haai/proxy/vmodel-health";
import { startMockServer } from "@haai/e2e/helpers/mock-server";
import { startTestProxy } from "@haai/e2e/helpers/proxy-server";
import {
  insertBackend,
  insertRollup,
  insertUsageEvent,
  insertVModel,
} from "@haai/e2e/helpers/seed";

const PROXY_PORT = 14010;
const MOCK_PORT = 14011;
const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(dir, "../..");
const authDir = resolve(dir, ".auth");

export default async function globalSetup() {
  loadEnv({ path: resolve(repoRoot, ".env") });
  delete process.env["HAAI_DEV"];

  const webDir = resolve(repoRoot, "apps/web/build");
  if (!existsSync(resolve(webDir, "handler.js"))) {
    throw new Error("Admin UI build missing at apps/web/build. Run `pnpm --filter @haai/web build` first.");
  }
  process.env["HAAI_WEB_DIR"] = webDir;

  const adminUsername = process.env["HAAI_ADMIN_USER"] ?? "testadmin";
  const adminPassword = process.env["HAAI_ADMIN_PASSWORD"] ?? "test-admin-password";

  const mock = await startMockServer({
    port: MOCK_PORT,
    hostName: "pw-host",
    provider: "generic",
    models: [{ id: "pw-model" }],
  });

  const proxy = await startTestProxy({
    port: PROXY_PORT,
    adminUsername,
    adminPassword,
  });

  const backendId = await insertBackend(proxy, {
    name: "pw-backend",
    hostName: "pw-host",
    baseUrl: mock.url,
    availableModels: ["pw-model"],
    lastHealthStatus: "healthy",
  });
  await insertVModel(proxy, {
    modelId: "pw-chat",
    displayName: "Playwright Chat",
    backends: [{ backendId, backendModelId: "pw-model" }],
  });
  await recomputeAllVModelHealth(proxy.db);

  const now = Date.now();
  insertUsageEvent(proxy, { timestamp: now - 30 * 60 * 1000, totalTokens: 5 });
  insertUsageEvent(proxy, { timestamp: now - 5 * 86400 * 1000, totalTokens: 50 });
  insertUsageEvent(proxy, { timestamp: now - 20 * 86400 * 1000, totalTokens: 80 });

  const hourBucket = new Date(now);
  hourBucket.setMinutes(0, 0, 0);
  insertRollup(proxy, { period: "hour", bucket: hourBucket.toISOString(), requestCount: 3 });

  const dayBucket = new Date(now);
  dayBucket.setHours(0, 0, 0, 0);
  insertRollup(proxy, { period: "day", bucket: dayBucket.toISOString(), requestCount: 55 });

  const weekBucket = new Date(now);
  weekBucket.setDate(weekBucket.getDate() - weekBucket.getDay());
  weekBucket.setHours(0, 0, 0, 0);
  insertRollup(proxy, { period: "week", bucket: weekBucket.toISOString(), requestCount: 120 });

  const monthBucket = new Date(now);
  monthBucket.setDate(1);
  monthBucket.setHours(0, 0, 0, 0);
  insertRollup(proxy, { period: "month", bucket: monthBucket.toISOString(), requestCount: 400 });

  mkdirSync(authDir, { recursive: true });
  writeFileSync(
    resolve(authDir, "credentials.json"),
    JSON.stringify({
      username: adminUsername,
      password: adminPassword,
      mockUrl: mock.url,
      baseURL: proxy.url,
    }),
  );

  return async () => {
    await proxy.stop();
    await mock.stop();
  };
}
