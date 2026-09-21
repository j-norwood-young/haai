/** OpenAI-compatible chat completions endpoint for a proxy base URL. */
export function buildChatCompletionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
}

/** Single-quote a value for POSIX shells so `!`, `$` and backticks are not expanded. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Shell command to send a test prompt via the haai CLI. */
export function buildHaaiPromptCommand(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  message = "Hello!",
  stream = true,
): string {
  const parts = [
    "haai prompt",
    shellQuote(message),
    `-u ${shellQuote(baseUrl.replace(/\/$/, ""))}`,
    `-k ${shellQuote(apiKey)}`,
    `-m ${shellQuote(modelId)}`,
  ];
  if (!stream) parts.push("--no-stream");
  return parts.join(" \\\n  ");
}

/** Shell command to list the models an API key can use via the haai CLI. */
export function buildHaaiModelsCommand(baseUrl: string, apiKey: string): string {
  return [
    "haai models",
    `-u ${shellQuote(baseUrl.replace(/\/$/, ""))}`,
    `-k ${shellQuote(apiKey)}`,
  ].join(" \\\n  ");
}
