import "server-only";
import { aiConfig } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { PROMPT_VERSION, parseOutput, type ClaimedRequest } from "./analysis";
import { callClaude, isRetryable } from "./claude";

export type RunResult = "done" | "failed" | "skipped" | "not_configured";

// Analyses one request. Safe to call more than once: the database hands a
// request to one run at a time and limits attempts. Never throws.
export async function runAnalysis(reference: string, options: { force?: boolean } = {}): Promise<RunResult> {
  const config = aiConfig();
  if (!config) return "not_configured";
  const admin = createAdminClient(config.supabaseSecretKey);

  let claimed: ClaimedRequest | null = null;
  try {
    const { data, error } = await admin.rpc("ai_claim", { p_reference: reference, p_force: Boolean(options.force) });
    if (error) {
      console.error("ai_claim failed:", error.code ?? "unknown");
      return "failed";
    }
    claimed = data as ClaimedRequest | null;
    if (!claimed) return "skipped";

    let result = await callClaude(claimed, config);
    if (!result.ok && isRetryable(result.error)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      result = await callClaude(claimed, config);
    }
    const output = result.ok ? parseOutput(result.input, claimed) : null;
    const errorCode = result.ok ? (output ? null : "invalid_output") : result.error;
    if (errorCode) console.error("AI analysis failed:", errorCode);

    const saved = await admin.rpc("ai_save", {
      p_request_id: claimed.request_id,
      p_ok: Boolean(output),
      p_output: output,
      p_error: errorCode,
      p_provider: "anthropic",
      p_model: config.model,
      p_prompt_version: PROMPT_VERSION,
    });
    if (saved.error) {
      console.error("ai_save failed:", saved.error.code ?? "unknown");
      return "failed";
    }
    return output ? "done" : "failed";
  } catch (error) {
    console.error("AI analysis crashed:", error instanceof Error ? error.name : "unknown");
    if (claimed) {
      await admin.rpc("ai_save", {
        p_request_id: claimed.request_id, p_ok: false, p_output: null, p_error: "crashed",
        p_provider: "anthropic", p_model: config.model, p_prompt_version: PROMPT_VERSION,
      }).then(() => undefined, () => undefined);
    }
    return "failed";
  }
}
