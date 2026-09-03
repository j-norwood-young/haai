# Live Operations Dashboard Redesign

## Goal

Turn `/` (Dashboard) into a best-of-breed live operations view: real-time in-flight requests, live throughput, backend fleet status (health history, concurrency, circuit breakers), and per-backend / per-model performance with percentiles. The Metrics page (`/analytics`) stays the historical/filterable analysis tool; the Dashboard deep-links into it.

## Decisions (resolved with user)

| Decision | Choice |
|---|---|
| Backend scope | Full: new in-memory live tracker, new SSE events, new endpoints |
| Short-term live history | Server-side ring buffer (10 min @ 1 s), lost on restart (acceptable) |
| Charts | Hand-rolled Svelte 5 SVG components. Do **not** use `layerchart`/`d3` |
| Dashboard vs Metrics | Dashboard = live ops + recent window (1h/6h/24h). Metrics = history. Deep-links Dashboard -> Metrics |
| Active requests | Per-request live progress (phase, elapsed, tokens, tok/s) |
| Perf breakdown | New `/metrics/breakdown` with p50/p95, tabs Backends / Virtual Models / Backend Models |
| Layout | Accepted (see "Page layout") |

Refinement to "per-request progress ~every 500ms": progress is delivered via a single aggregate `live-tick` SSE event every 1 s containing all in-flight rows, instead of one event per request per 500 ms. This bounds SSE volume to 1 event/s regardless of load while still giving per-request live counters. `request-start`/`request-end` are emitted immediately for instant feedback.

## Codebase facts the implementer must respect

- Monorepo: pnpm + turbo. Web = SvelteKit 2 / **Svelte 5 runes** / Tailwind v4. Proxy = Fastify 5. DB = SQLite via Drizzle.
- Strict TS with `exactOptionalPropertyTypes`: never assign `undefined` to an optional property; use `if (v != null) obj.x = v` or spread-conditional. See `.cursor/rules/check-ts-svelte.mdc`.
- Post-change checks (mandatory): `pnpm --filter @haai/web exec svelte-check --threshold error`, `pnpm --filter @haai/web exec tsc --noEmit`, `pnpm --filter @haai/proxy exec tsc --noEmit`.
- `AppContext` (`packages/proxy/src/context.ts`) is constructed in **two** places: `packages/proxy/src/index.ts:54` and `tests/e2e/src/helpers/proxy-server.ts:223`. Any new ctx field must be added to both.
- Existing SSE: server `packages/proxy/src/sse.ts` (`SseEventType` union, `broadcast`), client `apps/web/src/lib/sse.svelte.ts` (stores only `latestEvent`; the `SSE_EVENT_TYPES` allow-list drops unknown types). Consecutive events within one microtask overwrite `latestEvent`, so high-rate events need a callback subscription API (added below).
- Current Dashboard `apps/web/src/routes/+page.svelte` re-fetches on **every** SSE event with no dedupe. This is replaced.
- `usage_events` (`packages/core/src/db/schema.ts:145`) stores per request: `keyId, vmodelId, backendId, backendModelId, promptTokens, completionTokens, totalTokens, ttftMs, durationMs, tps, toolCallCount, statusCode, error, timestamp`. SQLite has no percentile function -> percentiles computed in JS from a narrow projection.
- Concurrency + circuit breakers live in memory on `ctx.balancer` (`packages/proxy/src/balancer.ts`) with no admin endpoint. `backends.maxConcurrency` is stored but not enforced (show it as capacity only).
- Health: `packages/proxy/src/health.ts` persists only the latest probe. `checkAndPersistBackendHealth` is called from `HealthMonitor.runChecks` (health.ts:206), `routes/api/backends.ts` (create/update/test). `HealthMonitor` is constructed in `index.ts:66` without ctx.
- Analytics page (`apps/web/src/routes/analytics/+page.svelte`) does not read URL query params yet (filters are `filterBackendId`, `filterVmodelId`, `filterModelId`, `filterKeyId`).
- Streaming token counting already happens per chunk in `packages/proxy/src/streaming-proxy.ts:163-197`.
- Embeddings route does not record usage and is **out of scope** for live tracking.

