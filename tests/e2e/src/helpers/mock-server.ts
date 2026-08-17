import { createMockServer } from "@haai/mock-backend/server";
import type { MockBackendConfig } from "@haai/mock-backend/config";
import type { FastifyInstance } from "fastify";
import { getPort } from "./ports.js";

export interface StartedMockServer {
  port: number;
  url: string;
  config: MockBackendConfig;
  stop: () => Promise<void>;
}

export async function startMockServer(
  overrides: Partial<MockBackendConfig> = {},
): Promise<StartedMockServer> {
  const port = overrides.port ?? (await getPort());
  const config: MockBackendConfig = {
    port,
    host: "127.0.0.1",
    provider: overrides.provider ?? "generic",
    hostName: overrides.hostName ?? `mock-${port}`,
    models: overrides.models ?? [
      { id: "mock-model-1" },
      { id: "mock-model-2" },
    ],
    fault: overrides.fault,
    apiKey: overrides.apiKey,
    globalLatencyMs: overrides.globalLatencyMs,
  };

  const app = createMockServer(config) as FastifyInstance;
  await app.listen({ port, host: "127.0.0.1" });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    config,
    stop: () => app.close(),
  };
}
