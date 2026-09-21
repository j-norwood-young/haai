export { buildBackendApiUrl, buildBackendRootUrl } from "./backend-url.js";
export { buildChatCompletionUrl, buildHaaiModelsCommand, buildHaaiPromptCommand } from "./chat.js";
export {
  EXAMPLE_LANGUAGES,
  EXAMPLE_OPERATIONS,
  buildEndpointUrl,
  buildExample,
  getExampleOperation,
  isExampleSupported,
  type ExampleLanguage,
  type ExampleLanguageInfo,
  type ExampleOperation,
  type ExampleOperationInfo,
  type ExampleParams,
} from "./examples.js";
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
