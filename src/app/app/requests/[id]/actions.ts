"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { runAnalysis } from "@/lib/ai/run";
import { aiConfig } from "@/lib/server-env";
import { getCurrentUser } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { isRequestStatus, needsNote, requestDbError, STATUS_LABEL } from "@/lib/requests";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

const SESSION_ENDED: FormState = { message: "Your session has ended. Sign in again." };
const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

// Every action re-reads nothing from the browser except the request id, the
// chosen change and the note. The database checks membership and the rules.
async function run(requestId: string, fn: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{ error: { message: string; code?: string } | null }>, ok: string): Promise<FormState> {
  if (!(await getCurrentUser())) return SESSION_ENDED;
  if (!uuidSchema.safeParse(requestId).success) return { message: "That request could not be found." };
  const supabase = await createClient();
  const { error } = await fn(supabase);
  const path = `/app/requests/${requestId}`;
  if (error) {
    console.error("request action failed:", error.code ?? "unknown");
    // Someone else moved the request on. The form that was used may no longer
    // be on the page, so the notice is shown by the page itself.
    if (/status_changed/.test(error.message)) {
      revalidatePath(path);
      redirect(`${path}?changed=1`);
    }
    if (/resource_|insufficient_available|category_changed|suggestion_changed|no_suggestion|volunteer_|already_assigned|invalid_transition/.test(error.message)) revalidatePath(path);
    return { message: requestDbError(error.message) };
  }
  revalidatePath(path);
  revalidatePath("/app/requests");
  revalidatePath("/app/resources", "layout");
  return { ok: true, message: ok };
}

// fromStatus is bound on the server when the page renders: it is the status
// the person was looking at, so a change made meanwhile by someone else is
// detected rather than overwritten.
export async function changeStatusAction(
  requestId: string,
  from: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const to = text(formData, "toStatus");
  const note = text(formData, "note").slice(0, 1000);
  if (!isRequestStatus(to)) return { fieldErrors: { toStatus: "Choose what happens next." }, values: { note } };
  if (!isRequestStatus(from)) return { message: "Refresh the page and try again." };
  if (needsNote(from, to) && note.length < 3) {
    return { fieldErrors: { note: "Please add a short note explaining this." }, values: { toStatus: to, note } };
  }
  const result = await run(requestId, (s) => s.rpc("change_request_status", {
    p_request_id: requestId, p_from_status: from, p_to_status: to, p_note: note || null,
  }), `Status changed to ${STATUS_LABEL[to]}.`);
  // Once a request is waiting for a resource, the AI looks again so it can
  // suggest one of the fitting resources. Staff still choose.
  if (result.ok && to === "awaiting_match" && aiConfig()) {
    const supabase = await createClient();
    const { data } = await supabase.from("requests").select("reference").eq("id", requestId).maybeSingle();
    const reference = (data as { reference: string } | null)?.reference;
    if (reference) after(() => runAnalysis(reference, { force: true }).then(() => undefined));
  }
  return result;
}

export async function addNoteAction(requestId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const note = text(formData, "note").slice(0, 2000);
  if (!note) return { fieldErrors: { note: "Write a note first." } };
  return run(requestId, (s) => s.rpc("add_request_note", { p_request_id: requestId, p_note: note }), "Note added.");
}

export async function flagAttentionAction(requestId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const reason = text(formData, "reason").slice(0, 500);
  if (reason.length < 3) return { fieldErrors: { reason: "Say briefly what the concern is." } };
  return run(requestId, (s) => s.rpc("flag_request_attention", { p_request_id: requestId, p_reason: reason }),
    "Concern raised. It now shows as needing attention.");
}

export async function acknowledgeAttentionAction(requestId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const note = text(formData, "note").slice(0, 1000);
  if (note.length < 3) return { fieldErrors: { note: "Record what was done or decided." } };
  return run(requestId, (s) => s.rpc("acknowledge_request_attention", { p_request_id: requestId, p_note: note }),
    "Recorded as reviewed.");
}

