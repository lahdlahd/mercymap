"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { looksLikeInvitationToken } from "@/lib/invitations";
import { createClient } from "@/lib/supabase/server";

export async function acceptInvitationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  if (!looksLikeInvitationToken(token)) return { message: friendlyDbError("invitation_invalid_or_expired") };

  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) {
    console.error("accept_invitation failed:", error.code);
    return { message: friendlyDbError(error.message) };
  }
  redirect("/app");
}
