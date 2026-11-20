"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAnalysis, type RunResult } from "@/lib/ai/run";
import { getMembership } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { requestDbError } from "@/lib/requests";
import { aiConfig } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

const CONCURRENCY = 3;

// Analyses the requests still waiting for AI suggestions (owners and
// administrators). The database chooses which requests and records the run
// in the audit log; each analysis goes through the usual privacy-redacting
// path. Never throws.
export async function analyseWaitingAction(_state: FormState, _formData: FormData): Promise<FormState> {
  void _state;
  void _formData;
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (!aiConfig()) return { message: "AI suggestions are not set up for this workspace." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_start_waiting", { p_church_id: membership.church.id });
  if (error) {
    console.error("ai_start_waiting failed:", error.code ?? "unknown");
    return { message: requestDbError(error.message) };
  }
  const references = (data ?? []) as string[];
  if (references.length === 0) return { ok: true, message: "No requests are waiting for AI suggestions." };

  const results: RunResult[] = [];
  let next = 0;
  async function worker() {
    while (next < references.length) {
      const reference = references[next++];
      results.push(await runAnalysis(reference));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, references.length) }, worker));

  // The "waiting" card may now be gone, so the page shows the result.
  const done = results.filter((r) => r === "done").length;
  const failed = results.filter((r) => r === "failed" || r === "not_configured").length;
  revalidatePath("/app", "layout");
  redirect(`/app/requests?analysed=${done}&failed=${failed}`);
}
