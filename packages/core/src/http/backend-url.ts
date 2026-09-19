/**
 * Build an OpenAI-compatible API URL from a backend base URL and path.
 * Handles base URLs with or without a trailing `/v1` segment.
 */
export function buildBackendApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Build a URL against a backend's server root for a NON-OpenAI-namespaced path
 * (e.g. LM Studio's `/api/v0/models` or Ollama's `/api/show`), stripping a
 * trailing `/v1` segment from the base URL if present. Using
 * `buildBackendApiUrl` for these paths would double up the `/v1` segment
 * (e.g. `http://host:1234/v1/api/v0/models`), and the resulting 404 is
 * indistinguishable from "this provider has no such endpoint".
 */
export function buildBackendRootUrl(baseUrl: string, path: string): string {
  let normalizedBase = baseUrl.replace(/\/+$/, "");
  if (normalizedBase.endsWith("/v1")) {
    normalizedBase = normalizedBase.slice(0, -3);
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
