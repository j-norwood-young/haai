import { test, expect } from "@playwright/test";

test.describe("metrics time span", () => {
  test("changing period updates summary window and chart data", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
    await expect(page.getByTestId("metrics-window-label")).toHaveText("48 hours");

    const hourRequests = await page.getByTestId("metrics-total-requests").textContent();
    const hourRange = await page.getByTestId("metrics-chart-range").textContent();
    expect(hourRequests).toBeTruthy();
    expect(hourRange).toBeTruthy();

    await page.getByTestId("period-day").click();
    await expect(page.getByTestId("metrics-window-label")).toHaveText("48 days");
    await expect(page.getByTestId("metrics-total-requests")).not.toHaveText(hourRequests ?? "");
    await expect(page.getByTestId("metrics-chart-range")).not.toHaveText(hourRange ?? "");

    await page.getByTestId("period-week").click();
    await expect(page.getByTestId("metrics-window-label")).toHaveText("48 weeks");

    await page.getByTestId("period-month").click();
    await expect(page.getByTestId("metrics-window-label")).toHaveText("48 months");

    await page.getByTestId("period-hour").click();
    await expect(page.getByTestId("metrics-window-label")).toHaveText("48 hours");
  });
});
