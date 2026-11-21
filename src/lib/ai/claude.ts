import "server-only";
import { SYSTEM_PROMPT, TOOL_NAME, buildUserMessage, toolDefinition, type ClaimedRequest } from "./analysis";

export type ClaudeResult = { ok: true; input: unknown } | { ok: false; error: string };

const TIMEOUT_MS = 20_000;

// The request body. Claude Haiku 5.5 accepts a forced tool choice, so the
// answer always comes through record_analysis. Sonnet 5.5 and Opus 5.5 reject a
// forced tool choice, so they get "auto" and the prompt tells them to use the
// tool. No sampling parameters: the 5.5 models reject non-default values.
// Every answer is still checked by parseOutput and again by the database.
export function requestBody(claimed: ClaimedRequest, model: string) {
  const forced = /haiku/i.test(model);
  return {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [toolDefinition(claimed.categories.map((k) => k.key))],
    tool_choice: forced ? { type: "tool", name: TOOL_NAME } : { type: "auto" },
    messages: [{ role: "user", content: buildUserMessage(claimed) }],
  };
}

// One call to the Anthropic Messages API. Errors are reduced to short codes;
// for a rejected request Anthropic's own error type and message are logged
// (they describe the request settings, not its content). Response bodies are
// never stored.
export async function callClaude(
  claimed: ClaimedRequest,
  config: { apiKey: string; model: string; baseUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeResult> {
  const body = requestBody(claimed, config.model);
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
    if (error instanceof Error && error.name === "TimeoutError") return { ok: false, error: "timeout" };
    // Name and low-level code only: a fetch error message can quote header
    // values, and the API key is a header.
    const cause = error instanceof Error ? (error as Error & { cause?: { code?: string; name?: string } }).cause : undefined;
    console.error(`Anthropic request not sent: ${error instanceof Error ? error.name : "unknown"}${cause?.code ? ` ${cause.code}` : cause?.name ? ` ${cause.name}` : ""}`);
    return { ok: false, error: "network" };
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { type?: string; message?: string } } | null;
    if (detail?.error) {
      console.error(`Anthropic ${response.status}: ${detail.error.type ?? "error"}: ${String(detail.error.message ?? "").slice(0, 200)}`);
    }
    return { ok: false, error: `http_${response.status}` };
  }
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
