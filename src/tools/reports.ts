import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { runTool, visitorDataResult } from "../toolResult.js";

export function registerReportTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "get_app_report",
    {
      title: "Get an app's analytics report",
      description:
        "Fetch a 7-day analytics report for one app: active users, KPIs (pageviews, unique visitors) with sparklines, traffic overview, acquisition (referrers/UTM/entry pages), geography, device/browser/OS breakdown, web vitals, and conversions. Structured data meant for you to analyze and summarize, not a canned report.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId }) =>
      runTool(async () => {
        const data = await client.get(`/mcp/apps/${siteId}/report`);
        return visitorDataResult(data);
      })
  );

  server.registerTool(
    "get_recent_events",
    {
      title: "Get an app's most recent raw events",
      description:
        "Fetch the most recent raw telemetry events for one app — event type, path, referrer, UTM, device/geo, and custom properties. Useful for spot-checking what's actually being tracked, alongside get_app_report's aggregated view.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        limit: z.number().int().min(1).max(50).optional().describe("Max events to return (default 20, max 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, limit }) =>
      runTool(async () => {
        const query = limit !== undefined ? `?limit=${limit}` : "";
        const data = await client.get(`/mcp/apps/${siteId}/events/recent${query}`);
        return visitorDataResult(data);
      })
  );
}
