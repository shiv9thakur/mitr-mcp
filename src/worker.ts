import { DEFAULT_ALLOWED_ORIGINS, handleMcpHttpRequest } from "./http.js";
import { VERSION } from "./version.js";

/**
 * Cloudflare Worker entry for the hosted endpoint, https://mcp.mitranalytics.dev/mcp. Deployed with
 * `wrangler deploy` (see wrangler.jsonc); not part of the npm package.
 */

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  MITR_API_BASE_URL?: string;
  /** This endpoint's canonical URL (OAuth resource). Default https://mcp.mitranalytics.dev/mcp. */
  MCP_RESOURCE_URL?: string;
  /** Comma-separated extra browser origins to allow, on top of the defaults in http.ts. */
  MCP_EXTRA_ALLOWED_ORIGINS?: string;
  /** Coarse per-IP limit in front of the Mitr API's own per-key limit, so junk traffic never reaches it. */
  MCP_RATE_LIMITER?: RateLimiter;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (env.MCP_RATE_LIMITER && !(await env.MCP_RATE_LIMITER.limit({ key: ip })).success) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "Too many requests. Wait a minute." }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      });
    }

    const extra = (env.MCP_EXTRA_ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    return handleMcpHttpRequest(request, {
      version: VERSION,
      apiBaseUrl: env.MITR_API_BASE_URL,
      resourceUrl: env.MCP_RESOURCE_URL,
      allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...extra],
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  },
};
