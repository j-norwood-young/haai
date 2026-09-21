import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { nanoid } from "nanoid";

const KEY_PREFIX = "pw-connect-";

type Section = "Virtual models" | "Pass-through backends";

async function setNone(page: Page, heading: Section) {
  const picker = page.getByText(heading, { exact: true }).locator("xpath=..").locator("xpath=..");
  await picker.getByRole("button", { name: "None", exact: true }).click();
}

/** Creates a key (optionally restricting a section to None) and opens its Connect modal. */
async function openConnect(page: Page, none: Section[] = []) {
  const name = `${KEY_PREFIX}${nanoid(6)}`;
  await page.goto("/keys/new");
  await page.fill("#new-key-name", name);
  for (const section of none) await setNone(page, section);
  await page.getByRole("button", { name: "Create Key" }).click();
  await expect(page.getByText(/Key created/)).toBeVisible();

  await page.goto("/keys");
  await page.locator("tr", { hasText: name }).getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("dialog", { name: "Connect with this key" })).toBeVisible();
  await expect(page.getByTestId("connect-example")).toBeVisible();
}

test.describe("API key Connect modal", () => {
  let api: APIRequestContext;

  test.beforeAll(async ({ playwright, baseURL }, testInfo) => {
    api = await playwright.request.newContext({
      baseURL: baseURL!,
      storageState: testInfo.project.use.storageState as string,
    });
  });

  // Every test creates a key; remove them so the shared instance (and its keys table) stays small.
  test.afterAll(async () => {
    const res = await api.get("/api/v1/keys");
    const keys = (await res.json()) as Array<{ id: string; name: string }>;
    for (const key of keys.filter((k) => k.name.startsWith(KEY_PREFIX))) {
      await api.delete(`/api/v1/keys/${key.id}`);
    }
    await api.dispose();
  });

  test("shows chat examples in each language", async ({ page }) => {
    await openConnect(page);
    const example = page.getByTestId("connect-example");

    await expect(page.getByTestId("connect-lang-haai")).toHaveAttribute("aria-selected", "true");
    await expect(example).toContainText("haai prompt");

    await page.getByTestId("connect-lang-curl").click();
    await expect(example).toContainText("curl");
    await expect(example).toContainText("/v1/chat/completions");

    await page.getByTestId("connect-lang-javascript").click();
    await expect(example).toContainText("await fetch(");

    await page.getByTestId("connect-lang-python").click();
    await expect(example).toContainText("import requests");
  });

  test("the model dropdown changes the model in the example immediately", async ({ page }) => {
    await openConnect(page);
    const example = page.getByTestId("connect-example");
    const model = page.getByLabel("Model", { exact: true });

    await page.getByTestId("connect-lang-javascript").click();
    await model.selectOption("pw-chat");
    await expect(example).toContainText('model: "pw-chat"');

    await model.selectOption("pw-plugins-chat");
    await expect(example).toContainText('model: "pw-plugins-chat"');
    await expect(example).not.toContainText("pw-chat");

    // The choice carries across languages.
    await page.getByTestId("connect-lang-python").click();
    await expect(example).toContainText('"model": "pw-plugins-chat"');
    await page.getByTestId("connect-lang-haai").click();
    await expect(example).toContainText('-m "pw-plugins-chat"');
  });

  test("Endpoint, Model and the example live together in a sandbox below the API key", async ({
    page,
  }) => {
    await openConnect(page);
    const dialog = page.getByRole("dialog");
    const sandbox = page.getByTestId("connect-sandbox");

    await expect(dialog.getByText("Endpoint URL")).toHaveCount(0);

    // Everything you tweak, and the code it produces, is inside one card.
    await expect(sandbox.getByLabel("Model", { exact: true })).toBeVisible();
    await expect(sandbox.getByRole("group", { name: "Endpoint" })).toBeVisible();
    await expect(sandbox.getByRole("tablist", { name: "Example language" })).toBeVisible();
    await expect(sandbox.getByTestId("connect-example")).toBeVisible();

    // The connection details it builds on stay outside, above it.
    await expect(sandbox.getByText("API key", { exact: true })).toHaveCount(0);
    await expect(sandbox.getByText("Base URL", { exact: true })).toHaveCount(0);

    const text = await dialog.innerText();
    const order = ["Base URL", "API key", "Endpoint", "Model"].map((label) => text.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
  });

  test("Models endpoint has a haai command and hides the model dropdown", async ({ page }) => {
    await openConnect(page);
    const example = page.getByTestId("connect-example");

    await page.getByTestId("connect-op-models").click();
    await expect(page.getByLabel("Model", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("connect-lang-haai")).toBeEnabled();
    await expect(page.getByTestId("connect-lang-haai")).toHaveAttribute("aria-selected", "true");
    await expect(example).toContainText("haai models");

    await page.getByTestId("connect-lang-curl").click();
    await expect(example).toContainText("/v1/models");
    await expect(example).not.toContainText("-d ");

    await page.getByTestId("connect-lang-python").click();
    await expect(example).toContainText("requests.get(");

    await page.getByTestId("connect-op-chat").click();
    await expect(page.getByLabel("Model", { exact: true })).toBeVisible();
  });

  test("Embeddings offers only embedding models and has no haai command", async ({ page }) => {
    await openConnect(page);
    const example = page.getByTestId("connect-example");
    const model = page.getByLabel("Model", { exact: true });

    await page.getByTestId("connect-op-embeddings").click();
    // The embedding v-model, then the embedding model exposed by the pass-through backend.
    await expect(model.locator("option")).toHaveText([
      /pw-embed/,
      /^pw-embed-model:pw-host:/,
    ]);
    await expect(page.getByTestId("connect-lang-haai")).toBeDisabled();
    // haai was selected but can't do embeddings, so the example falls back to curl.
    await expect(page.getByTestId("connect-lang-curl")).toHaveAttribute("aria-selected", "true");
    await expect(example).toContainText("/v1/embeddings");
    await expect(example).toContainText('"model":"pw-embed"');

    // Back on Chat: the embedding model isn't offered, and the haai choice returns.
    await page.getByTestId("connect-op-chat").click();
    await expect(model.locator("option", { hasText: "pw-embed" })).toHaveCount(0);
    await expect(page.getByTestId("connect-lang-haai")).toHaveAttribute("aria-selected", "true");
  });

  test("offers pass-through backend models, grouped apart from v-models", async ({ page }) => {
    await openConnect(page);
    const model = page.getByLabel("Model", { exact: true });

    await expect(model.locator('optgroup[label="Virtual models"]')).toHaveCount(1);
    await expect(model.locator('optgroup[label="Pass-through backends"] option')).toHaveText([
      /^pw-model:pw-host:/,
    ]);

    await page.getByTestId("connect-op-embeddings").click();
    await expect(model.locator('optgroup[label="Pass-through backends"] option')).toHaveText([
      /^pw-embed-model:pw-host:/,
    ]);
  });

  test("a key with no v-models but pass-through backends can use a pass-through embedding model", async ({
    page,
  }) => {
    await openConnect(page, ["Virtual models"]);
    const model = page.getByLabel("Model", { exact: true });
    const example = page.getByTestId("connect-example");

    await expect(model.locator('optgroup[label="Virtual models"]')).toHaveCount(0);
    await expect(model.locator("option")).toHaveText([/^pw-model:pw-host:/]);

    await page.getByTestId("connect-op-embeddings").click();
    await expect(page.getByText(/No embedding models are available/)).toHaveCount(0);
    await expect(model.locator("option")).toHaveText([/^pw-embed-model:pw-host:/]);
    await expect(example).toContainText("/v1/embeddings");
    await expect(example).toContainText("pw-embed-model:pw-host:");
  });

  test("a key with no pass-through backends only offers v-models", async ({ page }) => {
    await openConnect(page, ["Pass-through backends"]);
    const model = page.getByLabel("Model", { exact: true });

    await expect(model.locator('optgroup[label="Pass-through backends"]')).toHaveCount(0);
    await page.getByTestId("connect-op-embeddings").click();
    await expect(model.locator("option")).toHaveText([/pw-embed/]);
    await expect(page.getByTestId("connect-example")).not.toContainText("pw-host");
  });
});
