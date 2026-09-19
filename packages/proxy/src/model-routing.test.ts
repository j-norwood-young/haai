import { describe, expect, it } from "vitest";
import { isRetryableUpstreamFailure } from "./model-routing.js";

describe("isRetryableUpstreamFailure", () => {
  it("retries on 404", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 404 })).toBe(true);
  });

  it("retries on any 5xx", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 500 })).toBe(true);
    expect(isRetryableUpstreamFailure({ statusCode: 503 })).toBe(true);
  });

  it("retries when the error body says the model was not found", () => {
    expect(
      isRetryableUpstreamFailure({ statusCode: 400, error: "The model 'x' was not found" }),
    ).toBe(true);
  });

  it("retries when the error body says the model does not exist", () => {
    expect(
      isRetryableUpstreamFailure({ statusCode: 400, error: "model 'x' does not exist" }),
    ).toBe(true);
  });

  it("does not retry on an ordinary 400", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 400, error: "invalid request" })).toBe(false);
  });

  it("does not retry on 401/403", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 401 })).toBe(false);
    expect(isRetryableUpstreamFailure({ statusCode: 403 })).toBe(false);
  });

  it("does not retry when error mentions 'model' but not a not-found phrase", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 400, error: "model context length exceeded" })).toBe(
      false,
    );
  });

  it("handles an absent error message", () => {
    expect(isRetryableUpstreamFailure({ statusCode: 400 })).toBe(false);
  });
});
