export interface MockBackendConfig {
  port: number;
  host: string;
  provider: string;
  hostName: string;
  models: ModelConfig[];
  /** Global fault injection */
  fault?: FaultConfig;
  /** Auth - if set, requires Authorization: Bearer <apiKey> */
  apiKey?: string;
  /** Delay before processing each request (ms) */
  globalLatencyMs?: number;
}

export interface ModelConfig {
  id: string;
  displayName?: string;
  contextLength?: number;
  /** Reported by the provider-native probe endpoints (/api/v0/models, /api/show); defaults to "llm". */
  kind?: "llm" | "vlm" | "embeddings";
  /** Per-model fault override */
  fault?: FaultConfig;
}

export interface FaultConfig {
  /** Return HTTP 429 (rate limited) on N% of requests */
  rateLimitPct?: number;
  /** Return HTTP 500 on N% of requests */
  errorPct?: number;
  /** Disconnect mid-stream on N% of requests */
  disconnectMidStreamPct?: number;
  /** Fixed additional latency before first token (ms) */
  ttftLatencyMs?: number;
  /** Fixed additional latency between tokens (ms) */
  tokenDelayMs?: number;
  /** Always return HTTP 503 (backend down) */
  alwaysDown?: boolean;
  /** Partial stream: emit N tokens then stop without [DONE] */
  partialStreamTokens?: number;
}

export function loadConfig(): MockBackendConfig {
  const port = parseInt(process.env["MOCK_PORT"] ?? "11435", 10);
  const host = process.env["MOCK_HOST"] ?? "0.0.0.0";
  const provider = process.env["MOCK_PROVIDER"] ?? "generic";
  const hostName = process.env["MOCK_HOST_NAME"] ?? "mock-host";
  const apiKey = process.env["MOCK_API_KEY"];
  const globalLatencyMs = process.env["MOCK_LATENCY_MS"]
    ? parseInt(process.env["MOCK_LATENCY_MS"], 10)
    : undefined;

  const defaultModels: ModelConfig[] = [
    { id: "mock-model-1", displayName: "Mock Model 1", contextLength: 8192 },
    { id: "mock-model-2", displayName: "Mock Model 2", contextLength: 32768 },
  ];

  const fault: FaultConfig = {};
  if (process.env["MOCK_ERROR_PCT"]) fault.errorPct = parseFloat(process.env["MOCK_ERROR_PCT"]);
  if (process.env["MOCK_RATE_LIMIT_PCT"]) fault.rateLimitPct = parseFloat(process.env["MOCK_RATE_LIMIT_PCT"]);
  if (process.env["MOCK_DISCONNECT_PCT"]) fault.disconnectMidStreamPct = parseFloat(process.env["MOCK_DISCONNECT_PCT"]);
  if (process.env["MOCK_TTFT_LATENCY_MS"]) fault.ttftLatencyMs = parseInt(process.env["MOCK_TTFT_LATENCY_MS"], 10);
  if (process.env["MOCK_TOKEN_DELAY_MS"]) fault.tokenDelayMs = parseInt(process.env["MOCK_TOKEN_DELAY_MS"], 10);
  if (process.env["MOCK_ALWAYS_DOWN"] === "true") fault.alwaysDown = true;

  const result: MockBackendConfig = {
    port,
    host,
    provider,
    hostName,
    models: defaultModels,
  };
  if (Object.keys(fault).length > 0) result.fault = fault;
  if (apiKey !== undefined) result.apiKey = apiKey;
  if (globalLatencyMs !== undefined) result.globalLatencyMs = globalLatencyMs;
  return result;
}
