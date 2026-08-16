import { z } from "zod";

export const ServerConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(4000),
  tlsCert: z.string().optional(),
  tlsKey: z.string().optional(),
  corsOrigins: z
    .union([z.string(), z.array(z.string())])
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((v) => (Array.isArray(v) ? v : v.split(",").map((s) => s.trim()))),
});

export const LogConfigSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  format: z.enum(["json", "pretty"]).default("json"),
  file: z.string().optional(),
  maxFileSize: z.coerce.number().default(10_485_760), // 10MB
  maxFiles: z.coerce.number().int().default(5),
});

export const MetricsConfigSchema = z.object({
  enabled: z.coerce.boolean().default(true),
  otelEndpoint: z.string().url().optional(),
  otelServiceName: z.string().default("haai"),
});

export const HealthConfigSchema = z.object({
  checkIntervalSecs: z.coerce.number().int().default(30),
  timeoutMs: z.coerce.number().int().default(5000),
  unhealthyThreshold: z.coerce.number().int().default(3),
  healthyThreshold: z.coerce.number().int().default(2),
});

export const SecurityConfigSchema = z.object({
  sessionSecret: z.string().optional(),
  sessionMaxAgeSecs: z.coerce.number().int().default(86400 * 7), // 7 days
  loginRateLimitMaxAttempts: z.coerce.number().int().default(10),
  loginRateLimitWindowSecs: z.coerce.number().int().default(300),
  webauthnRpId: z.string().optional(),
  webauthnOrigins: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : Array.isArray(v) ? v : v.split(",").map((s) => s.trim()),
    ),
});

export const AppConfigSchema = z.object({
  dataDir: z.string().optional(),
  server: ServerConfigSchema.default({}),
  log: LogConfigSchema.default({}),
  metrics: MetricsConfigSchema.default({}),
  health: HealthConfigSchema.default({}),
  security: SecurityConfigSchema.default({}),
});

export type AppConfig = z.output<typeof AppConfigSchema>;
export type ServerConfig = z.output<typeof ServerConfigSchema>;
export type LogConfig = z.output<typeof LogConfigSchema>;
export type MetricsConfig = z.output<typeof MetricsConfigSchema>;
export type HealthConfig = z.output<typeof HealthConfigSchema>;
export type SecurityConfig = z.output<typeof SecurityConfigSchema>;
