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

  server.registerTool(
    "get_campaign_report",
    {
      title: "Get an app's marketing campaign report",
      description:
        "Marketing attribution for one app over the last 7-90 days: visitors, pageviews and conversions per UTM campaign, source, medium or source+medium, each compared with the previous period of the same length. Attribution is first-touch (a visitor's landing-page UTM tags stay on their later events). Pass conversionEvent (e.g. \"signup\") to count that custom event as a conversion; otherwise conversions are 0. untaggedShare is the percent of visitors with no UTM tags — if it is high, say so, because the campaign numbers then cover only part of the traffic. Use it to answer which channel or campaign is working, then compare with get_app_report for the full picture.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        days: z.number().int().min(1).max(90).optional().describe("Window length in days (default 30, max 90)."),
        groupBy: z
          .enum(["campaign", "source", "medium", "source_medium"])
          .optional()
          .describe("How to group traffic (default campaign)."),
        conversionEvent: z
          .string()
          .max(100)
          .optional()
          .describe("Custom event name that counts as a conversion, e.g. signup or purchase."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, days, groupBy, conversionEvent }) =>
      runTool(async () => {
        const params = new URLSearchParams();
        if (days !== undefined) params.set("days", String(days));
        if (groupBy !== undefined) params.set("group_by", groupBy);
        if (conversionEvent !== undefined) params.set("conversion_event", conversionEvent);
        const query = params.size ? `?${params}` : "";
        const data = await client.get(`/mcp/apps/${siteId}/campaigns${query}`);
        return visitorDataResult(data);
      })
  );
}