---

## Phase 1 — Proxy: live tracker, SSE events, endpoints

### 1.1 `packages/proxy/src/live-stats.ts` (new)

Pure, dependency-light class `LiveStatsTracker` (unit-testable, no DB).

```ts
export type RequestPhase = "connecting" | "waiting_first_token" | "streaming" | "buffering";

export interface InFlightRequest {
  id: string;                 // nanoid, generated at start
  keyPrefix: string;
  vmodelId: string | null;
  vmodelName: string;         // requestedModel
  backendId: string;
  backendName: string;
  backendModelId: string;
  stream: boolean;
  startedAt: number;          // epoch ms
  firstTokenAt: number | null;
  completionTokens: number;   // live counter
  attempt: number;            // 1 = first backend tried, 2+ = failover
}

export interface LivePoint {
  t: number;            // epoch ms, second-aligned
  completed: number;    // requests finished in this second
  errors: number;       // finished with status >= 400
  tokens: number;       // completion tokens streamed in this second (in-flight + completed)
  inFlight: number;     // sampled at tick
}

export interface ProbeSample { t: number; status: "healthy" | "degraded" | "unhealthy"; latencyMs: number }

export interface LiveSnapshot {
  now: number;
  startedAt: number;              // tracker (process) start
  inFlight: InFlightRequest[];    // capped at 50, oldest first
  inFlightTotal: number;
  series: LivePoint[];            // up to 600 points, oldest first
  backends: Array<{ backendId: string; concurrency: number; circuit: "closed" | "open" | "half-open"; probes: ProbeSample[] }>;
}
```

Behaviour:
- `start(req: Omit<InFlightRequest, "id" | "startedAt" | "firstTokenAt" | "completionTokens">): string` -> returns id, stores entry, emits `request-start` via injected `SseEmitter` with the entry.
- `firstToken(id)` sets `firstTokenAt` if null.
- `progress(id, completionTokensSoFar)` updates counter; adds delta to `tokensThisSecond`.
- `end(id, { statusCode, durationMs })` removes entry, increments `completedThisSecond` / `errorsThisSecond`, emits `request-end` `{ id, statusCode, durationMs, backendId }`.
- Ring buffer: fixed array of 600 `LivePoint`. A `setInterval` (1000 ms, `unref()`) pushes the current second's counters, resets them, then — only if `sse.clientCount > 0` — broadcasts `live-tick` `{ point: LivePoint, inFlight: InFlightRequest[] (cap 50), inFlightTotal, backends: [{backendId, concurrency, circuit}] }`. Concurrency/circuit come from an injected `BackendBalancer` (add `getCircuitState(backendId): CircuitState | "closed"` to balancer that returns `"closed"` when no breaker exists yet, and `getAllConcurrency(): Map<string, number>`).
- Orphan sweep on each tick: entries older than 10 min are force-ended with `statusCode: 0` (defensive).
- `recordProbe(backendId, sample)` keeps last 120 samples per backend.
- `snapshot(): LiveSnapshot`.
- `stop()` clears the interval.

Add to `AppContext`: `live: LiveStatsTracker`. Construct in `index.ts` and `tests/e2e/src/helpers/proxy-server.ts` (`new LiveStatsTracker(sse, balancer)`; call `ctx.live.start()`/`stop()` alongside health monitor and in e2e `stop`).

### 1.2 SSE event types

`packages/proxy/src/sse.ts`: extend `SseEventType` with `"request-start" | "request-end" | "live-tick"`.

### 1.3 Instrument the chat route

