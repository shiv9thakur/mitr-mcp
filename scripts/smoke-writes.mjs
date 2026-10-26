#!/usr/bin/env node
// Authenticated smoke test for the MCP write tools, against a live endpoint.
//
//   MITR_API_KEY=mitr_live_... node scripts/smoke-writes.mjs
//
// Use a throwaway key created in Settings → API keys with: Can manage funnels, Can manage QR campaigns,
// Can manage webhooks and Can delete. Revoke it afterwards. The key is read from the environment only and is
// never printed.
//
// What it does: creates, changes and removes one funnel, one QR campaign (with a code, then archived) and one
// paused webhook, all named "MCP smoke test". The funnel and webhook are deleted at the end. The QR campaign
// can only be archived (there is no delete tool), so archive it from the dashboard if you want it gone.
// Set MITR_MCP_URL to test another endpoint; the default is the hosted production one.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const key = (process.env.MITR_API_KEY || "").trim();
if (!/^mitr_(live|test)_/.test(key)) {
  console.error("Set MITR_API_KEY to a throwaway Mitr API key (mitr_live_...).");
  process.exit(2);
}
const url = process.env.MITR_MCP_URL || "https://mcp.mitranalytics.dev/mcp";

const client = new Client({ name: "mitr-smoke-writes", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));

const results = [];
async function step(name, tool, args, { expectError = false, skipOn = null } = {}) {
  let outcome = "PASS";
  let data;
  try {
    const r = await client.callTool({ name: tool, arguments: args });
    const text = r.content?.[0]?.text ?? "";
    if (r.isError) {
      if (skipOn && skipOn.test(text)) outcome = `SKIP (${text.slice(0, 120)})`;
      else outcome = expectError ? "PASS" : `FAIL (${text.slice(0, 160)})`;
    } else if (expectError) {
      outcome = "FAIL (expected an error)";
    } else {
      try { data = JSON.parse(text); } catch { data = text; }
    }
  } catch (e) {
    outcome = `FAIL (${String(e.message || e).slice(0, 160)})`;
  }
  results.push([name, outcome]);
  const label = outcome.startsWith("PASS") ? "PASS" : outcome.startsWith("SKIP") ? "SKIP" : "FAIL";
  console.log(`${label}  ${name}${label === "PASS" ? "" : "  " + outcome}`);
  return data;
}

const tools = (await client.listTools()).tools.map((t) => t.name);
results.push(["tool list has the write tools", tools.includes("create_funnel") && tools.includes("delete_webhook") ? "PASS" : "FAIL"]);
console.log(`${results[0][1]}  tool list has the write tools (${tools.length} tools)`);

// Funnel: create, update, delete.
const steps = [
  { label: "Pricing", matchType: "path", matchValue: "/pricing" },
  { label: "Signed up", matchType: "event_type", matchValue: "signup" },
];
const funnel = await step("create_funnel", "create_funnel", { name: "MCP smoke test", steps });
const funnelId = funnel?.id;
if (funnelId) {
  await step("update_funnel", "update_funnel", { funnelId, name: "MCP smoke test (renamed)", steps });
  await step("delete_funnel", "delete_funnel", { funnelId });
}

// Webhook: create paused, update, delete.
// A plan has a fixed number of webhook endpoints; a workspace already at its limit can't run this part.
const hook = await step("create_webhook (secret withheld)", "create_webhook", {
  url: "https://example.com/mitr-smoke-test", eventTypes: [], isActive: false,
}, { skipOn: /maximum of \d+ webhook endpoint/i });
if (hook && JSON.stringify(hook).includes('"secret"')) results.push(["webhook secret leaked into the result", "FAIL"]), console.log("FAIL  webhook secret leaked into the result");
const hookId = hook?.id;
if (hookId) {
  await step("update_webhook", "update_webhook", { endpointId: hookId, isActive: false });
  await step("delete_webhook", "delete_webhook", { endpointId: hookId });
}

// QR: only if the plan has room for another active campaign.
const campaigns = await step("list_qr_campaigns", "list_qr_campaigns", {});
const list = campaigns?.untrusted_data ?? campaigns;
const max = list?.limits?.maxActiveCampaigns ?? list?.maxCampaigns;
const active = list?.limits?.activeCampaigns ?? 0;
if (max != null && active >= max) {
  console.log(`SKIP  QR create: ${active} of ${max} active campaigns already used on this plan`);
} else {
  const camp = await step("create_qr_campaign", "create_qr_campaign", { name: "MCP smoke test", destinationUrl: "https://mitranalytics.dev/" });
  const campId = camp?.id;
  if (campId) {
    await step("add_qr_code", "add_qr_code", { campaignId: campId, label: "Smoke test placement" });
    await step("update_qr_campaign (archive)", "update_qr_campaign", { campaignId: campId, status: "archived" });
  }
}

// A key without the permission must be refused: ask for a campaign that does not exist as a sanity check on errors.
await step("update_funnel on an unknown id is refused", "update_funnel", {
  funnelId: "00000000-0000-4000-8000-000000000000", name: "x", steps,
}, { expectError: true });

await client.close();
const skipped = results.filter(([, o]) => o.startsWith("SKIP"));
const failed = results.filter(([, o]) => !o.startsWith("PASS") && !o.startsWith("SKIP"));
if (skipped.length) console.log(`\n${skipped.length} step(s) skipped (plan limit): ${skipped.map(([n]) => n).join(", ")}. Run on a workspace with a free webhook slot to cover them.`);
console.log(failed.length ? `\n${failed.length} step(s) failed.` : "\nAll write steps passed. Revoke the throwaway key now.");
process.exit(failed.length ? 1 : 0);
