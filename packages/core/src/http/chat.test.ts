import { describe, expect, it } from "vitest";
import { buildHaaiPromptCommand, buildChatCompletionUrl } from "./chat.js";

describe("buildChatCompletionUrl", () => {
  it("builds the chat completions endpoint", () => {
    expect(buildChatCompletionUrl("http://localhost:4001/")).toBe(
      "http://localhost:4001/v1/chat/completions",
    );
  });
});

describe("buildHaaiPromptCommand", () => {
  it("builds a streaming prompt command", () => {
    expect(
      buildHaaiPromptCommand("http://localhost:4001", "haai-sk-test", "smart-chat"),
    ).toBe(
      [
        "haai prompt",
        '"Hello!"',
        '-u "http://localhost:4001"',
        '-k "haai-sk-test"',
        '-m "smart-chat"',
      ].join(" \\\n  "),
    );
  });

  it("includes --no-stream when streaming is disabled", () => {
    expect(
      buildHaaiPromptCommand("http://localhost:4001", "haai-sk-test", "smart-chat", "Hi", false),
    ).toContain("--no-stream");
  });
});
