import type { MitrConfig } from "./config.js";

export class MitrApiError extends Error {
  /** 0 means the request never got an HTTP response (network failure or timeout). */
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MitrApiError";
  }
}

export interface MitrClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export interface ClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const SETTINGS_HINT = "Create a new one at https://app.mitranalytics.dev (Settings → API keys).";

function detailOf(data: unknown): string | undefined {
  if (data && typeof data === "object" && "detail" in data) {
    const d = (data as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (d !== undefined) return JSON.stringify(d);
  }
  // The backend wraps errors as { error: { message } } on some routes.
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: unknown }).error;
    if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
  }
  return undefined;
}

export function createMitrClient(config: MitrConfig, options: ClientOptions = {}): MitrClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${config.apiBaseUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/json",
          ...(options.userAgent ? { "User-Agent": options.userAgent } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new MitrApiError(0, `Mitr did not respond within ${Math.round(timeoutMs / 1000)} seconds. Try again shortly.`);
      }
      throw new MitrApiError(
        0,
        `Could not reach Mitr at ${config.apiBaseUrl}. Check your internet connection (and MITR_API_BASE_URL, if you set it).`
      );
    }

    const text = await res.text();
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined; // e.g. an HTML error page from a proxy: don't dump it into the model's context
      }
    }

    if (!res.ok) {
      const detail = detailOf(data);
      if (res.status === 401) {
        const why = detail && /expired|no longer in/i.test(detail) ? ` (${detail})` : "";
        throw new MitrApiError(401, `Your Mitr API key was rejected${why}. It may have expired, been revoked or been mistyped. ${SETTINGS_HINT}`);
      }
      if (res.status === 429) {
        const wait = res.headers.get("retry-after");
        throw new MitrApiError(429, `Mitr is rate-limiting this key. Wait${wait ? ` ${wait} seconds` : " a minute"} and try again.`);
      }
      if (res.status >= 500) {
        throw new MitrApiError(res.status, `Mitr had a problem on its side${detail ? ` (${detail})` : ""}. Try again shortly.`);
      }
      throw new MitrApiError(res.status, detail ?? `Mitr API request failed with status ${res.status}`);
    }
    if (text && data === undefined) {
      throw new MitrApiError(res.status, "Mitr returned a response that is not JSON. Check MITR_API_BASE_URL.");
    }
    return data as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
    delete: <T>(path: string) => request<T>("DELETE", path),
  };
}
