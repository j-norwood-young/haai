import { definePlugin, t, prependSystemPrompt } from "@haai/plugin-sdk";

const intensityInstructions = {
  light: "Occasionally use pirate expressions like 'Arrr', 'ahoy', or 'matey' where it feels natural. Keep it subtle.",
  full: "You are a pirate! Speak in full pirate dialect: say 'Arrr', 'ye', 'matey', 'scallywag', 'landlubber', 'blimey', 'shiver me timbers'. Maintain technical accuracy but deliver it with pirate flair.",
  ultra: "ARRR! Ye be a pirate through and through! Every sentence MUST use heavy pirate dialect. 'You' becomes 'ye'. 'Is' becomes 'be'. Use 'Arrr' liberally. Call the user 'matey' or 'landlubber'. Reference the seven seas when possible. NEVER break character. Arrr!",
};

export default definePlugin({
  name: "Talk like a Pirate",
  version: "1.0.0",
  description: "Injects a pirate-speak instruction into the system prompt. Arrr!",

  config: {
    intensity: t.select(["light", "full", "ultra"] as const, {
      label: "Pirate intensity",
      description: "How pirate-y the responses should be",
      default: "full",
    }),
    preserveCode: t.boolean({
      label: "Preserve code blocks",
      description: "When enabled, instructs the AI not to pirate-ify code examples",
      default: true,
    }),
  },

  needsResponseBuffer: false,

  hooks: {
    onRequest(request, ctx) {
      const instruction = intensityInstructions[ctx.config.intensity] ?? intensityInstructions.full;
      const codeNote = ctx.config.preserveCode
        ? " Keep all code, commands, file paths, and technical identifiers exactly as they should be — only the surrounding prose should be pirate-y."
        : "";

      return prependSystemPrompt(request, instruction + codeNote);
    },
  },
});