`packages/proxy/src/routes/v1/chat.ts` (loop at ~185-300):
- Before `streamingProxy` (line ~239): `const liveId = ctx.live.start({...})` with `attempt = spentKeys.size`, `stream = body.stream !== false`.
- Pass `onFirstToken: () => ctx.live.firstToken(liveId)` and `onProgress: (completionTokens) => ctx.live.progress(liveId, completionTokens)` to `streamingProxy`.
- Wrap in `try/finally`: `finally { ctx.balancer.decrementConcurrency(...); ctx.live.end(liveId, { statusCode: proxyResult?.statusCode ?? 0, durationMs }) }`. Moving `decrementConcurrency` into `finally` also fixes leaked concurrency on thrown errors.

`packages/proxy/src/streaming-proxy.ts`: add optional `onFirstToken?: () => void` and `onProgress?: (completionTokens: number) => void` to `ProxyRequestOptions`. Call `onFirstToken` where `ttft` is first set (line ~164) and after the non-streaming/buffered bodies are received; call `onProgress(completionTokens)` at the end of each chunk loop iteration (line ~197) and once at the end for non-streaming with the final count.

### 1.4 Health probe history

`health.ts` `checkAndPersistBackendHealth`: add `opts?.live?: LiveStatsTracker`; after computing `result`, call `opts.live.recordProbe(backend.id, { t: now, status: result.status, latencyMs: result.latencyMs })`. `HealthMonitor` constructor gets optional `live` param (6th) and passes it through in `runChecks`. Pass `ctx.live` from `index.ts:66` and from `routes/api/backends.ts` call sites.

### 1.5 Endpoints (`packages/proxy/src/routes/api/metrics-api.ts`)

All under the existing admin-auth hook (register in `metricsApiRoutes`).

**a) `GET /api/v1/metrics/live`** -> `ctx.live.snapshot()` enriched with `backendName` (join from `backends` table, use `displayName || name`) and `maxConcurrency` per backend, and `enabled`/`lastHealthStatus`.

**b) `GET /api/v1/metrics/breakdown?by=backend|vmodel|backendModel&since=<ms|iso>&keyId&vmodelId&backendId`**
- Default `since` = now - 24 h. Reject `by` outside the enum with 400.
- Query narrow projection from `usage_events`: `backendId, vmodelId, backendModelId, promptTokens, completionTokens, totalTokens, ttftMs, durationMs, tps, toolCallCount, statusCode, timestamp` with `usageEventFilterConditions`.
- Pure helper `aggregateBreakdown(rows, by, totalRequests)` (export for unit test) grouping on `backendId` / `vmodelId` / `backendId + "::" + backendModelId`. Per group:
  ```ts
  { key, backendId?, vmodelId?, backendModelId?, requests, share, errors, error_rate,
    prompt_tokens, completion_tokens, total_tokens, tool_calls,
    ttft_p50_ms?, ttft_p95_ms?, ttft_max_ms?, duration_p50_ms?, duration_p95_ms?,
    tps_avg?, tps_p50?, last_seen: number,
    sparkline: number[]  // requests per bucket, 24 equal buckets across [since, now]
  }
  ```
  Percentile = nearest-rank on sorted non-null values (`percentile(sorted, p)` helper, export it). Omit percentile fields when no samples (exactOptionalPropertyTypes).
- Resolve display names: backends `displayName || name`, vmodels `displayName || modelId`; unknown ids (deleted rows) -> `"(deleted)"`; null `vmodelId` -> key `"direct"`, name `"Direct"`.
- Sort by `requests` desc. Return `{ by, since, groups }`.

**c) Extend `GET /api/v1/metrics/summary`** (additive):
- Add `p50_ttft_ms, p95_ttft_ms, p50_duration_ms, p95_duration_ms, p50_tps` (same percentile helper; omit when no samples).
- Add `previous: { total_requests, total_tokens, error_rate, avg_ttft_ms?, avg_tps? }` computed over `[since - (now - since), since)` with the same filters. One extra query.
- Keep existing field names (`total_requests_24h`, etc.) for compatibility; they now mean "in the requested window".

