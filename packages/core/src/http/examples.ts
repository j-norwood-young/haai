import { buildHaaiModelsCommand, buildHaaiPromptCommand } from "./chat.js";

export type ExampleLanguage = "haai" | "curl" | "javascript" | "python";
export type ExampleOperation = "chat" | "embeddings" | "models";

export interface ExampleLanguageInfo {
  id: ExampleLanguage;
  label: string;
}

export interface ExampleOperationInfo {
  id: ExampleOperation;
  label: string;
  path: string;
  /** Whether the request names a model (models listing does not). */
  needsModel: boolean;
  /** The v-model kind this endpoint serves, or null when any/none applies. */
  vmodelKind: "chat" | "embedding" | null;
}

export const EXAMPLE_LANGUAGES: readonly ExampleLanguageInfo[] = [
  { id: "haai", label: "haai CLI" },
  { id: "curl", label: "curl" },
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
];

export const EXAMPLE_OPERATIONS: readonly ExampleOperationInfo[] = [
  { id: "chat", label: "Chat", path: "/v1/chat/completions", needsModel: true, vmodelKind: "chat" },
  {
    id: "embeddings",
    label: "Embeddings",
    path: "/v1/embeddings",
    needsModel: true,
    vmodelKind: "embedding",
  },
  { id: "models", label: "Models", path: "/v1/models", needsModel: false, vmodelKind: null },
];

export interface ExampleParams {
  baseUrl: string;
  apiKey: string;
  /** Required for operations that need a model. */
  modelId?: string;
  /** Chat message, or the text to embed. */
  message?: string;
  /** Chat only. */
  stream?: boolean;
}

export function getExampleOperation(id: ExampleOperation): ExampleOperationInfo {
  return EXAMPLE_OPERATIONS.find((op) => op.id === id)!;
}

/** Full URL of an operation's endpoint on a proxy base URL. */
export function buildEndpointUrl(baseUrl: string, operation: ExampleOperation): string {
  return `${baseUrl.replace(/\/$/, "")}${getExampleOperation(operation).path}`;
}

/** The haai CLI can send chat prompts and list models, but has no embeddings command. */
export function isExampleSupported(language: ExampleLanguage, operation: ExampleOperation): boolean {
  return language !== "haai" || operation !== "embeddings";
}

interface Request {
  operation: ExampleOperation;
  method: "GET" | "POST";
  url: string;
  body: Record<string, unknown> | null;
  stream: boolean;
}

function buildRequest(operation: ExampleOperation, p: ExampleParams): Request {
  const url = buildEndpointUrl(p.baseUrl, operation);
  const model = p.modelId ?? "";
  switch (operation) {
    case "chat": {
      const stream = p.stream ?? true;
      return {
        operation,
        method: "POST",
        url,
        stream,
        body: {
          model,
          messages: [{ role: "user", content: p.message ?? "Hello!" }],
          stream,
        },
      };
    }
    case "embeddings":
      return {
        operation,
        method: "POST",
        url,
        stream: false,
        body: { model, input: p.message ?? "Hello, world!" },
      };
    case "models":
      return { operation, method: "GET", url, stream: false, body: null };
  }
}

interface Dialect {
  trueLit: string;
  falseLit: string;
  nullLit: string;
  /** Padding inside inline braces: `{ a: 1 }` (JS) vs `{"a": 1}` (Python). */
  pad: string;
  unit: string;
  key(name: string): string;
}

const JS: Dialect = {
  trueLit: "true",
  falseLit: "false",
  nullLit: "null",
  pad: " ",
  unit: "  ",
  key: (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)),
};

const PY: Dialect = {
  trueLit: "True",
  falseLit: "False",
  nullLit: "None",
  pad: "",
  unit: "    ",
  key: (name) => JSON.stringify(name),
};

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

/** Render a JSON value as a source literal; containers of primitives stay on one line. */
function literal(value: unknown, d: Dialect, indent = ""): string {
  if (value === null) return d.nullLit;
  if (typeof value === "boolean") return value ? d.trueLit : d.falseLit;
  if (typeof value !== "object") return JSON.stringify(value);

  const inner = indent + d.unit;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) return `[${value.map((v) => literal(v, d)).join(", ")}]`;
    const items = value.map((v) => `${inner}${literal(v, d, inner)},`);
    return `[\n${items.join("\n")}\n${indent}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  if (entries.every(([, v]) => isPrimitive(v))) {
    const fields = entries.map(([k, v]) => `${d.key(k)}: ${literal(v, d)}`);
    return `{${d.pad}${fields.join(", ")}${d.pad}}`;
  }
  const fields = entries.map(([k, v]) => `${inner}${d.key(k)}: ${literal(v, d, inner)},`);
  return `{\n${fields.join("\n")}\n${indent}}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderCurl(r: Request, apiKey: string): string {
  const parts = [`curl ${r.stream ? "-N " : ""}${shellQuote(r.url)}`];
  if (r.body) parts.push(`-H ${shellQuote("Content-Type: application/json")}`);
  parts.push(`-H ${shellQuote(`Authorization: Bearer ${apiKey}`)}`);
  if (r.body) parts.push(`-d ${shellQuote(JSON.stringify(r.body))}`);
  return parts.join(" \\\n  ");
}

