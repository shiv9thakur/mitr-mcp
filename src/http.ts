import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMitrClient } from "./client.js";
import { ConfigError, DEFAULT_API_BASE_URL, loadConfig } from "./config.js";
import { createServer } from "./server.js";

/**
 * The hosted MCP endpoint (https://mcp.mitranalytics.dev/mcp) as a plain web-standard handler: Request in,
 * Response out. The Cloudflare Worker (src/worker.ts) is a thin wrapper around it, and tests call it directly.
 *
 * Stateless: every request builds a fresh server for the caller's key, so there is no session to store, nothing
 * shared between keys, and any instance can answer any request. The key is checked by the Mitr API on every tool
 * call (scopes, expiry, workspace, rate limit, plan), exactly as for the npm package.
 *
 * Credentials are either an API key (mitr_live_…) or an OAuth access token (mitr_oat_…) from the sign-in flow,
 * whose authorization server is the Mitr API (mitr-backend app/api/v1/oauth.py). Unauthenticated requests get a
 * 401 pointing at the protected resource metadata, which is how claude.ai and other clients find the sign-in.
 * Each credential is checked against the API before use (cached briefly), so an expired token gets an HTTP 401
 * the client can react to by refreshing, instead of tool errors.
 */

export interface HttpHandlerOptions {
  version: string;
  /** Defaults to https://api.mitranalytics.dev. */
  apiBaseUrl?: string;
  /** Browser origins allowed to call the endpoint. Requests with any other Origin header are refused. */
  allowedOrigins?: string[];
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  log?: (entry: Record<string, unknown>) => void;
  /** How long a credential that passed the API check is trusted without asking again. Default 60 s; 0 = always ask. */
  tokenCheckCacheMs?: number;
}

export const SCOPES_SUPPORTED = ["mitr:read", "mitr:apps.write", "offline_access"];
const tokenOkUntil = new Map<string, number>();

export const DEFAULT_ALLOWED_ORIGINS = ["https://claude.ai", "https://chatgpt.com", "https://chat.openai.com"];
const DOCS_URL = "https://mitranalytics.dev/docs/mcp";
const KEY_IN_URL = /mitr_(live|test)_/i;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function metadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource`;
}

function unauthorized(origin: string, message: string, tokenPresented: boolean): Response {
  const parts = [`resource_metadata="${metadataUrl(origin)}"`, `scope="mitr:read"`];
  if (tokenPresented) parts.push('error="invalid_token"');
  return json(401, { error: "unauthorized", message }, { "www-authenticate": `Bearer ${parts.join(", ")}` });
}

/** Asks the Mitr API whether this credential works right now. Returns null when it does. */
async function checkCredential(
  token: string,
  apiBaseUrl: string,
  origin: string,
  options: HttpHandlerOptions
): Promise<Response | null> {
  const cacheMs = options.tokenCheckCacheMs ?? 60_000;
  const okUntil = tokenOkUntil.get(token);
  if (okUntil && okUntil > Date.now()) return null;
  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(`${apiBaseUrl}/api/v1/mcp/token-check`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": `mitr-mcp-hosted/${options.version}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return json(503, { error: "unavailable", message: "Could not reach Mitr to check your credentials. Try again shortly." });
  }
  if (res.ok) {
    if (cacheMs > 0) {
      if (tokenOkUntil.size > 5000) tokenOkUntil.clear();
      tokenOkUntil.set(token, Date.now() + cacheMs);
    }
    return null;
  }
  tokenOkUntil.delete(token);
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    // not JSON; use the generic messages below
  }
  if (res.status === 401) {
    return unauthorized(origin, detail || "Your Mitr credentials were rejected. Sign in again or create a new API key.", true);
  }
  if (res.status === 402 || res.status === 403 || res.status === 429) {
    return json(res.status, { error: res.status === 429 ? "rate_limited" : "forbidden", message: detail || `Mitr refused the request (${res.status}).` });
  }
  return json(503, { error: "unavailable", message: "Mitr could not check your credentials. Try again shortly." });
}

