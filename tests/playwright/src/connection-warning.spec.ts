import { test, expect } from "@playwright/test";

test.describe("connection warning", () => {
	test("clears once the server is reachable again", async ({ page }) => {
		// Model the server being unreachable: the event stream hangs and the
		// liveness probe fails. While down, the client polls /health; recovery
		// must be detected by that poll, not by the stalled stream.
		let up = false;
		await page.route("**/api/v1/events", (route) => {
			if (up) return route.continue();
			return Promise.withResolvers<void>().promise;
		});
		await page.route(
			(url) => url.pathname === "/health",
			(route) => (up ? route.continue() : route.abort())
		);

		await page.goto("/");
		const warning = page.getByTestId("connection-warning");
		await expect(warning).toBeVisible();

		up = true;
		await expect(warning).toBeHidden({ timeout: 30_000 });
	});
});