// Approval and reservation happen together in one database transaction.
export async function approveAction(requestId: string, from: string, _state: FormState, formData: FormData): Promise<FormState> {
  const resourceId = text(formData, "resourceId");
  const note = text(formData, "note").slice(0, 1000);
  if (!uuidSchema.safeParse(resourceId).success) {
    return { fieldErrors: { resourceId: "Choose a resource to reserve." }, values: { note } };
  }
  return run(requestId, (s) => s.rpc("approve_allocation", {
    p_request_id: requestId, p_from_status: from, p_resource_id: resourceId, p_note: note || null,
  }), "Approved. The stock is reserved for this request.");
}

export async function fulfilAction(requestId: string, from: string, _state: FormState, formData: FormData): Promise<FormState> {
  const note = text(formData, "note").slice(0, 1000);
  return run(requestId, (s) => s.rpc("record_fulfilment", {
    p_request_id: requestId, p_from_status: from, p_note: note || null,
  }), "Recorded as fulfilled.");
}

// Staff ask for a fresh analysis. The database first checks they belong to the
// church and records the request; only then does the server run it.
export async function rerunAiAction(requestId: string): Promise<FormState> {
  if (!(await getCurrentUser())) return SESSION_ENDED;
  if (!uuidSchema.safeParse(requestId).success) return { message: "That request could not be found." };
  if (!aiConfig()) return { message: "AI suggestions are not set up for this workspace." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_request_rerun", { p_request_id: requestId });
  if (error) {
    console.error("ai_request_rerun failed:", error.code ?? "unknown");
    return { message: requestDbError(error.message) };
  }
  const outcome = await runAnalysis(String(data), { force: true });
  revalidatePath(`/app/requests/${requestId}`);
  revalidatePath("/app/requests");
  if (outcome === "done") return { ok: true, message: "Suggestions updated." };
  if (outcome === "skipped") return { message: "An analysis is already running. Refresh in a moment." };
  return { message: "The AI could not be reached. Try again later; everything else works as normal." };
}

// Accepts the suggested kind of help. The category and the analysis shown are
// bound on the server, so a stale page cannot apply an old suggestion.
export async function applySuggestedCategoryAction(requestId: string, fromCategory: string, analysisId: string): Promise<FormState> {
  if (!uuidSchema.safeParse(analysisId).success) return { message: "Refresh the page and try again." };
  return run(requestId, (s) => s.rpc("apply_ai_category", {
    p_request_id: requestId, p_from_category: fromCategory, p_analysis_id: analysisId,
  }), "Kind of help updated.");
}

// Gives an approved request to a volunteer. The brief is what staff saw and
// edited; the database checks the request is still approved and the
// volunteer belongs to this church and is available.
export async function assignVolunteerAction(requestId: string, from: string, _state: FormState, formData: FormData): Promise<FormState> {
  const volunteerId = text(formData, "volunteerId");
  const brief = String(formData.get("brief") ?? "").trim();
  if (!uuidSchema.safeParse(volunteerId).success) {
    return { fieldErrors: { volunteerId: "Choose a volunteer." }, values: { brief } };
  }
  if (brief.length < 1 || brief.length > 2000) {
    return { fieldErrors: { brief: "Write a short brief of 2,000 characters or fewer." }, values: { brief } };
  }
  return run(requestId, (s) => s.rpc("create_assignment", {
    p_request_id: requestId, p_from_status: from, p_volunteer_id: volunteerId, p_task_brief: brief,
  }), "Task given. Copy the brief or send it on WhatsApp.");
}

export async function updateTaskAction(requestId: string, assignmentId: string, from: string, to: string): Promise<FormState> {
  if (!uuidSchema.safeParse(assignmentId).success) return { message: "That task could not be found." };
  return run(requestId, (s) => s.rpc("update_assignment_status", {
    p_assignment_id: assignmentId, p_from_status: from, p_to_status: to,
  }), to === "completed" ? "Task completed. Record the delivery when the help has been given." : "Task updated.");
}
