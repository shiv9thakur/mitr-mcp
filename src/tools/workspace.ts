import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { runTool, visitorDataResult } from "../toolResult.js";

// Workspace-wide reads. Visitor-written text (paths, error messages, campaign names) goes through visitorDataResult.
export function registerWorkspaceTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "get_workspace_overview",
    {
      title: "Get the workspace overview",
      description:
        "Get one summary of the whole workspace: every app's traffic, plus its webhooks, QR campaigns, funnels, and anything that needs attention. Call this first when the user asks how things are doing overall.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => runTool(async () => visitorDataResult(await client.get("/mcp/overview")))
  );

  server.registerTool(
    "list_qr_campaigns",
    {
      title: "List QR campaigns",
      description:
        "List your QR campaigns with each campaign's id (needed by get_qr_campaign and the QR write tools), name, status, and scan totals. Also returns your plan's QR limits.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => runTool(async () => visitorDataResult(await client.get("/mcp/qr/campaigns")))
  );

  server.registerTool(
    "get_qr_campaign",
    {
      title: "Get one QR campaign",
      description:
        "Get one QR campaign with its codes and per-code scan counts, to see which placement is working. Use the id from list_qr_campaigns.",
      inputSchema: {
        campaignId: z.string().uuid().describe("The campaign's id, from list_qr_campaigns."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ campaignId }) =>
      runTool(async () => visitorDataResult(await client.get(`/mcp/qr/campaigns/${campaignId}`)))
  );

  server.registerTool(
    "get_webhook_health",
    {
      title: "Check webhook delivery health",
      description:
        "For each webhook endpoint, show delivery counts by status over its recent deliveries (delivered, pending, failed, exhausted) and the latest failure with its error. Payloads are not returned. Use this when a user says their webhook is not receiving events.",
      inputSchema: {
        deliveriesPerEndpoint: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("How many recent deliveries to count per endpoint. Defaults to 50."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ deliveriesPerEndpoint }) =>
      runTool(async () => {
        const query = deliveriesPerEndpoint ? `?deliveries_per_endpoint=${deliveriesPerEndpoint}` : "";
        return visitorDataResult(await client.get(`/mcp/webhooks/health${query}`));
      })
  );
}
