import assert from "node:assert/strict";
import { test } from "node:test";
import { MitrApiError, createMitrClient } from "../dist/client.js";

const config = { apiKey: "mitr_live_KEY", apiBaseUrl: "https://api.example.com" };
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(handler, opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { api: createMitrClient(config, { fetchImpl, userAgent: "mitr-mcp/9.9.9", ...opts }), calls };
}

async function failure(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  assert.fail("expected a MitrApiError");
}

test("GET sends the bearer key, user agent and the full /api/v1 URL, with no body", async () => {
  const { api, calls } = client(() => json(200, { apps: [] }));
  assert.deepEqual(await api.get("/mcp/apps"), { apps: [] });
  assert.equal(calls[0].url, "https://api.example.com/api/v1/mcp/apps");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer mitr_live_KEY");
  assert.equal(calls[0].init.headers["User-Agent"], "mitr-mcp/9.9.9");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
});

test("POST sends a JSON body and content type", async () => {
  const { api, calls } = client(() => json(201, { siteId: "x" }));
  await api.post("/mcp/apps", { name: "Site" });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.body, JSON.stringify({ name: "Site" }));
});

test("401 says the key was rejected and where to make a new one, whatever the server's wording", async () => {
  const { api } = client(() => json(401, { detail: "Invalid API key." }));
  const e = await failure(api.get("/mcp/apps"));
  assert.ok(e instanceof MitrApiError);
  assert.equal(e.status, 401);
  assert.match(e.message, /rejected/);
  assert.match(e.message, /Settings → API keys/);
});

test("other 4xx pass the backend's detail through", async () => {
  const { api } = client(() => json(404, { detail: "App not found." }));
  const e = await failure(api.get("/mcp/apps/x/report"));
  assert.equal(e.status, 404);
  assert.equal(e.message, "App not found.");
});

test("the backend's {error:{message}} shape is understood too", async () => {
  const { api } = client(() => json(422, { error: { message: "siteId must be a UUID." } }));
  assert.equal((await failure(api.get("/x"))).message, "siteId must be a UUID.");
});

test("429 mentions rate limiting and Retry-After", async () => {
  const { api } = client(() => json(429, { detail: "slow down" }, { "retry-after": "42" }));
  const e = await failure(api.get("/x"));
  assert.equal(e.status, 429);
  assert.match(e.message, /rate-limiting/);
  assert.match(e.message, /42 seconds/);
});

test("5xx is described as a Mitr-side problem", async () => {
  const { api } = client(() => json(503, { detail: "database unavailable" }));
  const e = await failure(api.get("/x"));
  assert.equal(e.status, 503);
  assert.match(e.message, /problem on its side/);
});

test("an HTML error page from a proxy is not dumped into the message", async () => {
  const { api } = client(() => new Response("<html><body>Bad gateway ........ lots of markup</body></html>", { status: 502 }));
  const e = await failure(api.get("/x"));
  assert.equal(e.status, 502);
  assert.ok(!e.message.includes("<html"), e.message);
});

test("a 200 that is not JSON is reported as a configuration problem", async () => {
  const { api } = client(() => new Response("<html>login</html>", { status: 200 }));
  assert.match((await failure(api.get("/x"))).message, /not JSON/);
});

test("an empty 200 body is fine", async () => {
  const { api } = client(() => new Response("", { status: 200 }));
  assert.equal(await api.get("/x"), undefined);
});

test("a network failure becomes a friendly status-0 error", async () => {
  const { api } = client(() => {
    throw new TypeError("fetch failed");
  });
  const e = await failure(api.get("/x"));
  assert.equal(e.status, 0);
  assert.match(e.message, /Could not reach Mitr at https:\/\/api\.example\.com/);
});

test("a slow server times out instead of hanging", async () => {
  const { api } = client(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason));
      }),
    { timeoutMs: 50 }
  );
  const started = Date.now();
  // AbortSignal.timeout() timers don't keep Node alive and this fake fetch has no socket, so hold the loop open
  // (a real request holds its socket open while it waits).
  const keepAlive = setInterval(() => {}, 100);
  try {
    const e = await failure(api.get("/x"));
    assert.equal(e.status, 0);
    assert.match(e.message, /did not respond/);
    assert.ok(Date.now() - started < 2000);
  } finally {
    clearInterval(keepAlive);
  }
});

test("401 for an expired key says so", async () => {
  const { api } = client(() => json(401, { detail: "API key has expired. Create a new one in Settings → API keys." }));
  const e = await failure(api.get("/mcp/apps"));
  assert.match(e.message, /rejected \(API key has expired/);
});

test("402 (early access over) and 403 (missing permission) pass the backend's explanation through", async () => {
  const paywall = client(() => json(402, { detail: "The Mitr MCP early-access period has ended for the Free plan. Upgrade at https://mitranalytics.dev/pricing to keep using it." }));
  assert.match((await failure(paywall.api.get("/mcp/apps"))).message, /pricing/);
  const scope = client(() => json(403, { detail: "This API key is missing the 'apps:write' permission." }));
  assert.match((await failure(scope.api.post("/mcp/apps", {}))).message, /apps:write/);
});