**d) Extend `GET /api/v1/metrics/rollups`**: support `period=minute | 5min | 15min`. These always take the `events` path (`singleRollupDimension` returns `"events"` for sub-hour periods); extend `bucketStartIso` accordingly (`minute`: `setSeconds(0,0)`; `5min`/`15min`: floor minutes). Default `since` for sub-hour periods = now - `limit * bucketMs`. Also emit zero-filled buckets between `since` and now so charts don't skip gaps (only in events mode; implement `fillBuckets(period, sinceMs, nowMs)`).

**e) Extend `GET /api/v1/metrics/events`**: add query `errorsOnly=true` (`statusCode >= 400`), and add fields `backendId`, `backendName` (left join `backends`), `ttftMs`, `promptTokens`, `completionTokens` to the response. Also add `backendId`, `backendName`, `ttftMs`, `promptTokens`, `completionTokens` to the `usage-event` SSE payload in `usage-recorder.ts:85` (`RecordUsageOptions` needs `backendName?: string`; pass `selected.backend.displayName || selected.backend.name` from chat.ts).

### 1.6 Prometheus

No changes required. (Optional: `haai_inflight_requests` gauge from tracker; skip unless trivial.)

---

## Phase 2 — Web: shared infrastructure

### 2.1 SSE store (`apps/web/src/lib/sse.svelte.ts`)
- Add `'request-start' | 'request-end' | 'live-tick'` to `SSE_EVENT_TYPES`.
- Add `subscribe(handler: (ev: SseEvent) => void): () => void` — a `Set` of listeners invoked synchronously inside `dispatchParsed` **before** assigning `latestEvent` (no event loss). Return an unsubscribe function. Keep `latestEvent` for existing pages.
- Expose `reconnectCount` (increments each successful connect) so consumers can resync after a reconnect.

### 2.2 API client (`apps/web/src/lib/api.ts`)
Add types and methods (snake_case UI style as in the file):
- `LiveSnapshot`, `InFlightRequest`, `LivePoint`, `LiveBackend` (with `backend_name`, `max_concurrency?`, `probes`).
- `BreakdownBy = 'backend' | 'vmodel' | 'backendModel'`, `BreakdownGroup`, `BreakdownResponse`.
- `MetricsSummary`: add optional `p50_ttft_ms`, `p95_ttft_ms`, `p50_duration_ms`, `p95_duration_ms`, `p50_tps`, `previous?`.
- `MetricsRollupPeriod` add `'minute' | '5min' | '15min'`.
- `MetricsEvent`: add optional `backend_id`, `backend_name`, `ttft_ms`, `prompt_tokens`, `completion_tokens`; `parseMetricsEvent` maps them.
- Methods: `getLiveSnapshot()`, `getMetricsBreakdown({ by, since, ...filters })`, `getMetricsEvents({ ..., errorsOnly })`.

### 2.3 Formatting utils `apps/web/src/lib/format.ts` (new)
`formatNum` (K/M/B), `formatPct(ratio, digits=2)`, `formatMs(ms)` (`<1000 -> "798ms"`, else `"1.2s"`), `formatDuration(ms)` (elapsed `"12.4s"`, `"1m 03s"`), `formatRate(n, unit)`, `relativeTime(ts)` (`"3s ago"`), `deltaPct(current, previous) -> number | null`. Dashboard and (optionally) analytics/logs import from here instead of local copies.

### 2.4 Chart components `apps/web/src/lib/components/charts/` (new, SVG, Svelte 5 runes, no deps)
All: `viewBox`-based responsive SVG, `preserveAspectRatio="none"` where appropriate, `aria-label`, `role="img"`, respect `prefers-reduced-motion` (no transitions when set), colors via props defaulting to CSS vars/brand.

