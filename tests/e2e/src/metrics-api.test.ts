import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { startTestProxy, type TestProxy } from "./helpers/proxy-server.js";
import { insertUsageEvent, insertRollup, adminJson } from "./helpers/seed.js";

describe("metrics period windows", () => {
  let proxy: TestProxy;

  beforeAll(async () => {
    proxy = await startTestProxy();
    const now = Date.now();

    insertUsageEvent(proxy, { timestamp: now - 2 * 3600 * 1000, totalTokens: 11 });
    insertUsageEvent(proxy, { timestamp: now - 3 * 86400 * 1000, totalTokens: 22 });
    insertUsageEvent(proxy, { timestamp: now - 10 * 86400 * 1000, totalTokens: 33 });

    const hourBucket = new Date(now);
    hourBucket.setMinutes(0, 0, 0);
    insertRollup(proxy, {
      period: "hour",
      bucket: hourBucket.toISOString(),
      requestCount: 7,
    });

    const dayBucket = new Date(now);
    dayBucket.setHours(0, 0, 0, 0);
    insertRollup(proxy, {
      period: "day",
      bucket: dayBucket.toISOString(),
      requestCount: 42,
    });

    const weekBucket = new Date(now);
    weekBucket.setDate(weekBucket.getDate() - weekBucket.getDay());
    weekBucket.setHours(0, 0, 0, 0);
    insertRollup(proxy, {
      period: "week",
      bucket: weekBucket.toISOString(),
      requestCount: 90,
    });

    const monthBucket = new Date(now);
    monthBucket.setDate(1);
    monthBucket.setHours(0, 0, 0, 0);
    insertRollup(proxy, {
      period: "month",
      bucket: monthBucket.toISOString(),
      requestCount: 200,
    });
  });

  afterAll(async () => {
    await proxy.stop();
  });

  it("returns distinct rollup series per period", async () => {
    const hour = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=hour&limit=48");
    const day = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=day&limit=48");
    const week = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=week&limit=48");
    const month = await adminJson(proxy, "GET", "/api/v1/metrics/rollups?period=month&limit=48");

    expect(hour.status).toBe(200);
    expect(day.status).toBe(200);
    expect(week.status).toBe(200);
    expect(month.status).toBe(200);

    const hourRows = (await hour.json()) as Array<{ requests: number }>;
    const dayRows = (await day.json()) as Array<{ requests: number }>;
    const weekRows = (await week.json()) as Array<{ requests: number }>;
    const monthRows = (await month.json()) as Array<{ requests: number }>;

    expect(hourRows.some((r) => r.requests === 7)).toBe(true);
    expect(dayRows.some((r) => r.requests === 42)).toBe(true);
    expect(weekRows.some((r) => r.requests === 90)).toBe(true);
    expect(monthRows.some((r) => r.requests === 200)).toBe(true);
    expect(hourRows.some((r) => r.requests === 42)).toBe(false);
  });

  it("summary since window changes request totals", async () => {
    const lastHour = await adminJson(
      proxy,
      "GET",
      `/api/v1/metrics/summary?since=${new Date(Date.now() - 3600 * 1000).toISOString()}`,
    );
    const lastWeek = await adminJson(
      proxy,
      "GET",
      `/api/v1/metrics/summary?since=${new Date(Date.now() - 14 * 86400 * 1000).toISOString()}`,
    );
    expect(lastHour.status).toBe(200);
    expect(lastWeek.status).toBe(200);

    const hourSummary = (await lastHour.json()) as { total_requests_24h: number };
    const weekSummary = (await lastWeek.json()) as { total_requests_24h: number };
    expect(weekSummary.total_requests_24h).toBeGreaterThan(hourSummary.total_requests_24h);
  });
});
