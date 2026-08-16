import { workerData, parentPort } from "node:worker_threads";
import type { ChatRequest, ChatResponse, HookContext } from "@haai/hooks-sdk";

interface WorkerData {
  type: "pre-request" | "post-completion";
  module: string;
  request?: ChatRequest;
  response?: ChatResponse;
  ctx: HookContext;
}

const data = workerData as WorkerData;

try {
  const mod = await import(data.module);
  const hookFn = mod.default ?? mod;

  let result: unknown;
  if (data.type === "pre-request") {
    result = await hookFn(data.request!, data.ctx);
  } else {
    result = await hookFn(data.response!, data.ctx);
  }

  parentPort?.postMessage(result);
} catch (err) {
  throw err;
}