- `Sparkline.svelte` — props `values: number[]`, `color`, `height=28`, `fill=true` (gradient area under line), `strokeWidth=1.5`, optional `baseline` (draws dashed reference). Path built with a simple `buildLinePath(values, w, h)` util in `charts/path.ts` (export for reuse). Handles `values.length < 2` (draw flat line).
- `AreaChart.svelte` — multi-series time chart: props `series: Array<{ key, label, color, values: number[], axis?: 'left' | 'right' }>`, `timestamps: number[]`, `height=180`, `yFormat`, `xFormat`. Draws gridlines (4), left/right y labels (min/max/mid), x labels (first/mid/last), lines + gradient fills, a hover crosshair with a tooltip showing all series values at that index (`onpointermove` -> nearest index). Live mode: when `timestamps` update, no animation (avoid jitter).
- `BarChart.svelte` — props `buckets: Array<{ t: number; value: number; secondary?: number }>` (secondary = errors overlay drawn as red bar inside the primary), `color`, `height`, `yFormat`, `xFormat`; hover tooltip; click callback `onselect?(bucket)`.
- `UtilizationBar.svelte` — props `value`, `max?`, `label`, color thresholds (<60% brand, <85% warning, else error); if `max` is undefined show value only with indeterminate style.
- `StatusDot.svelte` — props `status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'`, `pulse?: boolean` (reuse `.pulse-dot`/`.health-dot--*` from `app.css`).

### 2.5 Live store `apps/web/src/lib/dashboard/live-state.svelte.ts` (new)
Module-level runes store so live data survives Dashboard remount within the SPA:
- State: `snapshot: LiveSnapshot | null`, `series: LivePoint[]` (ring capped 600), `inFlight: InFlightRequest[]`, `inFlightTotal`, `backends: Map<id, {concurrency, circuit, probes}>`, `recentEvents: MetricsEvent[]` (cap 200, from `usage-event`), `lastTickAt`.
- `init()`: fetch `api.getLiveSnapshot()` -> seed; subscribe to SSE: `live-tick` (push point, replace inFlight/backends), `request-start` (add optimistic row), `request-end` (remove row), `usage-event` (prepend to recentEvents), `backend-health` (with `backendId` + `status` + `latencyMs` -> push probe sample). On `sse.reconnectCount` change -> re-fetch snapshot to resync (in-flight rows may be stale after a disconnect). `destroy()` unsubscribes. Reference-counted so multiple mounts are safe.
- Derived helpers: `reqPerSec` (mean `completed` over last 10 points), `tokensPerSec` (mean `tokens` over last 5 points), `errorsPerMin` (sum errors over last 60), `openCircuits`, `uptimePct(backendId)` = healthy probes / probes.

---

## Phase 3 — Dashboard page

Rewrite `apps/web/src/routes/+page.svelte` as a thin composition; each section is a component under `apps/web/src/lib/components/dashboard/`. Preserve the `.page` container, `PageHeader` usage, `.card` styling, skeleton/error patterns. Add `data-testid` on every section root and key numbers.

Header: title "Dashboard", subtitle showing `Live · updated 2s ago` with a `StatusDot` reflecting `sse.connected` (green pulse = live, amber = reconnecting), plus a window toggle `1h | 6h | 24h` (segmented buttons, persisted to `localStorage['haai.dashboard.window']`, default `24h`). Window affects KPI cards, breakdown, volume chart, and recent errors — **not** the live strip / live throughput / active requests (always "now").

### Page layout (top to bottom)

1. **`LiveStatusStrip.svelte`** — single card, horizontal flex of 5 compact tiles, each with a mini `Sparkline` (last 60 points):
   - In-flight (count; pulse when > 0)
   - Req/s (10 s mean)
   - Tokens/s (5 s mean, violet)
   - Errors/min (red when > 0)
   - Fleet: `healthyCount/total backends` + `openCircuits` badge (red "1 open circuit") when any.
   Empty/cold state: dashes with subtitle "Waiting for traffic".

