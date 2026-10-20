import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMitrClient } from "./client.js";
import { ConfigError, loadConfig } from "./config.js";
import { createServer } from "./server.js";

/**
 * The hosted MCP endpoint (https://mcp.mitranalytics.dev/mcp) as a plain web-standard handler: Request in,
 * Response out. The Cloudflare Worker (src/worker.ts) is a thin wrapper around it, and tests call it directly.
 *
 * Stateless: every request builds a fresh server for the caller's key, so there is no session to store, nothing
 * shared between keys, and any instance can answer any request. The key is checked by the Mitr API on every tool
 * call (scopes, expiry, workspace, rate limit, plan), exactly as for the npm package.
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
}

export const DEFAULT_ALLOWED_ORIGINS = ["https://claude.ai", "https://chatgpt.com", "https://chat.openai.com"];
const DOCS_URL = "https://mitranalytics.dev/docs/mcp";
const KEY_IN_URL = /mitr_(live|test)_/i;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function unauthorized(message: string): Response {
  return json(401, { error: "unauthorized", message }, {
    "www-authenticate": 'Bearer realm="mitr", error="invalid_token"',
  });
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

  if (url.pathname === "/" || url.pathname === "/health") {
    return json(200, { name: "mitr-mcp", version: options.version, endpoint: `${url.origin}/mcp`, docs: DOCS_URL });
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
    return unauthorized(`Send your Mitr API key as 'Authorization: Bearer mitr_live_…'. Create one in the Mitr dashboard (Settings → API keys). Setup: ${DOCS_URL}`);
  }

  let config;
  try {
    config = loadConfig({ MITR_API_KEY: match[1], MITR_API_BASE_URL: options.apiBaseUrl });
  } catch (err) {
    return unauthorized(err instanceof ConfigError ? err.message : "Invalid API key.");
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
