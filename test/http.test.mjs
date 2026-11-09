// The hosted endpoint's handler (what the Cloudflare Worker serves), driven by the real MCP client over
// Streamable HTTP, with the Mitr API stubbed through fetchImpl.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleMcpHttpRequest } from "../dist/http.js";
import { VERSION } from "../dist/version.js";

const KEY = "mitr_live_" + "a".repeat(32) + "_" + "b".repeat(32);
const ENDPOINT = "https://mcp.mitranalytics.dev/mcp";

function setup(apiHandler = () => ({ apps: [{ name: "Stub Site", siteId: "s1" }] }), extra = {}) {
  const apiCalls = [];
  const logs = [];
  const fetchImpl = async (url, init) => {
    apiCalls.push({ url: String(url), auth: init.headers.Authorization, ua: init.headers["User-Agent"] });
    const out = apiHandler(String(url));
    const status = out?.__status ?? 200;
    return new Response(JSON.stringify(out?.__body ?? out), { status, headers: { "content-type": "application/json" } });
  };
  const handler = (req) =>
    handleMcpHttpRequest(req, { version: VERSION, fetchImpl, log: (e) => logs.push(e), tokenCheckCacheMs: 0, ...extra });
  return { apiCalls, logs, handler };
}

async function connect(handler, headers = { Authorization: `Bearer ${KEY}` }) {
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    requestInit: { headers },
    fetch: (url, init) => handler(new Request(url, init)),
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

test("version.ts matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

test("a real MCP client lists the tools and calls one with the caller's key", async () => {
  const { apiCalls, logs, handler } = setup();
  const client = await connect(handler);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 22);
  const r = await client.callTool({ name: "list_apps", arguments: {} });
  assert.deepEqual(JSON.parse(r.content[0].text), { apps: [{ name: "Stub Site", siteId: "s1" }] });
  assert.equal(apiCalls.at(-1).url, "https://api.mitranalytics.dev/api/v1/mcp/apps");
  assert.equal(apiCalls.at(-1).auth, `Bearer ${KEY}`);
  assert.match(apiCalls.at(-1).ua, /^mitr-mcp-hosted\//);
  const toolLog = logs.find((l) => l.tool === "list_apps");
  assert.equal(toolLog.status, 200);
  assert.equal(toolLog.key, "…" + KEY.slice(-4));
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(KEY));
  await client.close();
});

test("a credential the Mitr API rejects gets an HTTP 401 the client can act on (refresh or sign in)", async () => {
  const { handler } = setup(() => ({ __status: 401, __body: { detail: "Access token is invalid, expired or revoked." } }));
  const res = await handler(new Request(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
  assert.equal(res.status, 401);
  const challenge = res.headers.get("www-authenticate");
  assert.match(challenge, /error="invalid_token"/);
  assert.match(challenge, /resource_metadata="https:\/\/mcp\.mitranalytics\.dev\/\.well-known\/oauth-protected-resource"/);
  assert.match((await res.json()).message, /expired or revoked/);
});

test("early access over (402) and missing permission (403) come back with Mitr's explanation", async () => {
  for (const [status, detail] of [[402, "Upgrade at https://mitranalytics.dev/pricing"], [403, "missing the 'read' permission"]]) {
    const { handler } = setup((u) => (u.endsWith("/token-check") ? { __status: status, __body: { detail } } : {}));
    const res = await handler(new Request(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "{}" }));
    assert.equal(res.status, status);
    assert.equal((await res.json()).message, detail);
  }
});

test("an OAuth access token from the sign-in flow is accepted and forwarded", async () => {
  const token = "mitr_oat_" + "Q".repeat(43);
  const { apiCalls, handler } = setup();
  const client = await connect(handler, { Authorization: `Bearer ${token}` });
  await client.callTool({ name: "list_apps", arguments: {} });
  assert.ok(apiCalls.some((c) => c.url.endsWith("/api/v1/mcp/token-check") && c.auth === `Bearer ${token}`));
  assert.equal(apiCalls.at(-1).auth, `Bearer ${token}`);
  await client.close();
});

test("a credential that passed the check is trusted for a while instead of re-checked every request", async () => {
  const { apiCalls, handler } = setup(undefined, { tokenCheckCacheMs: 60_000 });
  const key = "mitr_live_" + "c".repeat(40);
  const req = () => new Request(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  await handler(req());
  await handler(req());
  assert.equal(apiCalls.filter((c) => c.url.endsWith("/token-check")).length, 1);
});

test("protected resource metadata names the Mitr API as the authorization server", async () => {
  const { handler } = setup();
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const res = await handler(new Request(`https://mcp.mitranalytics.dev${path}`));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      resource: ENDPOINT,
      authorization_servers: ["https://api.mitranalytics.dev"],
      scopes_supported: ["mitr:read", "mitr:apps.write", "mitr:funnels.write", "mitr:qr.write", "mitr:webhooks.write", "mitr:delete", "offline_access"],
      bearer_methods_supported: ["header"],
      resource_name: "Mitr Analytics",
      resource_documentation: "https://mitranalytics.dev/docs/mcp",
    });
  }
});

test("no key, or a malformed one, gets 401 with a Bearer challenge and setup help", async () => {
  const { handler, apiCalls } = setup();
  for (const auth of [undefined, "Bearer nope", "Basic abc"]) {
    const res = await handler(new Request(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }));
    assert.equal(res.status, 401, String(auth));
    assert.match(res.headers.get("www-authenticate"), /^Bearer resource_metadata="https:\/\/mcp\.mitranalytics\.dev\/\.well-known\/oauth-protected-resource", scope="mitr:read mitr:apps\.write mitr:funnels\.write mitr:qr\.write mitr:webhooks\.write mitr:delete"/);
    assert.match((await res.json()).message, /API key/);
  }
  assert.equal(apiCalls.length, 0);
});

test("a key in the URL is refused and never used", async () => {
  const { handler, apiCalls } = setup();
  const res = await handler(new Request(`${ENDPOINT}?token=${KEY}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "key_in_url");
  assert.equal(apiCalls.length, 0);
});

test("browser origins other than the allowed ones are refused", async () => {
  const { handler } = setup();
  const res = await handler(new Request(ENDPOINT, { method: "POST", headers: { origin: "https://evil.example", authorization: `Bearer ${KEY}` }, body: "{}" }));
  assert.equal(res.status, 403);
  const client = await connect(handler, { Authorization: `Bearer ${KEY}`, Origin: "https://claude.ai" });
  assert.equal((await client.listTools()).tools.length, 22);
  await client.close();
});

test("health and unknown paths", async () => {
  const { handler } = setup();
  const health = await handler(new Request("https://mcp.mitranalytics.dev/"));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    name: "mitr-mcp", version: VERSION, endpoint: ENDPOINT, docs: "https://mitranalytics.dev/docs/mcp",
  });
  assert.equal((await handler(new Request("https://mcp.mitranalytics.dev/other"))).status, 404);
});
