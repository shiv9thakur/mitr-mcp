import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { runTool, visitorDataResult } from "../toolResult.js";

export const QUERY_DIMENSIONS = ["event_type", "path", "referrer_domain", "utm.source", "utm.medium", "utm.campaign", "utm.term", "utm.content", "country", "region", "city", "device_type", "browser", "os", "language"];

export function registerReportTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "get_app_report",
    {
      title: "Get an app's analytics report",
      description:
        "Fetch an analytics report for one app: active users, KPIs (pageviews, unique visitors) with change against a comparison period and daily sparklines, traffic per day, acquisition (referrers, channels, UTM campaigns, entry pages), geography, device/browser/OS/language breakdown, web vitals, conversions (custom events) and AI crawler activity. Without dates it covers the rolling last 7 days compared with the 7 before. Pass from/to (YYYY-MM-DD, UTC days, inclusive, at most 366 days, nothing in the future) for any other range, and compare to choose the previous period of equal length (default) or the same dates a year earlier. appliedRange in the result states exactly which window and comparison were used; quote it rather than assuming. Structured data meant for you to analyze and summarize, not a canned report.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
          .optional()
          .describe("First day of the range, YYYY-MM-DD (UTC). Alone, the range runs to today."),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
          .optional()
          .describe("Last day of the range, inclusive, YYYY-MM-DD (UTC). Alone, the range is the 7 days ending that day."),
        compare: z
          .enum(["previous_period", "previous_year"])
          .optional()
          .describe("What the KPI changes compare against: the equal-length period just before (default) or the same dates a year earlier."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, from, to, compare }) =>
      runTool(async () => {
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (compare) params.set("compare", compare);
        const qs = params.toString();
        const query = qs ? `?${qs}` : "";
        const data = await client.get(`/mcp/apps/${siteId}/report${query}`);
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
    "describe_events",
    {
      title: "Describe what an app tracks",
      description:
        "List the event types one app sent over the last N days (default 30, max 90), busiest first: for each, the event count, unique visitors, first and last time seen in that window, the percent of events carrying UTM tags, and its most common custom property keys (up to 20, with counts). Call this before get_campaign_report or get_funnel_results to use the app's real event names (e.g. pass a listed event as conversionEvent), and to check whether a custom event is arriving at all. 'pageview' is the automatic page-view event. At most 100 event types; truncated is true if there were more.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        days: z.number().int().min(1).max(90).optional().describe("How many days back to look (default 30, max 90)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, days }) =>
      runTool(async () => {
        const query = days !== undefined ? `?days=${days}` : "";
        const data = await client.get(`/mcp/apps/${siteId}/events/catalog${query}`);
        return visitorDataResult(data);
      })
  );

  const dimension = z
    .string()
    .max(120)
    .describe(
      "One of: " + QUERY_DIMENSIONS.join(", ") + ", or meta.<key> for a custom property key that describe_events lists for this app."
    );

  server.registerTool(
    "query_events",
    {
      title: "Query an app's events",
      description:
        "Answer a specific question about one app's events: one metric (visitors = unique visitors, events = event count, pageviews), optionally for a single event type, either broken down by one dimension (top groups first, up to 50) or as a day/week/month series, with filters, a date range (default: the last 7 days; from/to as YYYY-MM-DD, UTC, inclusive, up to 366 days) and an optional comparison period. Call describe_events first to learn the app's event names and property keys. Dimensions: " +
        QUERY_DIMENSIONS.join(", ") +
        ", meta.<key>. referrer_domain is null for direct visits. For city and meta.* breakdowns, groups with fewer than 3 visitors are hidden and counted in suppressedGroups; say so when it is non-zero. The result's total is the metric over the whole filtered set (for visitors it is not the sum of the rows). appliedRange states the window used, including clampedToRetention when the plan's data retention cut the range short and previousPartial when the comparison period reaches past it. Quote appliedRange, and never present a hidden group's number.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        metric: z.enum(["visitors", "events", "pageviews"]).optional().describe("What to count. Default visitors."),
        eventType: z
          .string()
          .max(100)
          .optional()
          .describe("Only count this event type, e.g. 'signup' (names from describe_events). Not used with metric pageviews."),
        breakdown: dimension.optional().describe("Group by this dimension. Not combinable with interval."),
        interval: z.enum(["day", "week", "month"]).optional().describe("Return a time series instead of a breakdown."),
        filters: z
          .array(
            z.object({
              dim: dimension,
              op: z.enum(["eq", "neq", "contains", "in"]).describe("eq, neq, contains (case-insensitive substring), or in (a list)."),
              value: z.union([z.string().max(200), z.array(z.string().max(200)).min(1).max(20)]).describe("A string, or a list of up to 20 strings for 'in'."),
            })
          )
          .max(10)
          .optional()
          .describe("All filters must match (AND)."),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional().describe("First day, YYYY-MM-DD (UTC)."),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").optional().describe("Last day, inclusive, YYYY-MM-DD (UTC)."),
        compare: z
          .enum(["previous_period", "previous_year"])
          .optional()
          .describe("Add previous values and percent change against the equal-length period before, or the same dates a year earlier."),
        limit: z.number().int().min(1).max(50).optional().describe("Max breakdown rows (default 20, max 50)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, ...body }) =>
      runTool(async () => {
        const data = await client.post(`/mcp/apps/${siteId}/query`, body);
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
        const qs = params.toString();
        const query = qs ? `?${qs}` : "";
        const data = await client.get(`/mcp/apps/${siteId}/campaigns${query}`);
        return visitorDataResult(data);
      })
  );
}
