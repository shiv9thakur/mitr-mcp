#!/usr/bin/env node
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const HELP = `mitr-mcp ${pkg.version}: Mitr analytics for Claude, Gemini and other MCP clients.

Run by an MCP client over stdio; you normally don't run it by hand.

Environment:
  MITR_API_KEY        required. Create one at https://app.mitranalytics.dev (Settings → API keys)
  MITR_API_BASE_URL   optional. Defaults to https://api.mitranalytics.dev

Options:
  -v, --version       print the version
  -h, --help          print this help
`;

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") {
  console.log(pkg.version);
  process.exit(0);
}
if (arg === "--help" || arg === "-h") {
  console.log(HELP);
  process.exit(0);
}

const { loadConfigOrExit } = await import("./env.js");
const { startServer } = await import("./server.js");
await startServer(loadConfigOrExit(), pkg.version);
