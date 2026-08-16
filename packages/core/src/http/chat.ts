/** OpenAI-compatible chat completions endpoint for a proxy base URL. */
export function buildChatCompletionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
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
    JSON.stringify(message),
    `-u ${JSON.stringify(baseUrl.replace(/\/$/, ""))}`,
    `-k ${JSON.stringify(apiKey)}`,
    `-m ${JSON.stringify(modelId)}`,
  ];
  if (!stream) parts.push("--no-stream");
  return parts.join(" \\\n  ");
}
