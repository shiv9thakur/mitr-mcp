# mitr-mcp Development Guide

## Overview
MCP server exposing Mitr to Claude Desktop / Gemini CLI over stdio. A thin adapter — each tool is a typed wrapper around one `mitr-backend` `/api/v1/mcp/*` route; no business logic lives here. See the root [CLAUDE.md](../CLAUDE.md) for how this fits the rest of the workspace, and this project's [README.md](README.md) for setup/config.

## Structure
- `src/config.ts` — `loadConfig(vars)`, pure: validates `MITR_API_KEY` (required, must look like `mitr_live_`/`mitr_test_`) and `MITR_API_BASE_URL` (default `https://api.mitranalytics.dev`; plain http only for localhost, since the key goes in a header). `src/env.ts` wraps it and exits 1 with a one-line reason.
- `src/client.ts` — `createMitrClient(config, opts)` returns `{get, post}`: bearer auth, user agent, 30s timeout, and friendly `MitrApiError`s (401 = key rejected/revoked, 429 = rate limited with Retry-After, 5xx = Mitr-side, non-JSON bodies never dumped into the message, network failures = status 0).
- `src/toolResult.ts` — `runTool()` wraps a handler and turns `MitrApiError`/anything else into an `isError: true` tool result instead of an uncaught exception killing the connection. `visitorDataResult()` wraps results containing visitor-written text (reports, recent events) in an `untrusted_data` envelope and strips hidden characters (audit SEC-17); use it for any new tool that returns paths, referrers, UTM or event properties.
- `src/tools/*.ts` — one file per resource area (`apps`, `reports`, `funnels`, `alerts`, `billing`), each exporting `registerXTools(server, client)` (the client is passed in, not imported, so tests can fake it). Tool input schemas are Zod shapes (plain objects, not `z.object(...)`) per `McpServer.registerTool`'s signature.
- `src/server.ts` — `createServer(client, version)` registers every tool group; `startServer` connects `StdioServerTransport`.
- `src/index.ts` — the `bin`: shebang, `--version`/`--help` (work without a key), then loads config and starts the server. The version is read from `package.json`.
- `test/*.test.mjs` — `npm test` builds then runs `node --test`: config, client (mock fetch), tools (fake client), and an end-to-end stdio test that spawns `dist/index.js` against a stub HTTP API.

## Auth model
Backend-side; see `mitr-backend/app/core/api_key_auth.py` and `app/api/v1/mcp.py`. A key is minted per-user from the dashboard (Settings → API keys & AI assistants, backed by `/api/v1/api-keys`; `mitr-backend/mint_api_key.py` remains as an ops fallback) and scopes exactly to what that user can already see in the dashboard — the `/mcp/*` routes call the *same* handler functions the dashboard's PASETO-authed routes do, with a synthesized `{"sub": user.email}` claims dict, so there's no separate access-control logic to keep in sync.

## Adding a tool
1. Add the backend route first, under `/api/v1/mcp/*` in `mitr-backend/app/api/v1/mcp.py` — reuse an existing dashboard route handler by calling it directly (see that file's existing pattern) rather than duplicating query logic.
2. Add the tool to the matching `src/tools/*.ts` file (or a new one, registered in `src/index.ts`). Keep the tool `description` specific about what fields come back and when to call it — that's the model's only guide for picking the right tool.
3. Add a case to `test/tools.test.mjs` (route and arguments), then `npm test`. Also try it with `npx @modelcontextprotocol/inspector node dist/index.js` against a running local backend.

## Scope (deliberate, as of this writing)
Read access to apps/reports/funnels/alerts/billing. Writes, each behind its own API key permission: `add_app` (`apps:write`, never returns the app's secret); funnels create/update/delete (`funnels:write`, delete also needs `delete`); QR campaigns create/update (archive is a status) and add codes (`qr:write`); webhooks create/update/delete (`webhooks:write`, delete also needs `delete`). Webhook create never returns the signing secret. Destructive tools set `destructiveHint`. No alert editing and no team management. New writes are a product decision, not a default for a tool that would be "nice to have."


## Hosted endpoint (Cloudflare Worker)
`https://mcp.mitranalytics.dev/mcp` serves the same tools over Streamable HTTP for clients that take a URL + header instead of running `npx` (Claude Code `--transport http`, Cursor, VS Code, Gemini CLI). See `docs/scope/MCP_HOSTED_AND_APPS_SCOPE.md` Phase 1.
- `src/http.ts` — `handleMcpHttpRequest(req, opts)`: web-standard Request → Response. Stateless (fresh `createServer` per request with the caller's `Authorization: Bearer mitr_live_…` key), `/health`, Origin allowlist, refuses keys in the URL, logs method/tool/status/last-4 of the key only. Tested by `test/http.test.mjs` with the real MCP HTTP client.
- `src/worker.ts` — Cloudflare entry: per-IP rate limit binding, then `handleMcpHttpRequest`. Excluded from the npm build (`tsconfig.json`); type-checked by `npm run check:worker`; bundled by wrangler.
- `src/version.ts` — must equal `package.json` version (a test checks).
- Local: `wrangler dev --var MITR_API_BASE_URL:http://localhost:8000` against a local backend. Deploy: `npm run deploy:worker` (tests + type-check + `wrangler deploy`; needs Cloudflare login and the `mcp.mitranalytics.dev` custom domain in `wrangler.jsonc`).

## Publishing
Published as `@mitr-analytics/mcp` (public, MIT). `prepublishOnly` runs the whole suite. Bump `version` in `package.json` (it is also what the server reports), then `npm publish`. Keep the dashboard's config snippet (`mcpConfigJson` in `mitr-dashboard/lib/features/ApiKeys/ApiKeysCard.dart`) in step with the package name and any new required env var.
