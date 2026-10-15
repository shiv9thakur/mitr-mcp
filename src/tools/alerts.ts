import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool } from "../toolResult.js";

export function registerAlertTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "get_alert_rule",
    {
      title: "Get the workspace's traffic alert rule",
      description:
        "Get your workspace's traffic-anomaly alert configuration (spike/drop direction, threshold %, notification channel), if one is set. Returns { rule: null } if none is configured.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const data = await client.get("/mcp/alerts");
        return jsonResult(data);
      })
  );
}
