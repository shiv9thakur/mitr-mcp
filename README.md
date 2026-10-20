# @mitr-analytics/mcp

Ask Claude, Gemini or any other [MCP](https://modelcontextprotocol.io) client about your [Mitr](https://mitranalytics.dev) analytics, in plain English. It reads your own data (apps, reports, funnels, alerts, plan usage) and hands it to the assistant to analyse.

Mitr is cookie-free analytics, so there is no consent banner to wire up and nothing here changes that: this server only reads what is already in your dashboard.

## What you can ask

- "Which of my apps had the biggest drop in visitors this week, and where did it come from?"
- "Show my signup funnel for the last 30 days. Where do people leave?"
- "Is anything odd in the last events for my marketing site? Are the UTM tags coming through?"
- "How much of my monthly event quota have I used?"
- "Register a new web app called Docs for docs.example.com."

## Set up (about two minutes)

You need [Node.js](https://nodejs.org) 18 or newer, and a Mitr account.

**1. Create an API key.** In the dashboard open **Settings → API keys & AI assistants → Create key**, give it a name (for example "Claude Desktop") and copy it. It is shown **once**.

Keys are **read-only** unless you tick "Can register apps" when creating them (needed only for `add_app`), and they expire after 365 days by default (30, 90, 365 days or never). A key stops working if you leave or are removed from the workspace it was created in.

**2. Add Mitr to your assistant.**

*Claude Desktop*: open `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`) and add:

```json
{
  "mcpServers": {
    "mitr": {
      "command": "npx",
      "args": ["-y", "@mitr-analytics/mcp"],
      "env": { "MITR_API_KEY": "mitr_live_..." }
    }
  }
}
```

*Gemini CLI*: add the same `mcpServers` block to `~/.gemini/settings.json`.

*Claude Code*:

```bash
claude mcp add mitr --env MITR_API_KEY=mitr_live_... -- npx -y @mitr-analytics/mcp
```

**3. Restart the assistant** and ask a question. The dashboard shows when the key was last used.

## Tools

| Tool | What it does |
|---|---|
| `list_apps` | Every app in your workspace, with the `siteId` the other tools need. |
| `get_app_report` | A 7-day report for one app: visitors, pageviews, traffic, sources, countries, devices, web vitals, conversions. |
| `get_recent_events` | The latest raw events for one app, to check what is really being tracked. |
| `list_funnels` | Your saved conversion funnels. |
| `get_funnel_results` | Step-by-step conversion and drop-off for one funnel over a date range. |
| `get_alert_rule` | Your traffic spike/drop alert settings, if you have set one. |
| `get_billing_usage` | Your plan, subscription status and event usage. |
| `add_app` | Register a new app. The only tool that changes anything, and it needs a key with "Can register apps". The app's secret key is not returned: copy it from the dashboard. |

There is deliberately no tool to delete anything, edit alerts or webhooks, or manage your team.

## Security and privacy

- **A key sees what you see.** It has the same read access to your workspace as you do in the dashboard. Treat it like a password.
- **Revoke it any time** under Settings → API keys. It stops working immediately.
- **It sits in your assistant's config file in plain text.** Use a separate key per tool, so you can revoke one without breaking the others.
- **Your AI provider sees the data you ask about.** Reports and recent events (page paths, UTM tags, device and location summaries, any custom event properties you send) are returned to the assistant, so they are covered by that provider's terms. Mitr itself identifies visitors only by hashed identifiers; see [how we count visitors without cookies](https://mitranalytics.dev/blog/why-we-built-analytics-without-cookies).
- **Visitor data is marked as untrusted.** Page paths, referrers, UTM tags and event properties are written by your visitors, so anyone can put text in them, including text aimed at an AI. Reports and recent events are cleaned of hidden characters and returned inside an `untrusted_data` envelope telling the assistant to treat them as data, never instructions.
- **No secrets in the conversation.** `add_app` doesn't return the new app's SDK secret key; copy it from the dashboard.
- The key is only ever sent over HTTPS (plain `http://` is accepted only for `localhost`).

## Plans

During early access the MCP server works on every Mitr plan, including Free. After early access ends it is part of the paid plans; Free workspaces then get a message pointing to [pricing](https://mitranalytics.dev/pricing), and upgrading restores access with the same key.

## Troubleshooting

Run `npx -y @mitr-analytics/mcp --version` in a terminal. If that prints a version, the package works and the problem is in the client config.

| You see | What to do |
|---|---|
| `MITR_API_KEY is not set` | The `env` block is missing or in the wrong place in the client config. |
| "Your Mitr API key was rejected" | The key expired, was revoked or was copied wrongly, or you're no longer in its workspace. Create a new one in Settings → API keys. |
| "missing the 'apps:write' permission" | The key is read-only. Create one with "Can register apps" ticked to use `add_app`. |
| "early-access period has ended for the Free plan" | Upgrade the workspace; the same key starts working again. |
| "Mitr is rate-limiting this key" | Too many requests in a short time. Wait a minute. |
| `npx: command not found` | Install Node.js 18+, then restart the assistant so it picks up the new PATH. |
| "Could not reach Mitr" | Check your connection or proxy. Only set `MITR_API_BASE_URL` if you were told to. |

## Configuration

| Variable | Required | Default |
|---|---|---|
| `MITR_API_KEY` | yes | none |
| `MITR_API_BASE_URL` | no | `https://api.mitranalytics.dev` |

## Development

```bash
npm install
npm test                                        # builds, then unit tests + an end-to-end stdio test against a stub API
npx @modelcontextprotocol/inspector node dist/index.js   # try the tools by hand (set MITR_API_KEY first)
```

Questions or problems: support@mitranalytics.dev

## License

MIT
