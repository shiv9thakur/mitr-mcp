import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/server.js";

// Fake client that records every request, so each write's route, method and body are checked.
function setup(reply = () => ({ ok: true })) {
  const calls = [];
  const record = (method) => async (path, body) => {
    calls.push([method, path, body]);
    return reply(method, path, body);
  };
  const client = {
    get: record("GET"),
    post: record("POST"),
    put: record("PUT"),
    patch: record("PATCH"),
    delete: async (path) => {
      calls.push(["DELETE", path, undefined]);
      return reply("DELETE", path);
    },
  };
  const tools = createServer(client, "0.0.0-test")._registeredTools;
  return { calls, tools };
}

const call = (tool, args) => tool.handler(args, {});
const FUNNEL_ID = "0f0f0f0f-0b0e-4a3c-9a8e-222222222222";
const CAMPAIGN_ID = "1f1f1f1f-0b0e-4a3c-9a8e-333333333333";
const ENDPOINT_ID = "2f2f2f2f-0b0e-4a3c-9a8e-444444444444";

test("create_funnel posts the steps in the backend's camelCase shape", async () => {
  const { calls, tools } = setup();
  await call(tools.create_funnel, {
    name: "Signup",
    steps: [
      { label: "Pricing", matchType: "path", matchValue: "/pricing" },
      { label: "Signed up", matchType: "event_type", matchValue: "signup" },
    ],
  });
  assert.equal(calls[0][0], "POST");
  assert.equal(calls[0][1], "/mcp/funnels");
  assert.equal(calls[0][2].steps[1].matchType, "event_type");
});

test("update_funnel is a full PUT to the funnel's route, with the id out of the body", async () => {
  const { calls, tools } = setup();
  await call(tools.update_funnel, {
    funnelId: FUNNEL_ID,
    name: "Signup v2",
    steps: [{ label: "Pricing", matchType: "path", matchValue: "/pricing" }],
  });
  assert.deepEqual(calls[0].slice(0, 2), ["PUT", `/mcp/funnels/${FUNNEL_ID}`]);
  assert.equal("funnelId" in calls[0][2], false);
});

test("delete_funnel sends a DELETE to the funnel's route", async () => {
  const { calls, tools } = setup();
  await call(tools.delete_funnel, { funnelId: FUNNEL_ID });
  assert.deepEqual(calls[0].slice(0, 2), ["DELETE", `/mcp/funnels/${FUNNEL_ID}`]);
});

test("update_qr_campaign sends only the fields the caller set, so archiving leaves the name alone", async () => {
  const { calls, tools } = setup();
  await call(tools.update_qr_campaign, { campaignId: CAMPAIGN_ID, status: "archived" });
  assert.deepEqual(calls[0], ["PATCH", `/mcp/qr/campaigns/${CAMPAIGN_ID}`, { status: "archived" }]);
});

test("create_qr_campaign always declares a url destination", async () => {
  const { calls, tools } = setup();
  await call(tools.create_qr_campaign, { name: "Demo day", destinationUrl: "https://example.com/demo" });
  assert.equal(calls[0][2].destinationType, "url");
});

test("add_qr_code posts the placement label to the campaign's codes route", async () => {
  const { calls, tools } = setup();
  await call(tools.add_qr_code, { campaignId: CAMPAIGN_ID, label: "Poster, main hall" });
  assert.deepEqual(calls[0], ["POST", `/mcp/qr/campaigns/${CAMPAIGN_ID}/codes`, { label: "Poster, main hall" }]);
});

test("create_webhook never shows the signing secret to the conversation", async () => {
  const { tools } = setup(() => ({ id: ENDPOINT_ID, url: "https://hooks.example.com", secret: "whsec_should_not_leak" }));
  const r = await call(tools.create_webhook, { url: "https://hooks.example.com", eventTypes: [] });
  assert.doesNotMatch(r.content[0].text, /whsec_should_not_leak|"secret"/);
  assert.match(r.content[0].text, /Settings → Webhooks/);
});

test("update_webhook sends only the fields the caller set", async () => {
  const { calls, tools } = setup();
  await call(tools.update_webhook, { endpointId: ENDPOINT_ID, isActive: false });
  assert.deepEqual(calls[0], ["PATCH", `/mcp/webhooks/${ENDPOINT_ID}`, { isActive: false }]);
});

test("delete_webhook sends a DELETE to the endpoint's route", async () => {
  const { calls, tools } = setup();
  await call(tools.delete_webhook, { endpointId: ENDPOINT_ID });
  assert.deepEqual(calls[0].slice(0, 2), ["DELETE", `/mcp/webhooks/${ENDPOINT_ID}`]);
});

test("a write refused by the server becomes a clear tool error, not a thrown exception", async () => {
  const { MitrApiError } = await import("../dist/client.js");
  const { tools } = setup(() => {
    throw new MitrApiError(403, "This API key is missing the 'qr:write' permission.");
  });
  const r = await call(tools.add_qr_code, { campaignId: CAMPAIGN_ID, label: "Poster" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /qr:write/);
});
