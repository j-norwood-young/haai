export { buildBackendApiUrl } from "./backend-url.js";
export { buildHaaiPromptCommand, buildChatCompletionUrl } from "./chat.js";
export {
  ApiHttpError,
  apiFetch,
  buildJsonRequestInit,
  hasJsonRequestBody,
  type JsonRequestInit,
} from "./client.js";
export {
  defaultProxyCandidateUrls,
  resolveDefaultProxyUrl,
} from "./proxy-url.js";
