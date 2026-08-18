import { defineConfig } from "vitepress";

export default defineConfig({
  title: "HAAI",
  description: "High Availability AI — modern streaming reverse proxy for OpenAI-compatible LLMs",
  base: "/docs/",
  ignoreDeadLinks: true,
  head: [
    ["link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/" },
      { text: "API Reference", link: "/api/" },
      { text: "GitHub", link: "https://github.com/j-norwood-young/haai" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/introduction" },
          { text: "Installation", link: "/guide/installation" },
          { text: "Quick Start", link: "/guide/quickstart" },
          { text: "Development", link: "/guide/development" },
        ],
      },
      {
        text: "Configuration",
        items: [
          { text: "Overview & Precedence", link: "/guide/configuration" },
          { text: "Environment Variables", link: "/guide/env-vars" },
          { text: "config.yaml Reference", link: "/guide/config-yaml" },
        ],
      },
      {
        text: "Backends",
        items: [
          { text: "Adding Backends", link: "/guide/backends" },
          { text: "LM Studio", link: "/guide/providers/lmstudio" },
          { text: "Ollama", link: "/guide/providers/ollama" },
          { text: "vLLM", link: "/guide/providers/vllm" },
          { text: "OpenAI / Generic", link: "/guide/providers/openai" },
          { text: "Key Modes", link: "/guide/key-modes" },
        ],
      },
      {
        text: "Virtual Models",
        items: [
          { text: "V-Models", link: "/guide/vmodels" },
          { text: "Model ID Convention", link: "/guide/model-ids" },
          { text: "Load Balancing", link: "/guide/balancing" },
          { text: "High Availability", link: "/guide/ha" },
        ],
      },
      {
        text: "API Keys",
        items: [
          { text: "Key Management", link: "/guide/keys" },
          { text: "Scopes & Capabilities", link: "/guide/key-scopes" },
          { text: "Rate Limiting & Budgets", link: "/guide/rate-limits" },
        ],
      },
      {
        text: "Hooks",
        items: [
          { text: "Overview", link: "/guide/hooks" },
          { text: "Pre-Request Hooks", link: "/guide/hooks-pre-request" },
          { text: "Post-Completion Hooks", link: "/guide/hooks-post-completion" },
          { text: "Authoring Hooks", link: "/guide/hooks-authoring" },
          { text: "Publishing to NPM", link: "/guide/hooks-publishing" },
        ],
      },
      {
        text: "Observability",
        items: [
          { text: "Monitoring & Graphs", link: "/guide/monitoring" },
          { text: "Prometheus & OTLP", link: "/guide/prometheus" },
          { text: "Logging", link: "/guide/logging" },
        ],
      },
      {
        text: "Management",
        items: [
          { text: "Web UI", link: "/guide/web-ui" },
          { text: "CLI", link: "/guide/cli" },
          { text: "MCP Server", link: "/guide/mcp" },
          { text: "REST API", link: "/api/rest" },
        ],
      },
      {
        text: "Security",
        items: [
          { text: "Security Overview", link: "/guide/security" },
          { text: "TLS Setup", link: "/guide/tls" },
          { text: "Audit Log", link: "/guide/audit" },
        ],
      },
      {
        text: "Deployment",
        items: [
          { text: "Docker", link: "/guide/docker" },
          { text: "Tailscale", link: "/guide/tailscale" },
          { text: "Reverse Proxy (nginx)", link: "/guide/reverse-proxy" },
          { text: "Kubernetes", link: "/guide/kubernetes" },
          { text: "Systemd", link: "/guide/systemd" },
          { text: "Migrating from ai-v-models", link: "/guide/migrating-from-aivm" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/j-norwood-young/haai" },
    ],
    search: {
      provider: "local",
    },
  },
});
