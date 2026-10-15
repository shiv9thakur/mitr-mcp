import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMitrClient, type MitrClient } from "./client.js";
import type { MitrConfig } from "./config.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerAppTools } from "./tools/apps.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerFunnelTools } from "./tools/funnels.js";
import { registerReportTools } from "./tools/reports.js";

export function createServer(client: MitrClient, version: string): McpServer {
  const server = new McpServer({ name: "mitr", version });
  registerAppTools(server, client);
  registerReportTools(server, client);
  registerFunnelTools(server, client);
  registerAlertTools(server, client);
  registerBillingTools(server, client);
  return server;
}

export async function startServer(config: MitrConfig, version: string): Promise<void> {
  const client = createMitrClient(config, { userAgent: `mitr-mcp/${version}` });
  const server = createServer(client, version);
  await server.connect(new StdioServerTransport());
}