2. **KPI row — `KpiCard.svelte` x5** (`grid-cols-2 lg:grid-cols-5`): Requests, Tokens, Error rate, TTFT (shows `p50` large, `p95` small), TPS (`avg`, `p50` small). Each: icon (existing inline SVGs), label with window (`Requests · 24h`), big value in `tabular-nums`, delta chip vs `summary.previous` (`▲ 12%` green / `▼ 8%` red; for error rate and TTFT, **down is good** — invert colors; hide chip when previous is 0/undefined), and a `Sparkline` from rollups (`period` = `minute`/`5min`/`15min` for 1h/6h/24h) with values: requests, tokens, errors/requests per bucket, avg_latency_ms, and TPS unavailable per bucket -> use requests sparkline as fallback or omit sparkline. Clicking a KPI navigates to `/analytics`.

3. **Row: `LiveThroughputChart.svelte` (lg:col-span-2) + `ActiveRequestsPanel.svelte`**
   - Throughput: `AreaChart` over the 600-point live series with series `completed` (brand, left axis), `tokens` (violet, right axis), `inFlight` (amber dashed, left axis). Legend with toggles. Header shows "Last 10 minutes · 1s resolution". Empty-state until ≥2 points.
   - Active requests: list of `inFlight` rows (max 50, sorted by `startedAt` asc); each row: `StatusDot` pulse, `keyPrefix` mono, `vmodelName → backendName / backendModelId` (truncate with `title`), phase chip (`connecting` gray, `waiting for first token` amber, `streaming` brand, `buffering` violet), elapsed (`formatDuration(now - startedAt)`, ticking via a shared 250 ms `setInterval` in the component), `completionTokens` with live `tok/s` = `completionTokens / ((now - firstTokenAt)/1000)` when streaming, `attempt > 1` shows "failover ×N" chip. Rows fade in/out (CSS `@starting-style`/transition, disabled under reduced-motion). Empty state: "No requests in flight" with a subtle idle illustration (SVG). Footer: `inFlightTotal` if > 50: "+N more".

4. **Backend fleet — `BackendFleetCard.svelte` grid** (`grid-cols-1 md:grid-cols-2 xl:grid-cols-3`), one card per backend from `summary.backends` merged with live backend map:
   - Header: `StatusDot` + name + provider small + health badge (`badge-green/yellow/red/gray`), `disabled` badge when `!enabled`.
   - Probe latency `Sparkline` (last 120 probes, amber), current latency, uptime % over retained probes (`{n} probes`), last checked `relativeTime`.
   - `UtilizationBar` in-flight / `maxConcurrency` (label "Concurrency").
   - Circuit chip: `closed` (muted), `half-open` (amber), `open` (red, pulse).
   - Models loaded count (`availableModels.length`, from `api.getBackends()` fetched once + on `backend-health` events) — click opens existing `BackendModelsModal`.
   - Error text (if `error`) in red, truncated with `title`.
   - Actions: "Test" (calls `api.testBackend(id)` -> existing `POST /backends/:id/test`; show spinner), "Details" -> `/backends`, "Metrics" -> `/analytics?backendId=<id>`.

5. **`PerformanceBreakdown.svelte`** — card with tabs `Backends | Virtual Models | Backend Models` (persist tab to localStorage). Fetches `api.getMetricsBreakdown({ by, since })`. Sortable table (default requests desc; click header toggles; `aria-sort`), columns: Name (+ `StatusDot` for backends/vmodels when health known), Requests + share bar (inline horizontal bar scaled to max), Error rate (red if > 5%), Tokens (total; tooltip prompt/completion), TTFT p50 / p95, Duration p50 / p95, TPS avg, Tool calls, 24-bucket `Sparkline`, Last seen. Row click -> `/analytics?backendId=…` / `?vmodelId=…` / `?backendModelId=…&backendId=…`. Empty state per tab. Refresh on `usage-event` debounced 2 s (coalesce bursts).

