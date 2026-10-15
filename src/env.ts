import { ConfigError, loadConfig, type MitrConfig } from "./config.js";

/** Reads and validates the environment, or prints a one-line reason to stderr and exits with code 1. */
export function loadConfigOrExit(vars: Record<string, string | undefined> = process.env): MitrConfig {
  try {
    return loadConfig(vars);
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : String(err));
    process.exit(1);
  }
}
