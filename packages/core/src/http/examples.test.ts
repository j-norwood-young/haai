import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_LANGUAGES,
  EXAMPLE_OPERATIONS,
  buildEndpointUrl,
  buildExample,
  isExampleSupported,
  type ExampleLanguage,
  type ExampleOperation,
} from "./examples.js";

const { modelId: _omitted, ...noModel } = {
  baseUrl: "http://localhost:4001/",
  apiKey: "haai-sk-test",
  modelId: "",
};
const base = { baseUrl: "http://localhost:4001/", apiKey: "haai-sk-test", modelId: "smart-chat" };

describe("buildEndpointUrl", () => {
  it("joins the operation path onto the base URL", () => {
    expect(buildEndpointUrl("http://localhost:4001/", "chat")).toBe(
      "http://localhost:4001/v1/chat/completions",
    );
    expect(buildEndpointUrl("http://localhost:4001", "embeddings")).toBe(
      "http://localhost:4001/v1/embeddings",
    );
    expect(buildEndpointUrl("http://localhost:4001", "models")).toBe(
      "http://localhost:4001/v1/models",
    );
  });
});

describe("isExampleSupported", () => {
  it("has no haai CLI command for embeddings", () => {
    expect(isExampleSupported("haai", "chat")).toBe(true);
    expect(isExampleSupported("haai", "models")).toBe(true);
    expect(isExampleSupported("haai", "embeddings")).toBe(false);
    expect(isExampleSupported("curl", "models")).toBe(true);
  });
});

describe("buildExample", () => {
  it("returns null for unsupported combinations and missing models", () => {
    expect(buildExample("haai", "embeddings", base)).toBeNull();
    expect(buildExample("curl", "chat", noModel)).toBeNull();
    expect(buildExample("curl", "models", noModel)).not.toBeNull();
  });

  it("builds the haai chat command", () => {
    expect(buildExample("haai", "chat", base)).toBe(
      ["haai prompt", "'Hello'", "-u 'http://localhost:4001'", "-k 'haai-sk-test'", "-m 'smart-chat'"].join(
        " \\\n  ",
      ),
    );
    expect(buildExample("haai", "chat", { ...base, stream: false })).toContain("--no-stream");
  });

  it("builds the haai models command", () => {
    expect(buildExample("haai", "models", noModel)).toBe(
      ["haai models", "-u 'http://localhost:4001'", "-k 'haai-sk-test'"].join(" \\\n  "),
    );
  });

  it("builds a streaming chat curl command", () => {
    expect(buildExample("curl", "chat", base)).toBe(
      [
        "curl -N 'http://localhost:4001/v1/chat/completions'",
        "-H 'Content-Type: application/json'",
        "-H 'Authorization: Bearer haai-sk-test'",
        `-d '{"model":"smart-chat","messages":[{"role":"user","content":"Hello"}],"stream":true}'`,
      ].join(" \\\n  "),
    );
  });

  it("omits -N when not streaming and never streams embeddings", () => {
    expect(buildExample("curl", "chat", { ...base, stream: false })).not.toContain("-N");
    expect(buildExample("curl", "embeddings", { ...base, stream: true })).not.toContain("-N");
  });

  it("builds an embeddings curl command", () => {
    expect(buildExample("curl", "embeddings", base)).toContain(
      `-d '{"model":"smart-chat","input":"Hello, world!"}'`,
    );
  });

  it("builds a body-less models curl command", () => {
    const cmd = buildExample("curl", "models", base)!;
    expect(cmd).toContain("curl 'http://localhost:4001/v1/models'");
    expect(cmd).not.toContain("-d ");
    expect(cmd).not.toContain("Content-Type");
  });

  it("escapes single quotes for the shell", () => {
    expect(buildExample("curl", "chat", { ...base, message: "it's" })).toContain(`it'\\''s`);
  });

  it("uses Python literals", () => {
    const py = buildExample("python", "chat", { ...base, stream: false })!;
    expect(py).toContain('"stream": False');
    expect(py).toContain("requests.post(");
    expect(py).toContain('print(res.json()["choices"][0]["message"]["content"])');
    expect(buildExample("python", "models", base)).toContain("requests.get(");
  });

  it("reads the SSE stream when streaming chat", () => {
    expect(buildExample("javascript", "chat", base)).toContain("TextDecoderStream");
    expect(buildExample("python", "chat", base)).toContain("iter_lines");
    expect(buildExample("javascript", "chat", { ...base, stream: false })).not.toContain(
      "TextDecoderStream",
    );
  });
});

const tricky = { ...base, modelId: 'a"b', message: `say "hi"\nit's \\ done`, apiKey: 'k"ey' };
const combos: [ExampleLanguage, ExampleOperation, boolean][] = [];
for (const lang of EXAMPLE_LANGUAGES) {
  for (const op of EXAMPLE_OPERATIONS) {
    for (const stream of [true, false]) combos.push([lang.id, op.id, stream]);
  }
}

const hasPython = spawnSync("python3", ["--version"]).status === 0;

describe.each(combos)("%s / %s / stream=%s", (language, operation, stream) => {
  const code = buildExample(language, operation, { ...tricky, stream });

  it("is null only for unsupported combinations", () => {
    expect(code === null).toBe(!isExampleSupported(language, operation));
  });

  it("is syntactically valid", () => {
    if (code === null) return;
    if (language === "javascript") {
      expect(() => new Function(`return (async () => {${code}})`)).not.toThrow();
    } else if (language === "curl") {
      execFileSync("bash", ["-n"], { input: code });
    } else if (language === "python" && hasPython) {
      execFileSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
        input: code,
      });
    }
  });
});
