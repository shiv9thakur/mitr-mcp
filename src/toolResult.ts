import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MitrApiError } from "./client.js";

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof MitrApiError) {
      return errorResult(err.status ? `Mitr API error (${err.status}): ${err.message}` : err.message);
    }
    return errorResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