function renderJavaScript(r: Request, apiKey: string): string {
  const lines = [`const res = await fetch(${JSON.stringify(r.url)}, {`];
  if (r.body) lines.push(`  method: "POST",`);
  lines.push(`  headers: {`);
  if (r.body) lines.push(`    "Content-Type": "application/json",`);
  lines.push(`    Authorization: ${JSON.stringify(`Bearer ${apiKey}`)},`, `  },`);
  if (r.body) lines.push(`  body: JSON.stringify(${literal(r.body, JS, "  ")}),`);
  lines.push(
    `});`,
    `if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);`,
    ``,
  );

  if (r.stream) {
    lines.push(
      `const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();`,
      `let buffer = "";`,
      `for (;;) {`,
      `  const { done, value } = await reader.read();`,
      `  if (done) break;`,
      `  buffer += value;`,
      `  const lines = buffer.split("\\n");`,
      `  buffer = lines.pop() ?? "";`,
      `  for (const line of lines) {`,
      `    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;`,
      `    const delta = JSON.parse(line.slice(6)).choices[0]?.delta?.content;`,
      `    if (delta) process.stdout.write(delta);`,
      `  }`,
      `}`,
    );
  } else if (r.operation === "chat") {
    lines.push(`const data = await res.json();`, `console.log(data.choices[0].message.content);`);
  } else if (r.operation === "embeddings") {
    lines.push(
      `const { data } = await res.json();`,
      `console.log(data[0].embedding.length, "dimensions");`,
    );
  } else {
    lines.push(`const { data } = await res.json();`, `for (const model of data) console.log(model.id);`);
  }
  return lines.join("\n");
}

function renderPython(r: Request, apiKey: string): string {
  const headers = `headers={"Authorization": ${JSON.stringify(`Bearer ${apiKey}`)}}`;
  const call = r.body ? "requests.post" : "requests.get";
  const args = [`    ${JSON.stringify(r.url)},`, `    ${headers},`];
  if (r.body) args.push(`    json=${literal(r.body, PY, "    ")},`);

  if (r.stream) {
    args.push(`    stream=True,`);
    return [
      `import json`,
      `import requests`,
      ``,
      `with ${call}(`,
      ...args,
      `) as res:`,
      `    res.raise_for_status()`,
      `    res.encoding = "utf-8"`,
      `    for line in res.iter_lines(decode_unicode=True):`,
      `        if not line.startswith("data: ") or line == "data: [DONE]":`,
      `            continue`,
      `        delta = json.loads(line[6:])["choices"][0]["delta"].get("content")`,
      `        if delta:`,
      `            print(delta, end="", flush=True)`,
    ].join("\n");
  }

  const tail =
    r.operation === "chat"
      ? [`print(res.json()["choices"][0]["message"]["content"])`]
      : r.operation === "embeddings"
        ? [`print(len(res.json()["data"][0]["embedding"]), "dimensions")`]
        : [`for model in res.json()["data"]:`, `    print(model["id"])`];
  return [
    `import requests`,
    ``,
    `res = ${call}(`,
    ...args,
    `)`,
    `res.raise_for_status()`,
    ...tail,
  ].join("\n");
}

/**
 * A ready-to-run snippet for calling the proxy, or null when the language
 * cannot express the operation (see {@link isExampleSupported}).
 */
export function buildExample(
  language: ExampleLanguage,
  operation: ExampleOperation,
  params: ExampleParams,
): string | null {
  if (!isExampleSupported(language, operation)) return null;
  if (getExampleOperation(operation).needsModel && !params.modelId) return null;

  const request = buildRequest(operation, params);
  switch (language) {
    case "haai":
      if (operation === "models") return buildHaaiModelsCommand(params.baseUrl, params.apiKey);
      return buildHaaiPromptCommand(
        params.baseUrl,
        params.apiKey,
        params.modelId ?? "",
        params.message ?? "Hello!",
        request.stream,
      );
    case "curl":
      return renderCurl(request, params.apiKey);
    case "javascript":
      return renderJavaScript(request, params.apiKey);
    case "python":
      return renderPython(request, params.apiKey);
  }
}