/** What the request asks for, for logs only. Never the arguments (they can contain the user's data). */
async function describe(req: Request): Promise<{ rpc?: string; tool?: string }> {
  if (req.method !== "POST") return {};
  try {
    const body = (await req.clone().json()) as unknown;
    const first = (Array.isArray(body) ? body[0] : body) as { method?: unknown; params?: { name?: unknown } };
    return {
      rpc: typeof first?.method === "string" ? first.method : undefined,
      tool: typeof first?.params?.name === "string" ? first.params.name : undefined,
    };
  } catch {
    return {};
  }
}

export async function handleMcpHttpRequest(req: Request, options: HttpHandlerOptions): Promise<Response> {
  const started = Date.now();
  const url = new URL(req.url);
  const log = options.log ?? (() => {});

  const apiBaseUrl = (options.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, "");

  if (url.pathname === "/" || url.pathname === "/health") {
    return json(200, { name: "mitr-mcp", version: options.version, endpoint: `${url.origin}/mcp`, docs: DOCS_URL });
  }
  // RFC 9728 protected resource metadata: where clients learn which authorization server signs users in.
  if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
    return new Response(JSON.stringify({
      resource: `${url.origin}/mcp`,
      authorization_servers: [apiBaseUrl],
      scopes_supported: SCOPES_SUPPORTED,
      bearer_methods_supported: ["header"],
      resource_name: "Mitr Analytics",
      resource_documentation: DOCS_URL,
    }), { status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
  }
  if (url.pathname !== "/mcp") {
    return json(404, { error: "not_found", message: `The MCP endpoint is ${url.origin}/mcp` });
  }

  // DNS-rebinding / cross-site protection (MCP Streamable HTTP transport requirement). Server-to-server MCP
  // clients send no Origin; browsers always do, so only listed ones get through.
  const origin = req.headers.get("origin");
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  if (origin && !allowedOrigins.includes(origin)) {
    return json(403, { error: "forbidden_origin", message: `Requests from ${origin} are not allowed.` });
  }

  if (KEY_IN_URL.test(decodeURIComponent(url.search))) {
    return json(400, {
      error: "key_in_url",
      message: "Don't put your Mitr API key in the URL. Send it as 'Authorization: Bearer mitr_live_…' and create a new key, since this one may now be in logs.",
    });
  }

  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  if (!match) {
    return unauthorized(
      url.origin,
      `Sign in to Mitr when your assistant asks, or send an API key as 'Authorization: Bearer mitr_live_…' (create one in the Mitr dashboard, Settings → API keys). Setup: ${DOCS_URL}`,
      false
    );
  }

  let config;
  try {
    config = loadConfig({ MITR_API_KEY: match[1], MITR_API_BASE_URL: options.apiBaseUrl });
  } catch (err) {
    return unauthorized(url.origin, err instanceof ConfigError ? err.message : "Invalid API key.", true);
  }

  const refused = await checkCredential(config.apiKey, apiBaseUrl, url.origin, options);
  if (refused) {
    log({ status: refused.status, ms: Date.now() - started, key: `…${config.apiKey.slice(-4)}`, check: "refused" });
    return refused;
  }

  const what = await describe(req);
  const client = createMitrClient(config, {
    userAgent: `mitr-mcp-hosted/${options.version}`,
    fetchImpl: options.fetchImpl,
  });
  const server = createServer(client, options.version);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req);
    log({ ...what, status: res.status, ms: Date.now() - started, key: `…${config.apiKey.slice(-4)}` });
    return res;
  } catch (err) {
    log({ ...what, status: 500, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
    return json(500, { error: "internal_error", message: "Mitr's MCP endpoint hit an unexpected error. Try again shortly." });
  } finally {
    await server.close().catch(() => {});
  }
}
