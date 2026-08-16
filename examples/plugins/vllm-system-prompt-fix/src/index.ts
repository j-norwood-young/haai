import { definePlugin, t } from "@haai/plugin-sdk";
import type { ChatRequest, ChatMessage } from "@haai/plugin-sdk";

/**
 * vLLM System Prompt Fix
 *
 * Problem: vLLM and several other strict backends (Mistral, some Llama.cpp setups) only
 * accept a single `system` message at the start of the conversation. When a client sends
 * multiple system messages — or a system message that's not in first position — vLLM
 * returns a 400 error.
 *
 * Solution: Before forwarding the request, merge all system messages into one, joined
 * by a configurable separator, and place the merged message at the front of the array.
 *
 * Recommended usage: bind this plugin to your vLLM backend(s) specifically:
 *   haai plugin bind <pluginId> --scope backend --scope-id <vllm-backend-id>
 */
export default definePlugin({
  name: "vLLM System Prompt Fix",
  version: "1.0.0",
  description: "Merges multiple system messages into a single system prompt for strict vLLM backends.",

  config: {
    separator: t.text({
      label: "System prompt separator",
      description: "Text inserted between merged system prompts",
      default: "\n\n---\n\n",
    }),
    position: t.select(["first", "last"] as const, {
      label: "Merged prompt position",
      description: "Where to place the merged system prompt in the messages array",
      default: "first",
    }),
  },

  needsResponseBuffer: false,

  hooks: {
    onRequest(request: ChatRequest, ctx) {
      const systemMessages = request.messages.filter((m) => m.role === "system");

      // Nothing to do if there's at most one system message already in first position
      if (systemMessages.length <= 1) {
        if (systemMessages.length === 0) return request;
        const firstMsg = request.messages[0];
        if (firstMsg?.role === "system") return request;
      }

      const separator = ctx.config.separator ?? "\n\n---\n\n";

      // Extract text content from each system message
      const combinedContent = systemMessages
        .map((m) => {
          if (typeof m.content === "string") return m.content;
          if (Array.isArray(m.content)) {
            return m.content
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("\n");
          }
          return "";
        })
        .filter(Boolean)
        .join(separator);

      const mergedSystem: ChatMessage = {
        role: "system",
        content: combinedContent,
      };

      // Non-system messages in original order
      const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

      const messages: ChatMessage[] =
        ctx.config.position === "last"
          ? [...nonSystemMessages, mergedSystem]
          : [mergedSystem, ...nonSystemMessages];

      return { ...request, messages };
    },
  },
});
