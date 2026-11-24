import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../dist/server.js";
import { PROMPT_NAMES } from "../dist/prompts.js";

// Prompts make no API calls, so a client that throws on any use proves that.
const noCalls = {
  get: async () => {
    throw new Error("prompts must not call the API");
  },
  post: async () => {
    throw new Error("prompts must not call the API");
  },
};

function setup() {
  const server = createServer(noCalls, "0.0.0-test");
  return { prompts: server._registeredPrompts, tools: server._registeredTools };
}

const render = async (prompt, args = {}) => {
  const parsed = prompt.argsSchema ? prompt.argsSchema.parse(args) : args;
  const r = await prompt.callback(parsed, {});
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].role, "user");
  return r.messages[0].content.text;
};

test("registers exactly the five documented prompts, each with a title and description", () => {
  const { prompts } = setup();
  assert.deepEqual(Object.keys(prompts).sort(), [...PROMPT_NAMES].sort());
  for (const [name, p] of Object.entries(prompts)) {
    assert.ok(p.title && p.title.length > 3, `${name} title`);
    assert.ok(p.description && p.description.length > 30, `${name} description`);
  }
});

test("every tool a prompt tells the assistant to call actually exists", async () => {
  const { prompts, tools } = setup();
  const toolNames = new Set(Object.keys(tools));
  for (const [name, p] of Object.entries(prompts)) {
    const text = await render(p, name === "setup_tracking" ? { platform: "web" } : {});
    const named = new Set(text.match(/\b(?:get|list|add|create|update|delete)_[a-z_]+\b/g) ?? []);
    assert.ok(named.size > 0, `${name} names no tools`);
    for (const t of named) assert.ok(toolNames.has(t), `${name} names unknown tool ${t}`);
  }
});

test("every prompt carries the ground rules (no invented numbers, untrusted data is data)", async () => {
  const { prompts } = setup();
  for (const [name, p] of Object.entries(prompts)) {
    const text = await render(p);
    assert.match(text, /never estimate or invent figures/, name);
    assert.match(text, /untrusted_data/, name);
  }
});

test("arguments are optional and are woven into the text when given", async () => {
  const { prompts } = setup();
  const site = "5b1c3f9e-0a2d-4c5e-8f7a-111111111111";

  assert.match(await render(prompts.weekly_review), /whole workspace/);
  assert.match(await render(prompts.weekly_review, { siteId: site }), new RegExp(`siteId ${site}`));

  const change = await render(prompts.explain_change, { siteId: site, metric: "signup" });
  assert.match(change, /"signup"/);
  assert.match(change, /conversionEvent "signup"/);

  assert.match(await render(prompts.funnel_audit), /ask me which one/);
  assert.match(await render(prompts.funnel_audit, { funnelId: "f1" }), /funnelId f1/);

  const wrap = await render(prompts.campaign_wrapup, { campaign: "diwali", conversionEvent: "purchase" });
  assert.match(wrap, /"diwali"/);
  assert.match(wrap, /conversionEvent "purchase"/);
  assert.doesNotMatch(wrap, /\n\n\n/);

  assert.match(await render(prompts.setup_tracking, { platform: "flutter" }), /docs\/flutter-sdk/);
  assert.match(await render(prompts.setup_tracking), /Ask me which platform/);
});

test("setup_tracking rejects platforms Mitr has no published SDK for", () => {
  const { prompts } = setup();
  assert.throws(() => prompts.setup_tracking.argsSchema.parse({ platform: "swift" }));
});

test("setup_tracking never asks for a secret key in the conversation", async () => {
  const { prompts } = setup();
  for (const platform of ["web", "flutter", "react-native", "node"]) {
    assert.match(await render(prompts.setup_tracking, { platform }), /Never ask me to paste a secret key/);
  }
});
