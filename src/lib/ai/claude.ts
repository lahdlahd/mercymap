import "server-only";
import { SYSTEM_PROMPT, TOOL_NAME, buildUserMessage, toolDefinition, type ClaimedRequest } from "./analysis";

export type ClaudeResult = { ok: true; input: unknown } | { ok: false; error: string };

const TIMEOUT_MS = 20_000;

// One call to the Anthropic Messages API, forced to answer through the
// record_analysis tool so the answer has a fixed shape. Errors are reduced to
// short codes; response bodies are never logged or stored.
export async function callClaude(
  claimed: ClaimedRequest,
  config: { apiKey: string; model: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeResult> {
  const body = {
    model: config.model,
    max_tokens: 1024,
    temperature: 0,
    system: SYSTEM_PROMPT,
    tools: [toolDefinition(claimed.categories.map((k) => k.key))],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: buildUserMessage(claimed) }],
  };
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network" };
  }
  if (!response.ok) return { ok: false, error: `http_${response.status}` };
  let data: { content?: Array<{ type: string; name?: string; input?: unknown }> };
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const use = data.content?.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
  return use ? { ok: true, input: use.input } : { ok: false, error: "no_tool_use" };
}

// Worth one more try: rate limits, overload, server errors, timeouts.
export function isRetryable(error: string) {
  return error === "timeout" || error === "network" || error === "http_429" || /^http_5\d\d$/.test(error);
}
