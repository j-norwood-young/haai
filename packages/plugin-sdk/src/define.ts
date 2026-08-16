import type { ConfigSchema, PluginDefinition } from "./types.js";

/**
 * Define a plugin with full TypeScript inference.
 *
 * The config schema you provide is used to:
 * - Infer the type of `ctx.config` inside your hooks
 * - Auto-generate a config UI in the admin panel
 *
 * @example
 * ```ts
 * import { definePlugin, t } from "@haai/plugin-sdk";
 *
 * export default definePlugin({
 *   name: "Talk like a pirate",
 *   version: "1.0.0",
 *   config: {
 *     intensity: t.select(["light", "full"], { label: "Intensity", default: "full" }),
 *   },
 *   hooks: {
 *     onRequest(req, ctx) {
 *       // ctx.config.intensity is "light" | "full"
 *       return prependSystemPrompt(req, "Talk like a pirate. Arrr!");
 *     },
 *   },
 * });
 * ```
 */
export function definePlugin<C extends ConfigSchema>(def: PluginDefinition<C>): PluginDefinition<C> {
  return def;
}
