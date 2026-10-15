import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool } from "../toolResult.js";

export function registerBillingTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "get_billing_usage",
    {
      title: "Get workspace billing and quota usage",
      description:
        "Get your workspace's current plan, subscription status, and quota usage (events used/limit, usage %, apps used/limit). Useful context before recommending changes that would affect event volume or app count.",
      inputSchema: {},
    },
    async () =>
      runTool(async () => {
        const data = await client.get("/mcp/billing/usage");
        return jsonResult(data);
      })
  );
}
