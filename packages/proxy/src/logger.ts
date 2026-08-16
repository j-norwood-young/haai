import pino from "pino";
import type { LogConfig } from "@ai-v-models/core";

let logger: pino.Logger;

export function createLogger(config: LogConfig, _dataDir: string): pino.Logger {
  const streams: pino.DestinationStream[] = [];

  const stdoutStream = pino.destination(1);
  streams.push(stdoutStream);

  if (config.file) {
    // file logging with rotation (handled externally or by pino-roll)
    const fileStream = pino.destination({ dest: config.file, sync: false });
    streams.push(fileStream);
  }

  const transport =
    config.format === "pretty"
      ? pino.transport({ target: "pino-pretty", options: { colorize: true } })
      : undefined;

  logger = pino(
    {
      level: config.level,
      base: { service: "ai-v-models" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    transport ?? pino.multistream(streams),
  );

  return logger;
}

export function getLogger(): pino.Logger {
  if (!logger) {
    logger = pino({ level: "info" });
  }
  return logger;
}

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return getLogger().child(bindings);
}
