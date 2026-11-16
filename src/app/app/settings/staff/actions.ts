"use server";

import { revalidatePath } from "next/cache";
import { canManageStaff, getCurrentUser, getMembership } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { generateInvitationToken, invitationExpiry, invitationUrl } from "@/lib/invitations";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors, inviteSchema, roleSchema, uuidSchema } from "@/lib/validation";

const STAFF_PATH = "/app/settings/staff";
const SESSION_ENDED: FormState = { message: "Your session has ended. Sign in again." };
const NOT_ALLOWED: FormState = { message: "You do not have permission to do that." };

// The church always comes from the caller's own membership, read on the
// server. It is never taken from the form.
async function context() {
  const user = await getCurrentUser();
  const membership = user ? await getMembership() : null;
  return user && membership ? { user, membership } : null;
}

export async function inviteStaffAction(_state: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (!ctx) return SESSION_ENDED;
  if (!canManageStaff(ctx.membership.role)) return NOT_ALLOWED;

  const raw = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "") };
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: raw };
  if (parsed.data.role === "admin" && ctx.membership.role !== "owner") {
    return { fieldErrors: { role: "Only an owner can invite an administrator." }, values: raw };
  }

  const supabase = await createClient();
  const churchId = ctx.membership.church.id;

  const members = await supabase.rpc("list_church_members", { p_church_id: churchId });
  if (members.error) return { message: friendlyDbError(members.error.message), values: raw };
  const existing = (members.data as Array<{ email: string }>).some(
    (m) => m.email?.toLowerCase() === parsed.data.email,
  );
  if (existing) return { fieldErrors: { email: "That person is already a member of this church." }, values: raw };

  const { token, tokenHash } = generateInvitationToken();
  const { error } = await supabase.from("invitations").insert({
    church_id: churchId,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: tokenHash,
    invited_by: ctx.user.id,
    expires_at: invitationExpiry().toISOString(),
  });
  if (error) {
    console.error("invitation insert failed:", error.code);
    return { message: friendlyDbError(error.message), values: raw };
  }

  revalidatePath(STAFF_PATH);
  return {
    ok: true,
    message: `Invitation created for ${parsed.data.email}.`,
    data: { url: invitationUrl(token), email: parsed.data.email },
  };
}

export async function revokeInvitationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (!ctx) return SESSION_ENDED;
  if (!canManageStaff(ctx.membership.role)) return NOT_ALLOWED;
  const id = uuidSchema.safeParse(formData.get("invitationId"));
  if (!id.success) return { message: "That invitation could not be found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .delete()
    .eq("id", id.data)
    .eq("church_id", ctx.membership.church.id)
    .select("id");
  if (error) return { message: friendlyDbError(error.message) };
  if (!data?.length) return { message: "That invitation was already used or revoked." };

  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Invitation revoked." };
}

export async function changeRoleAction(_state: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (!ctx) return SESSION_ENDED;
  const id = uuidSchema.safeParse(formData.get("membershipId"));
  const role = roleSchema.safeParse(formData.get("role"));
  if (!id.success || !role.success) return { message: "Choose a valid role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", { p_membership_id: id.data, p_role: role.data });
  if (error) return { message: friendlyDbError(error.message) };

  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Role updated." };
}

export async function removeMemberAction(_state: FormState, formData: FormData): Promise<FormState> {
  const ctx = await context();
  if (!ctx) return SESSION_ENDED;
  const id = uuidSchema.safeParse(formData.get("membershipId"));
  if (!id.success) return { message: "That person could not be found." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", { p_membership_id: id.data });
  if (error) return { message: friendlyDbError(error.message) };

  revalidatePath(STAFF_PATH);
  return { ok: true, message: "Removed from this church." };
}