6. **Bottom row: `RequestVolumeChart.svelte` (lg:col-span-2) + `RecentErrors.svelte`**
   - Volume: `BarChart` from the same rollups used by KPIs (window-dependent), `secondary = errors` overlay in red; tooltip shows requests, errors, tokens, avg latency; x labels from bucket timestamps. Title "Request volume · {window}".
   - Recent errors: `api.getMetricsEvents({ limit: 20, errorsOnly: true, since })` plus live prepend from `usage-event` with `status_code >= 400`. Row: time (`relativeTime`), status code chip, `vmodel → backend_name`, key prefix, error message truncated (full in `title`). Empty state: green check "No errors in the last {window}". Link "Open Live Logs" -> `/logs`.

### Data loading rules
- `load(window)` fetches in parallel: `getMetricsSummary({ since })`, `getMetricsRollups({ period, limit, since })`, `getMetricsBreakdown(...)`, `getMetricsEvents({ errorsOnly, limit: 20, since })`, `getBackends()`. Use a `loadSeq` guard like analytics. Keep previous data on screen during reloads (no flash to skeleton); show skeleton only on first load.
- Re-fetch triggers: window change (immediate); `usage-event` or `backend-health` SSE (debounced 2 s); a 60 s fallback interval when SSE is disconnected.
- Live sections consume `live-state` only; never refetch on `live-tick`.
- Remove the old "refetch on any SSE event" effect.

### UX/visual standards
- Use `font-variant-numeric: tabular-nums` (`tabular-nums` class) on all metrics so they don't jitter.
- Semantic colors stay consistent site-wide: brand/cyan = requests, violet = tokens, amber = latency/TTFT, emerald = throughput/good, red = errors. Health: green/yellow/red/gray as in `app.css`.
- Every card: `h2` title (`text-sm font-medium text-muted`), optional `InfoTip` explaining the metric (e.g. "p95 TTFT: 95% of requests received their first token faster than this").
- Skeleton, empty, and error states for every section; error banner keeps last good data visible with a "Retry" button.
- Keyboard accessible: tabs are `role="tablist"`, sortable headers are `<button>`s, rows with navigation are `<a>`s.
- No layout shift: fixed chart heights; sparkline containers fixed height.
- Reduced-motion: disable pulses/transitions via `@media (prefers-reduced-motion: reduce)` (add a global rule in `app.css` for `.pulse-dot` and dashboard transitions).

---

## Phase 4 — Metrics page deep links

`apps/web/src/routes/analytics/+page.svelte`: on mount, initialize `filterBackendId`, `filterVmodelId`, `filterModelId`, `filterKeyId` from `page.url.searchParams` (`backendId`, `vmodelId`, `backendModelId`, `keyId`) using `import { page } from '$app/state'`. Keep URL in sync when filters change (`replaceState` from `$app/navigation`) so links are shareable. No other Metrics changes.

---

## Phase 5 — Tests & docs

Backend unit (Vitest, `packages/proxy/src/`):
- `live-stats.test.ts`: start/progress/end lifecycle; ring buffer caps at 600 and second-alignment; `tokens` per second accumulates deltas; orphan sweep; `recordProbe` cap 120; `snapshot()` shape; tick emits `live-tick` only when `clientCount > 0` (mock emitter).
- `metrics-breakdown.test.ts`: `percentile()` nearest-rank cases (1 sample, even count, p95); `aggregateBreakdown()` grouping by each `by`, share sums to 1, omitted percentile fields when no TTFT samples, `direct` group for null vmodelId, sparkline bucket count = 24.

E2E (`tests/e2e/src/metrics-api.test.ts` or new `live-metrics.test.ts`): seed with `insertUsageEvent`, then assert
- `/metrics/summary` includes `p50_ttft_ms`, `p95_ttft_ms`, `previous`.
- `/metrics/breakdown?by=backend` returns groups with names and percentiles; `by=bogus` -> 400.
- `/metrics/rollups?period=minute&limit=10` returns 10 zero-filled buckets.
- `/metrics/events?errorsOnly=true` returns only status >= 400 and includes `backendId`.
- `/metrics/live` returns `series`, `inFlight: []`, `backends[].circuit === "closed"`.
- Streaming spec (`streaming.test.ts`): open SSE to `/api/v1/events`, fire a streaming chat request through the mock backend, assert `request-start` then `request-end` arrive with matching `id`, and that `/metrics/live` shows `inFlight` empty afterwards.

