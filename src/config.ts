export const DEFAULT_API_BASE_URL = "https://api.mitranalytics.dev";
const SETTINGS_URL = "https://app.mitranalytics.dev (Settings → API keys)";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface MitrConfig {
  apiKey: string;
  apiBaseUrl: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Validates the server's environment. Pure, so it can be tested without exiting the process. */
export function loadConfig(vars: Record<string, string | undefined>): MitrConfig {
  const apiKey = (vars.MITR_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new ConfigError(
      `MITR_API_KEY is not set. Create a key at ${SETTINGS_URL} and add it to this server's "env" in your MCP client config.`
    );
  }
  if (!/^mitr_(live|test)_\S{20,}$/.test(apiKey)) {
    throw new ConfigError(
      `MITR_API_KEY doesn't look like a Mitr API key (they start with "mitr_live_"). Copy it again from ${SETTINGS_URL}.`
    );
  }

  const rawBase = (vars.MITR_API_BASE_URL ?? "").trim() || DEFAULT_API_BASE_URL;
  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new ConfigError(`MITR_API_BASE_URL is not a valid URL: ${rawBase}`);
  }
  // The key goes in an Authorization header, so never send it over plain http to anything but this machine.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError(
      `MITR_API_BASE_URL must use https:// (plain http is only allowed for localhost). Got: ${rawBase}`
    );
  }

  return { apiKey, apiBaseUrl: rawBase.replace(/\/+$/, "") };
}
