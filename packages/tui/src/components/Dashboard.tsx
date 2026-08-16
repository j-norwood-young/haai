import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface Backend {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  lastHealthStatus?: string;
  lastLatencyMs?: number;
  enabled: boolean;
}

interface MetricsSummary {
  totalRequests: number;
  totalTokens: number;
  errorRate: number;
  avgTtftMs: number;
  avgTps: number;
}

interface DashboardProps {
  baseUrl: string;
}

type Tab = "backends" | "metrics" | "help";

export function Dashboard({ baseUrl }: DashboardProps): React.ReactElement {
  const { exit } = useApp();
  const [tab, setTab] = useState<Tab>("backends");
  const [backends, setBackends] = useState<Backend[]>([]);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(async () => {
    try {
      const [backendsRes, metricsRes] = await Promise.allSettled([
        fetch(`${baseUrl}/api/v1/backends`).then((r) => r.json()),
        fetch(`${baseUrl}/api/v1/metrics/summary`).then((r) => r.json()),
      ]);

      if (backendsRes.status === "fulfilled") {
        setBackends(backendsRes.value as Backend[]);
      }
      if (metricsRes.status === "fulfilled") {
        setMetrics(metricsRes.value as MetricsSummary);
      }
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(`Cannot reach proxy at ${baseUrl}`);
    }
  }, [baseUrl]);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useInput((input, key) => {
    if (input === "q" || key.escape) exit();
    if (input === "1") setTab("backends");
    if (input === "2") setTab("metrics");
    if (input === "?") setTab("help");
    if (input === "r") void fetchData();
  });

  const healthColor = (status?: string) => {
    if (status === "healthy") return "green";
    if (status === "degraded") return "yellow";
    return "red";
  };

  return React.createElement(
    Box,
    { flexDirection: "column", padding: 1 },
    // Header
    React.createElement(
      Box,
      { borderStyle: "round", borderColor: "cyan", padding: 1, marginBottom: 1 },
      React.createElement(Text, { bold: true, color: "cyan" }, "🤖 haai proxy dashboard"),
      React.createElement(Text, { dimColor: true }, `  ${baseUrl}`),
      React.createElement(Text, { dimColor: true }, `  Refreshed: ${lastRefresh.toLocaleTimeString()}`),
    ),
    // Error banner
    error
      ? React.createElement(
          Box,
          { borderStyle: "single", borderColor: "red", marginBottom: 1 },
          React.createElement(Text, { color: "red" }, `⚠ ${error}`),
        )
      : null,
    // Tabs
    React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(Text, { color: tab === "backends" ? "cyan" : "gray" }, "[1] Backends  "),
      React.createElement(Text, { color: tab === "metrics" ? "cyan" : "gray" }, "[2] Metrics  "),
      React.createElement(Text, { color: tab === "help" ? "cyan" : "gray" }, "[?] Help"),
    ),
    // Content
    tab === "backends" &&
      React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, `Backends (${backends.length})`),
        React.createElement(Text, null, ""),
        backends.length === 0
          ? React.createElement(Text, { dimColor: true }, "  No backends configured")
          : backends.map((b) =>
              React.createElement(
                Box,
                { key: b.id, marginLeft: 2 },
                React.createElement(
                  Text,
                  { color: healthColor(b.lastHealthStatus) },
                  `● `,
                ),
                React.createElement(Text, { bold: true }, b.displayName),
                React.createElement(Text, { dimColor: true }, `  ${b.provider}  `),
                React.createElement(
                  Text,
                  { color: healthColor(b.lastHealthStatus) },
                  b.lastHealthStatus ?? "unknown",
                ),
                b.lastLatencyMs
                  ? React.createElement(Text, { dimColor: true }, `  ${b.lastLatencyMs}ms`)
                  : null,
              ),
            ),
      ),
    tab === "metrics" &&
      metrics &&
      React.createElement(
        Box,
        { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Last 24h metrics"),
        React.createElement(Text, null, ""),
        React.createElement(
          Box,
          { flexDirection: "column", marginLeft: 2 },
          React.createElement(Text, null, `Requests:   ${metrics.totalRequests.toLocaleString()}`),
          React.createElement(Text, null, `Tokens:     ${metrics.totalTokens.toLocaleString()}`),
          React.createElement(
            Text,
            { color: metrics.errorRate > 0.1 ? "red" : "green" },
            `Error rate: ${(metrics.errorRate * 100).toFixed(1)}%`,
          ),
          React.createElement(Text, null, `Avg TTFT:   ${metrics.avgTtftMs.toFixed(0)}ms`),
          React.createElement(Text, null, `Avg TPS:    ${metrics.avgTps.toFixed(1)}`),
        ),
      ),
    tab === "help" &&
      React.createElement(
        Box,
        { flexDirection: "column", marginLeft: 2 },
        React.createElement(Text, { bold: true }, "Keyboard shortcuts"),
        React.createElement(Text, null, ""),
        React.createElement(Text, null, "  1     Show backends"),
        React.createElement(Text, null, "  2     Show metrics"),
        React.createElement(Text, null, "  r     Refresh data"),
        React.createElement(Text, null, "  q     Quit"),
      ),
    // Footer
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(Text, { dimColor: true }, "Press q to quit · r to refresh"),
    ),
  );
}
