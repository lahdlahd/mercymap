"use server";

import { revalidatePath } from "next/cache";
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
    if (/status_changed/.test(error.message)) revalidatePath(path);
    return { message: requestDbError(error.message) };
  }
  revalidatePath(path);
  revalidatePath("/app/requests");
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
  if (needsNote(to) && note.length < 3) {
    return { fieldErrors: { note: "Please add a short note explaining this." }, values: { toStatus: to, note } };
  }
  return run(requestId, (s) => s.rpc("change_request_status", {
    p_request_id: requestId, p_from_status: from, p_to_status: to, p_note: note || null,
  }), `Status changed to ${STATUS_LABEL[to]}.`);
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
