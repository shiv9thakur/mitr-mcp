import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, DEFAULT_API_BASE_URL, loadConfig } from "../dist/config.js";

const KEY = "mitr_live_" + "a".repeat(32) + "_" + "b".repeat(32);

test("defaults to the production API", () => {
  const c = loadConfig({ MITR_API_KEY: KEY });
  assert.equal(c.apiBaseUrl, "https://api.mitranalytics.dev");
  assert.equal(DEFAULT_API_BASE_URL, "https://api.mitranalytics.dev");
  assert.equal(c.apiKey, KEY);
});

test("trims the key and strips trailing slashes from the base URL", () => {
  const c = loadConfig({ MITR_API_KEY: `  ${KEY}\n`, MITR_API_BASE_URL: "https://staging.example.com///" });
  assert.equal(c.apiKey, KEY);
  assert.equal(c.apiBaseUrl, "https://staging.example.com");
});

test("a blank base URL falls back to the default", () => {
  assert.equal(loadConfig({ MITR_API_KEY: KEY, MITR_API_BASE_URL: "   " }).apiBaseUrl, DEFAULT_API_BASE_URL);
});

test("missing key explains where to get one", () => {
  assert.throws(() => loadConfig({}), (e) => e instanceof ConfigError && /Settings → API keys/.test(e.message));
  assert.throws(() => loadConfig({ MITR_API_KEY: "  " }), ConfigError);
});

test("rejects something that is not a Mitr key", () => {
  for (const bad of ["sk-ant-123", "mitr_live_short", "live_" + "a".repeat(40), "Bearer " + KEY]) {
    assert.throws(() => loadConfig({ MITR_API_KEY: bad }), /doesn't look like a Mitr API key/, bad);
  }
});

test("accepts test keys as well as live keys", () => {
  assert.doesNotThrow(() => loadConfig({ MITR_API_KEY: "mitr_test_" + "c".repeat(40) }));
});

test("refuses to send the key over plain http, except to this machine", () => {
  assert.throws(() => loadConfig({ MITR_API_KEY: KEY, MITR_API_BASE_URL: "http://api.mitranalytics.dev" }), /https/);
  assert.throws(() => loadConfig({ MITR_API_KEY: KEY, MITR_API_BASE_URL: "http://evil.example.com:8000" }), /https/);
  for (const ok of ["http://localhost:8000", "http://127.0.0.1:8000", "https://api.example.com"]) {
    assert.doesNotThrow(() => loadConfig({ MITR_API_KEY: KEY, MITR_API_BASE_URL: ok }), ok);
  }
});

test("a malformed base URL is reported", () => {
  assert.throws(() => loadConfig({ MITR_API_KEY: KEY, MITR_API_BASE_URL: "not a url" }), /not a valid URL/);
});
