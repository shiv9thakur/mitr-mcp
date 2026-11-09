// End to end: the BUILT server, spawned the way Claude Desktop spawns it, talking MCP over stdio to a stub Mitr API.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const KEY = "mitr_test_" + "d".repeat(32) + "_" + "e".repeat(32);
const ENTRY = new URL("../dist/index.js", import.meta.url).pathname;
const seen = [];
let mode = "ok";
let server;
let baseUrl;

before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, ua: req.headers["user-agent"] });
    if (mode === "revoked") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ detail: "Invalid API key." }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url === "/api/v1/mcp/apps") return res.end(JSON.stringify({ apps: [{ name: "Stub Site", siteId: "s1" }] }));
    res.end(JSON.stringify({ stub: req.url }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function connect(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY],
    env: { PATH: process.env.PATH, MITR_API_KEY: KEY, MITR_API_BASE_URL: baseUrl, ...env },
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

test("lists the twenty-one tools and calls one through the real protocol", async () => {
  mode = "ok";
  seen.length = 0;
  const client = await connect();
  const { tools } = await client.listTools();
  assert.equal(tools.length, 22);
  assert.ok(tools.some((t) => t.name === "list_apps"));

  const r = await client.callTool({ name: "list_apps", arguments: {} });
  assert.ok(!r.isError);
  assert.deepEqual(JSON.parse(r.content[0].text), { apps: [{ name: "Stub Site", siteId: "s1" }] });
  assert.equal(seen[0].url, "/api/v1/mcp/apps");
  assert.equal(seen[0].auth, `Bearer ${KEY}`);
  assert.match(seen[0].ua, /^mitr-mcp\/\d+\.\d+\.\d+/);
  await client.close();
});

test("a revoked key comes back as a clear tool error, not a crash", async () => {
  mode = "revoked";
  const client = await connect();
  const r = await client.callTool({ name: "list_apps", arguments: {} });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /rejected/);
  assert.match(r.content[0].text, /Settings → API keys/);
  // the connection is still usable afterwards
  mode = "ok";
  assert.ok(!(await client.callTool({ name: "list_apps", arguments: {} })).isError);
  await client.close();
});

test("bad input is rejected by the tool's schema", async () => {
  mode = "ok";
  const client = await connect();
  seen.length = 0;
  const r = await client.callTool({ name: "get_app_report", arguments: { siteId: "nope" } }).catch((e) => ({ isError: true, content: [{ text: String(e.message) }] }));
  assert.equal(r.isError, true);
  assert.equal(seen.length, 0, "no request should reach the API");
  await client.close();
});

function run(args, env) {
  return spawnSync(process.execPath, [ENTRY, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 20000 });
}

test("--version and --help work without a key", () => {
  const v = run(["--version"], {});
  assert.equal(v.status, 0);
  assert.match(v.stdout.trim(), /^\d+\.\d+\.\d+/);
  const h = run(["--help"], {});
  assert.equal(h.status, 0);
  assert.match(h.stdout, /MITR_API_KEY/);
});

test("a missing key exits 1 with a one-line reason on stderr", () => {
  const r = run([], {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MITR_API_KEY is not set/);
});

test("a plain-http remote base URL is refused before any request is made", () => {
  const r = run([], { MITR_API_KEY: KEY, MITR_API_BASE_URL: "http://api.evil.example.com" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /https/);
});
