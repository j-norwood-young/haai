import { apiFetch, ApiHttpError, buildJsonRequestInit } from "@haai/core/http";

export interface ApiClientOptions {
  baseUrl: string;
  token: string | undefined;
  sessionCookie: string | undefined;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.opts.token) {
      headers["Authorization"] = `Bearer ${this.opts.token}`;
    }
    if (this.opts.sessionCookie) {
      headers["Cookie"] = `haai_session=${this.opts.sessionCookie}`;
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(`${this.opts.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body,
    });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

export function createApiClient(baseUrl: string): ApiClient {
  const token = process.env["HAAI_ADMIN_TOKEN"];
  return new ApiClient({ baseUrl, token, sessionCookie: undefined });
}

export { ApiHttpError };
