import { definePlugin, t, prependSystemPrompt } from "@haai/plugin-sdk";

/**
 * Caveman compression skill — inspired by https://github.com/JuliusBrussee/caveman
 *
 * Instructs the AI to communicate like a caveman: drop filler words, use fragments,
 * keep technical substance. Reduces output tokens by ~65% while maintaining accuracy.
 *
 * Compression levels:
 *   lite   — Drop filler phrases ("Sure, I'd be happy to", "Great question", etc.)
 *   full   — Caveman fragments: skip pronouns, articles, connectives
 *   ultra  — Pure telegraphic: minimum words possible, abbreviations OK
 *   wenyan — Classical Chinese poetry style (very terse, even shorter than ultra)
 */

const levelInstructions: Record<string, string> = {
  lite: `COMMUNICATION STYLE — LITE:
Drop all filler and preamble: no "Sure!", "Great question!", "I'd be happy to help", "Certainly!", or similar openers.
Cut unnecessary hedging. Keep substance. Still use full sentences but strip the fat.
Code, commands, paths: preserve exactly.`,

  full: `COMMUNICATION STYLE — CAVEMAN:
Speak like caveman. Why use many token when few do trick.
Rules:
- Drop articles: "a", "an", "the" → omit unless truly needed
- Drop pronouns where obvious: "I will show" → "show"
- Use fragments: "Component re-render. Cause: new object ref each render."
- No greetings, no preamble, no "sure", no "great question"
- No filler: "In order to" → "to", "Due to the fact that" → "because"
- Keep technical words exact. Code/commands/paths: byte-perfect.
- Brain still big. Mouth small.`,

  ultra: `COMMUNICATION STYLE — ULTRA CAVEMAN (TELEGRAPHIC):
Minimum words. Every word must carry weight or be cut.
Fragment. No pronouns. No articles. Abbreviate when clear.
Example: "New obj ref each render → re-render. useMemo fix."
No greeting. No preamble. Answer start immediately.
Code exact. Paths exact. Error strings exact.`,

  wenyan: `COMMUNICATION STYLE — WENYAN (CLASSICAL):
Write in spirit of classical Chinese: compress to essence.
Terse. Poetic fragments. Maximum meaning, minimum words.
No filler. No ceremony. Pure signal.
Example normal: "The authentication middleware fails because token expiry comparison uses < instead of <=."
Example wenyan: "Auth fail. Expiry: < not <=."
Code/commands: exact, unchanged.`,
};

export default definePlugin({
  name: "Caveman",
  version: "1.0.0",
  description: "Compress AI output tokens by ~65% using caveman-style terse communication.",

  config: {
    level: t.select(["lite", "full", "ultra", "wenyan"] as const, {
      label: "Compression level",
      description: "lite: drop filler | full: caveman fragments | ultra: telegraphic | wenyan: classical",
      default: "full",
    }),
  },

  needsResponseBuffer: false,

  hooks: {
    onRequest(request, ctx) {
      const instruction = levelInstructions[ctx.config.level] ?? levelInstructions["full"] ?? "";
      return prependSystemPrompt(request, instruction);
    },
  },
});
