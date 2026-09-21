import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { adminJson } from "./helpers/seed.js";

type KeyRow = Record<string, unknown> & { id: string };

/** Every persisted, user-configurable setting on an API key (non-default values). */
const FULL_SETTINGS = {
  name: "persist-all",
  enabled: false,
  expiresAt: Date.now() + 30 * 86_400_000,
  allowedModels: ["vm-a", "vm-b"],
  allowedBackends: ["backend-a"],
  allowToolCalling: false,
  allowVision: true,
  allowEmbeddings: true,
  rateLimitRpm: 42,
  tokenBudgetHour: 1_000,
  tokenBudgetDay: 20_000,
  tokenBudgetWeek: 300_000,
  tokenBudgetMonth: 4_000_000,
  logRequests: false,
};

describe("API key settings persistence", () => {
  let proxy: TestProxy;

  beforeAll(async () => {
    proxy = await startTestProxy();
  });

  afterAll(async () => {
    await proxy.stop();
  });

  async function createKey(body: Record<string, unknown>): Promise<KeyRow> {
    const res = await adminJson(proxy, "POST", "/api/v1/keys", body);
    expect(res.status).toBe(201);
    return (await res.json()) as KeyRow;
  }

  async function getKey(id: string): Promise<KeyRow> {
    const res = await adminJson(proxy, "GET", `/api/v1/keys/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as KeyRow;
  }

  async function patchKey(id: string, body: Record<string, unknown>): Promise<Response> {
    return adminJson(proxy, "PATCH", `/api/v1/keys/${id}`, body);
  }

  /** The stored form of `FULL_SETTINGS` (allow-lists are JSON-encoded). */
  function expectedStored(settings: Partial<typeof FULL_SETTINGS>): Record<string, unknown> {
    const { allowedModels, allowedBackends, ...rest } = settings;
    const out: Record<string, unknown> = { ...rest };
    if (allowedModels !== undefined) out["allowedModels"] = JSON.stringify(allowedModels);
    if (allowedBackends !== undefined) out["allowedBackends"] = JSON.stringify(allowedBackends);
    return out;
  }

  it("persists every setting supplied at creation", async () => {
    const created = await createKey(FULL_SETTINGS);
    expect(created).toMatchObject(expectedStored(FULL_SETTINGS));

    const fetched = await getKey(created.id);
    expect(fetched).toMatchObject(expectedStored(FULL_SETTINGS));

    const list = (await (await adminJson(proxy, "GET", "/api/v1/keys")).json()) as KeyRow[];
    expect(list.find((k) => k.id === created.id)).toMatchObject(expectedStored(FULL_SETTINGS));
  });

  it("applies sensible defaults when nothing is supplied", async () => {
    const created = await createKey({ name: "defaults" });
    const fetched = await getKey(created.id);
    expect(fetched).toMatchObject({
      name: "defaults",
      enabled: true,
      suspended: false,
      expiresAt: null,
      allowedModels: null,
      allowedBackends: null,
      allowToolCalling: true,
      allowVision: false,
      allowEmbeddings: false,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
      logRequests: true,
    });
  });

  it("persists an update to every setting", async () => {
    const created = await createKey({ name: "before" });
    const res = await patchKey(created.id, FULL_SETTINGS);
    expect(res.status).toBe(200);
    expect(await getKey(created.id)).toMatchObject(expectedStored(FULL_SETTINGS));
  });

  it("leaves every other setting untouched when one field is updated", async () => {
    const created = await createKey(FULL_SETTINGS);

    const updates: Array<Partial<typeof FULL_SETTINGS>> = [
      { name: "renamed" },
      { enabled: true },
      { expiresAt: FULL_SETTINGS.expiresAt + 86_400_000 },
      { allowedModels: ["vm-c"] },
      { allowedBackends: ["backend-b", "backend-c"] },
      { allowToolCalling: true },
      { allowVision: false },
      { allowEmbeddings: false },
      { rateLimitRpm: 7 },
      { tokenBudgetHour: 1 },
      { tokenBudgetDay: 2 },
      { tokenBudgetWeek: 3 },
      { tokenBudgetMonth: 4 },
      { logRequests: true },
    ];

    let expected: Partial<typeof FULL_SETTINGS> = { ...FULL_SETTINGS };
    for (const update of updates) {
      expected = { ...expected, ...update };
      const res = await patchKey(created.id, update);
      expect(res.status, JSON.stringify(update)).toBe(200);
      expect(await getKey(created.id), JSON.stringify(update)).toMatchObject(
        expectedStored(expected),
      );
    }
  });

  it("clears nullable settings when they are set to null", async () => {
    const created = await createKey(FULL_SETTINGS);
    const res = await patchKey(created.id, {
      expiresAt: null,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
    });
    expect(res.status).toBe(200);
    expect(await getKey(created.id)).toMatchObject({
      name: FULL_SETTINGS.name,
      expiresAt: null,
      rateLimitRpm: null,
      tokenBudgetHour: null,
      tokenBudgetDay: null,
      tokenBudgetWeek: null,
      tokenBudgetMonth: null,
    });
  });

  it("accepts the snake_case aliases used by the CLI and older clients", async () => {
    const expiresAt = Date.now() + 86_400_000;
    const created = await createKey({
      name: "snake",
      rpm_limit: 11,
      day_budget: 22,
      expires_at: expiresAt,
      allowed_models: ["vm-a"],
      allowed_backends: [],
    });
    expect(await getKey(created.id)).toMatchObject({
      rateLimitRpm: 11,
      tokenBudgetDay: 22,
      expiresAt,
      allowedModels: '["vm-a"]',
      allowedBackends: "[]",
    });

    await patchKey(created.id, {
      rpm_limit: 12,
      day_budget: 23,
      expires_at: null,
      allowed_models: null,
      allowed_backends: ["backend-a"],
    });
    expect(await getKey(created.id)).toMatchObject({
      rateLimitRpm: 12,
      tokenBudgetDay: 23,
      expiresAt: null,
      allowedModels: null,
      allowedBackends: '["backend-a"]',
    });
  });

  describe("allow-lists distinguish All / Specific / None", () => {
    const fields = [
      { camel: "allowedBackends", other: "allowedModels", label: "pass-through backends" },
      { camel: "allowedModels", other: "allowedBackends", label: "v-models" },
    ] as const;

    for (const { camel, other, label } of fields) {
      it(`keeps ${label} = None ([]) distinct from All (null) on create and update`, async () => {
        // "None" for this list needs the *other* list to stay open (key must reach some model).
        const created = await createKey({ name: `none-${label}`, [camel]: [] });
        expect(created[camel]).toBe("[]");
        expect((await getKey(created.id))[camel]).toBe("[]");
        expect((await getKey(created.id))[other]).toBeNull();

        // An unrelated update must not disturb it.
        await patchKey(created.id, { name: "renamed" });
        expect((await getKey(created.id))[camel]).toBe("[]");

        // None -> Specific
        await patchKey(created.id, { [camel]: ["x", "y"] });
        expect((await getKey(created.id))[camel]).toBe('["x","y"]');

        // Specific -> None
        await patchKey(created.id, { [camel]: [] });
        expect((await getKey(created.id))[camel]).toBe("[]");

        // None -> All
        const res = await patchKey(created.id, { [camel]: null });
        expect(res.status).toBe(200);
        expect((await getKey(created.id))[camel]).toBeNull();
      });
    }

    it("rejects a key that would have no model access at all", async () => {
      const res = await adminJson(proxy, "POST", "/api/v1/keys", {
        name: "nothing",
        allowedModels: [],
        allowedBackends: [],
      });
      expect(res.status).toBe(400);

      const created = await createKey({ name: "guarded", allowedModels: [] });
      const patch = await patchKey(created.id, { allowedBackends: [] });
      expect(patch.status).toBe(400);
      expect((await getKey(created.id))["allowedBackends"]).toBeNull();
    });
  });

  it("does not expose the key hash or encrypted secret", async () => {
    const created = await createKey({ name: "public" });
    const fetched = await getKey(created.id);
    expect(fetched).not.toHaveProperty("keyHash");
    expect(fetched).not.toHaveProperty("encryptedKey");
    expect(fetched["retrievable"]).toBe(true);
  });

  it("keeps settings intact across suspend and resume", async () => {
    const created = await createKey(FULL_SETTINGS);
    await adminJson(proxy, "POST", `/api/v1/keys/${created.id}/suspend`, { reason: "audit" });
    expect(await getKey(created.id)).toMatchObject({
      ...expectedStored(FULL_SETTINGS),
      suspended: true,
      suspendedReason: "audit",
    });

    await adminJson(proxy, "POST", `/api/v1/keys/${created.id}/resume`, {});
    expect(await getKey(created.id)).toMatchObject({
      ...expectedStored(FULL_SETTINGS),
      suspended: false,
      suspendedReason: null,
    });
  });
});
