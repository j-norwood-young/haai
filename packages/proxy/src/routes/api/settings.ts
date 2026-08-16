import type { FastifyInstance } from "fastify";
import { getApiKeysShowOnce, setSetting, SETTING_API_KEYS_SHOW_ONCE } from "@haai/core";
import type { AppContext } from "../../context.js";
import { requireAdmin, requireAuth } from "../../auth-session.js";

export async function settingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/v1/settings", async (req, reply) => {
    const user = await requireAuth(ctx, req, reply);
    if (!user) return;

    const apiKeysShowOnce = await getApiKeysShowOnce(ctx.db);

    return {
      apiKeys: {
        showOnce: apiKeysShowOnce,
      },
    };
  });

  app.patch<{ Body: { apiKeys?: { showOnce?: boolean } } }>(
    "/api/v1/settings",
    async (req, reply) => {
      const user = await requireAdmin(ctx, req, reply);
      if (!user) return;

      const showOnce = req.body.apiKeys?.showOnce;
      if (showOnce === undefined) {
        return reply.status(400).send({ error: "No settings to update" });
      }

      await setSetting(ctx.db, SETTING_API_KEYS_SHOW_ONCE, showOnce ? "true" : "false");

      return {
        apiKeys: {
          showOnce,
        },
      };
    },
  );
}
