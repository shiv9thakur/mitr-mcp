import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MitrClient } from "../client.js";
import { jsonResult, runTool, visitorDataResult } from "../toolResult.js";

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
        const data = await client.post<Record<string, unknown>>("/mcp/apps", {
          name,
          platformType,
          platformIdentifier,
        });
        // The backend stopped returning it; also drop it here in case this runs against an older backend.
        const { secretKey: _secret, ...safe } = data ?? {};
        return jsonResult(safe);
      })
  );

  server.registerTool(
    "get_install_snippet",
    {
      title: "Get the install code for an app",
      description:
        "Get the install command and code to add Mitr to one app on a given platform: web (script tag), pixel (email or no-JS image tag), flutter, react-native or node. Returns install (the package command, or null), where (where the code goes), snippet, secretKey (how the user gets the key, never the key itself), notes (pitfalls such as the exact hostname a web app must be served from) and docs. The snippet never contains the secret key: on-device SDKs get the placeholder YOUR_SECRET_KEY and the user copies the key from the Mitr dashboard; Node reads it from MITR_SECRET_KEY. Never ask the user to paste the key into the conversation. A platform that cannot authenticate for this app's type (e.g. node for a web app) returns an error naming the platforms that fit.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
        platform: z
          .enum(["web", "pixel", "flutter", "react-native", "node"])
          .describe("Where the code runs: web, pixel, flutter, react-native or node."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId, platform }) =>
      runTool(async () => jsonResult(await client.get(`/mcp/apps/${siteId}/install?platform=${encodeURIComponent(platform)}`)))
  );

  server.registerTool(
    "verify_installation",
    {
      title: "Check that an app is sending events",
      description:
        "Check whether one app is receiving events: receivingEvents (anything in the last 24 hours), first and last event time, total events, the last diagnostic ping from a mobile SDK, the last 24 hours by event type and by device/OS, and problems: likely causes in plain words when nothing arrives (wrong hostname for web apps, wrong secret key for mobile/server apps, ping but no real events, events that stopped). Read-only. Mitr does not log rejected requests per app, so a domain or key mismatch shows up only as missing events. Call it after the user says they installed the snippet, and again a minute later if nothing has arrived yet.",
      inputSchema: {
        siteId: z.string().uuid().describe("The app's siteId, from list_apps."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ siteId }) => runTool(async () => visitorDataResult(await client.get(`/mcp/apps/${siteId}/installation`)))
  );
}