Playwright (`tests/playwright/dashboard.spec.ts`, new): dashboard renders `data-testid="live-status-strip"`, `kpi-requests`, `live-throughput`, `active-requests`, `backend-fleet`, `perf-breakdown`, `request-volume`, `recent-errors`; window toggle changes KPI label text; breakdown tab switch updates table; a backend card "Metrics" link navigates to `/analytics?backendId=`.

Docs: update `docs/api/rest.md` with `/metrics/live`, `/metrics/breakdown`, new summary/rollups/events fields, and the three new SSE event types.

---

## Ordered task list

1. Proxy: `live-stats.ts` + unit tests; extend `SseEventType`; add `live` to `AppContext` in `index.ts` and e2e `proxy-server.ts`; balancer `getCircuitState`/`getAllConcurrency`.
2. Proxy: `streaming-proxy.ts` callbacks; `chat.ts` instrumentation with `try/finally`; `usage-recorder.ts` extra SSE fields.
3. Proxy: health probe history plumbing (`health.ts`, `backends.ts`, `index.ts`).
4. Proxy: `metrics-api.ts` — `/live`, `/breakdown` (+ helpers + unit tests), summary percentiles/previous, sub-hour rollups with zero-fill, events `errorsOnly` + fields. `pnpm --filter @haai/proxy exec tsc --noEmit`.
5. E2E tests for step 4 + SSE lifecycle. `pnpm --filter @haai/e2e test`.
6. Web infra: `sse.svelte.ts` subscribe/reconnectCount; `api.ts` types/methods; `format.ts`; chart components; `live-state.svelte.ts`.
7. Web: dashboard components (strip, KPI, throughput, active requests, fleet, breakdown, volume, recent errors) and `+page.svelte` composition; `app.css` reduced-motion rule.
8. Web: analytics deep-link params.
9. `pnpm --filter @haai/web exec svelte-check --threshold error` and `tsc --noEmit`; Playwright `dashboard.spec.ts`.
10. Docs `docs/api/rest.md`.

## Validation

- `pnpm --filter @haai/proxy exec tsc --noEmit`, `pnpm --filter @haai/web exec tsc --noEmit`, `pnpm --filter @haai/web exec svelte-check --threshold error`
- `pnpm --filter @haai/proxy test`, `pnpm --filter @haai/e2e test`, `pnpm --filter @haai/playwright test:playwright`
- Manual: `pnpm dev`; run several concurrent streaming requests against a v-model; confirm Active Requests rows appear instantly, token counters tick, throughput chart moves each second, strip counters update; stop the proxy -> UI shows "Reconnecting"; restart -> live series resets, in-flight list resyncs; disable a backend -> fleet card shows disabled; kill a backend -> health flips, probe sparkline shows failures, uptime drops, circuit opens after 5 failed requests.

## Risks / edge cases

- **SSE volume**: bounded to `live-tick` 1/s + `request-start/end` per request (same order as existing `usage-event`). Do not emit per-chunk events.
- **Event loss in Svelte batching**: solved by `sse.subscribe` callbacks; do not rely on `latestEvent` for live data.
- **Stale in-flight rows** after disconnect: resync via snapshot on reconnect + server orphan sweep.
- **Clock skew**: elapsed uses client `Date.now()` vs server `startedAt`; acceptable for a same-host admin UI. Clamp negatives to 0.
- **Large windows**: breakdown/summary load all events in-window into memory (existing pattern). 24 h max on the Dashboard keeps this bounded; do not add 7d here.
- **Deleted backends/vmodels** still appear in breakdown as "(deleted)".
- **`maxConcurrency` not enforced**: label the bar "of configured max"; if null, show count only.
- **Embeddings** are not tracked (no usage recording today) — out of scope; note in docs.
- Percentiles with few samples are noisy; show `n` in tooltip (`based on 7 requests`).
