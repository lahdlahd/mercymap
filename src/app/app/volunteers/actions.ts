"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMembership } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import { parseSkills, volunteerDbError, volunteerSchema, type Volunteer } from "@/lib/volunteers";

// The church comes from the signed-in member, never from the form.
export async function saveVolunteerAction(volunteerId: string | null, _state: FormState, formData: FormData): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (volunteerId && !uuidSchema.safeParse(volunteerId).success) return { message: "That volunteer could not be found." };
  const values = {
    fullName: String(formData.get("fullName") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    skills: String(formData.get("skills") ?? ""),
    availability: String(formData.get("availability") ?? ""),
  };
  const parsed = volunteerSchema.safeParse({ ...values, consent: formData.get("consent") === "on" });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { fieldErrors, values };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_volunteer", {
    p_volunteer_id: volunteerId,
    p_church_id: membership.church.id,
    p_full_name: v.fullName,
    p_phone: v.phone || null,
    p_skills: parseSkills(v.skills),
    p_availability: v.availability || null,
    p_consent: v.consent,
    p_status: "active",
  });
  if (error) {
    console.error("save volunteer failed:", error.code ?? "unknown");
    const e = volunteerDbError(error.message);
    return e.field ? { fieldErrors: { [e.field]: e.message }, values } : { message: e.message, values };
  }
  revalidatePath("/app/volunteers", "layout");
  if (!volunteerId) redirect(`/app/volunteers/${data as string}?created=1`);
  return { ok: true, message: "Changes saved." };
}

export async function setVolunteerStatusAction(volunteerId: string, status: "active" | "inactive"): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (!uuidSchema.safeParse(volunteerId).success) return { message: "That volunteer could not be found." };
  const supabase = await createClient();
  const list = await supabase.rpc("list_volunteers", { p_church_id: membership.church.id, p_include_inactive: true });
  const v = ((list.data ?? []) as Volunteer[]).find((x) => x.id === volunteerId);
  if (list.error || !v) return { message: "That volunteer could not be found." };
  const { error } = await supabase.rpc("save_volunteer", {
    p_volunteer_id: v.id,
    p_church_id: membership.church.id,
    p_full_name: v.full_name,
    p_phone: v.phone,
    p_skills: v.skills,
    p_availability: v.availability_notes,
    p_consent: Boolean(v.consent_given_at),
    p_status: status,
  });
  if (error) {
    console.error("volunteer status failed:", error.code ?? "unknown");
    return { message: volunteerDbError(error.message).message };
  }
  revalidatePath("/app/volunteers", "layout");
  return { ok: true, message: status === "inactive" ? "Marked as not available. They will not be offered for new tasks." : "Available again for new tasks." };
}
