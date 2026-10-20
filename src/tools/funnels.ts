import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool } from "../toolResult.js";

export function registerFunnelTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "list_funnels",
    {
      title: "List Mitr funnels",
      description:
        "List every saved conversion funnel in your Mitr workspace, with each funnel's id (needed by get_funnel_results), name, and step definitions.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const data = await client.get("/mcp/funnels");
        return jsonResult(data);
      })
  );

  server.registerTool(
    "get_funnel_results",
    {
      title: "Get funnel conversion results",
      description:
        "Compute conversion results for one funnel over a date range: entered/converted counts, conversion rate, and drop-off at each step. Defaults to the last 30 days.",
      inputSchema: {
        funnelId: z.string().uuid().describe("The funnel's id, from list_funnels."),
        start: z.string().datetime().optional().describe("ISO 8601 start of the range (default: 30 days ago)."),
        end: z.string().datetime().optional().describe("ISO 8601 end of the range (default: now)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ funnelId, start, end }) =>
      runTool(async () => {
        const params = new URLSearchParams();
        if (start) params.set("start", start);
        if (end) params.set("end", end);
        const query = params.toString() ? `?${params.toString()}` : "";
        const data = await client.get(`/mcp/funnels/${funnelId}/results${query}`);
        return jsonResult(data);
      })
  );
}
