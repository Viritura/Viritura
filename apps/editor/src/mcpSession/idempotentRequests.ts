import type { McpToolResult } from "./toolDispatch";

const MAX_REQUESTS = 512;
const requests = new Map<string, { fingerprint: string; result: McpToolResult }>();

export function executeIdempotentRequest(
  name: string,
  input: Record<string, unknown>,
  execute: () => McpToolResult,
): { result: McpToolResult; replayed: boolean } {
  const requestId = input.requestId;
  if (requestId === undefined) return { result: execute(), replayed: false };
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 64) {
    return {
      result: error("invalid_request_id", "requestId must be a string of 1 to 64 characters."),
      replayed: false,
    };
  }
  const fingerprint = JSON.stringify({ name, input }, (_key, value: unknown) =>
    isObject(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value,
  );
  const existing = requests.get(requestId);
  if (existing) {
    return existing.fingerprint === fingerprint
      ? { result: structuredClone(existing.result), replayed: true }
      : {
          result: error("idempotency_conflict", "This requestId was already used for different arguments."),
          replayed: false,
        };
  }
  if (requests.size >= MAX_REQUESTS) {
    return {
      result: error(
        "request_limit",
        "The session's idempotency cache is full; stop and restart the MCP session before sending new request IDs.",
      ),
      replayed: false,
    };
  }
  const result = execute();
  requests.set(requestId, { fingerprint, result: structuredClone(result) });
  return { result, replayed: false };
}

export function clearIdempotentRequests(): void {
  requests.clear();
}

function error(code: string, message: string): McpToolResult {
  return { content: [{ type: "text", text: message }], structuredContent: { code, message }, isError: true };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
