import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool } from "../toolResult.js";

export function registerAppTools(server: McpServer, client: MitrClient) {
  server.registerTool(
    "list_apps",
    {
      title: "List Mitr apps",
      description:
        "List every app/site registered in your Mitr workspace, with each app's siteId (needed by get_app_report and get_recent_events), name, platform, and connection status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      runTool(async () => {
        const data = await client.get("/mcp/apps");
        return jsonResult(data);
      })
  );

  server.registerTool(
    "add_app",
    {
      title: "Register a new app in Mitr",
      description:
        "Register a new app/site under your Mitr workspace so it can start receiving tracked events. Returns the new app's siteId. The app's SDK secret key is deliberately not returned: tell the user to copy it from the Mitr dashboard (Integration Hub, the app's card). Needs an API key created with permission to register apps; a read-only key gets a clear error.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Human-readable name for the app, e.g. 'Marketing Site'."),
        platformType: z
          .enum(["web", "android", "ios", "desktop", "server"])
          .describe("What kind of app this is."),
        platformIdentifier: z
          .string()
          .min(1)
          .describe(
            "Domain for web (e.g. 'example.com'); bundle ID for iOS/macOS; package name for Android; a free-form service name for server/desktop."
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, platformType, platformIdentifier }) =>
      runTool(async () => {
        const data = await client.post("/mcp/apps", {
          name,
          platformType,
          platformIdentifier,
        });
        return jsonResult(data);
      })
  );
}
