import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool } from "../toolResult.js";

// Write tools. Each needs its own API key permission (funnels:write, qr:write, webhooks:write); deletes also need
// "delete". A key without the permission gets a clear error from the server, not a silent no-op.

const funnelStep = z.object({
  label: z.string().min(1).max(120).describe("Name of this step, e.g. 'Pricing page'."),
  matchType: z
    .enum(["path", "event_type"])
    .describe("'path' matches a page path such as /pricing; 'event_type' matches a custom event name such as signup."),
  matchValue: z.string().min(1).describe("The path (e.g. /pricing) or the event name (e.g. signup)."),
  siteId: z.string().uuid().optional().describe("Limit this step to one app. Leave out to match any app in the workspace."),
});

const eventTypes = z.array(z.string().min(1)).describe("Event names this endpoint receives. Empty means none.");

// Webhook create responses include the signing secret. Hand it to the user from the dashboard instead of putting it in
// the conversation, the same way add_app withholds the SDK secret.
function withoutSecret(data: unknown): unknown {
  if (data && typeof data === "object" && "secret" in data) {
    const { secret: _secret, ...rest } = data as Record<string, unknown>;
    return { ...rest, note: "The signing secret is not shown here. Copy it from Settings → Webhooks in the Mitr dashboard." };
  }
  return data;
}

export function registerWriteTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "create_funnel",
    {
      title: "Create a conversion funnel",
      description:
        "Create a funnel of 2 or more ordered steps (each a page path or a custom event) to measure conversion through. Returns the new funnel. Needs an API key with the funnels:write permission.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Name for the funnel, e.g. 'Signup'."),
        steps: z.array(funnelStep).min(1).max(10),
        utmCampaign: z.string().max(120).optional().describe("Scope the funnel to one campaign link's utm_campaign key."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => jsonResult(await client.post("/mcp/funnels", args)))
  );

  server.registerTool(
    "update_funnel",
    {
      title: "Update a conversion funnel",
      description:
        "Replace a funnel's name and steps. This is a full update: send every step, not only the ones that change. Needs funnels:write. Get the funnelId from list_funnels.",
      inputSchema: {
        funnelId: z.string().uuid(),
        name: z.string().min(1).max(120),
        steps: z.array(funnelStep).min(1).max(10),
        utmCampaign: z.string().max(120).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ funnelId, ...body }) =>
      runTool(async () => jsonResult(await client.put(`/mcp/funnels/${funnelId}`, body)))
  );

  server.registerTool(
    "delete_funnel",
    {
      title: "Delete a conversion funnel",
      description:
        "Permanently delete a funnel and its results history. Cannot be undone. Needs both funnels:write and delete permissions. Confirm with the user before calling.",
      inputSchema: { funnelId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ funnelId }) =>
      runTool(async () => jsonResult(await client.delete(`/mcp/funnels/${funnelId}`)))
  );

  server.registerTool(
    "create_qr_campaign",
    {
      title: "Create a QR campaign",
      description:
        "Create a trackable QR campaign that sends scanners to a destination URL. Add codes per placement with add_qr_code. Returns the new campaign. Free plans allow one active campaign. Needs the qr:write permission.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Name for the campaign, e.g. 'Demo day 2026'."),
        destinationUrl: z.string().url().startsWith("https://").describe("Where scanners land. Must be https."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) =>
      runTool(async () => jsonResult(await client.post("/mcp/qr/campaigns", { ...args, destinationType: "url" })))
  );

  server.registerTool(
    "update_qr_campaign",
    {
      title: "Update a QR campaign",
      description:
        "Rename a QR campaign, change its destination, or change its status: 'active', 'paused' or 'archived'. Archiving stops the campaign's codes from being created and keeps its history; it is reversible with status 'active'. Needs qr:write.",
      inputSchema: {
        campaignId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        destinationUrl: z.string().url().startsWith("https://").optional(),
        status: z.enum(["active", "paused", "archived"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ campaignId, ...changes }) =>
      runTool(async () => {
        const body = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
        return jsonResult(await client.patch(`/mcp/qr/campaigns/${campaignId}`, body));
      })
  );

  server.registerTool(
    "add_qr_code",
    {
      title: "Add a QR code placement to a campaign",
      description:
        "Add one printable code to a campaign, labelled by where it will be placed, e.g. 'Poster, main hall'. Each code is counted separately. Needs qr:write.",
      inputSchema: {
        campaignId: z.string().uuid(),
        label: z.string().min(1).max(120).describe("Where this code will be placed."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ campaignId, label }) =>
      runTool(async () => jsonResult(await client.post(`/mcp/qr/campaigns/${campaignId}/codes`, { label })))
  );

  server.registerTool(
    "create_webhook",
    {
      title: "Create a webhook endpoint",
      description:
        "Send tracked events to an https URL you control. Returns the endpoint, without its signing secret, which is copied from the dashboard. Needs webhooks:write.",
      inputSchema: {
        url: z.string().url().startsWith("https://"),
        eventTypes,
        isActive: z.boolean().optional().describe("Defaults to true."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      runTool(async () => jsonResult(withoutSecret(await client.post("/mcp/webhooks", args))))
  );

  server.registerTool(
    "update_webhook",
    {
      title: "Update a webhook endpoint",
      description:
        "Change a webhook's URL, its event types, or switch it on or off with isActive. Needs webhooks:write. Get the endpointId from the dashboard or the webhook health tool.",
      inputSchema: {
        endpointId: z.string().uuid(),
        url: z.string().url().startsWith("https://").optional(),
        eventTypes: eventTypes.optional(),
        isActive: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ endpointId, ...changes }) =>
      runTool(async () => {
        const body = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
        return jsonResult(withoutSecret(await client.patch(`/mcp/webhooks/${endpointId}`, body)));
      })
  );

  server.registerTool(
    "delete_webhook",
    {
      title: "Delete a webhook endpoint",
      description:
        "Permanently delete a webhook endpoint and its delivery log. Cannot be undone. Needs both webhooks:write and delete. Confirm with the user before calling; to pause it instead, use update_webhook with isActive false.",
      inputSchema: { endpointId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ endpointId }) =>
      runTool(async () => jsonResult(await client.delete(`/mcp/webhooks/${endpointId}`)))
  );
}
