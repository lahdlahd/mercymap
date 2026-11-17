"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageStaff, getCurrentUser, getMembership } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { isValidPhone } from "@/lib/intake";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fieldErrors } from "@/lib/validation";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your church's name.").max(120, "Use 120 characters or fewer."),
  area: z.string().trim().max(120, "Use 120 characters or fewer."),
  contactPhone: z
    .string()
    .trim()
    .max(40)
    .refine((v) => v === "" || isValidPhone(v), "Enter a valid phone number, for example 0803 123 4567."),
  contactEmail: z.union([z.literal(""), emailSchema]),
  emergencyGuidance: z.string().trim().max(1000, "Use 1000 characters or fewer."),
});

export async function updateChurchProfileAction(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    area: String(formData.get("area") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    emergencyGuidance: String(formData.get("emergencyGuidance") ?? ""),
  };
  const user = await getCurrentUser();
  const membership = user ? await getMembership() : null;
  if (!membership) return { message: "Your session has ended. Sign in again.", values: raw };
  if (!canManageStaff(membership.role)) return { message: "Only owners and administrators can change these details.", values: raw };

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: raw };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("churches")
    .update({
      name: d.name,
      area: d.area || null,
      contact_phone: d.contactPhone || null,
      contact_email: d.contactEmail || null,
      emergency_guidance: d.emergencyGuidance || null,
    })
    .eq("id", membership.church.id)
    .select("id");
  if (error || !data?.length) {
    console.error("church profile update failed:", error?.code ?? "no rows");
    return { message: friendlyDbError(error?.message ?? "forbidden"), values: raw };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Church details saved.", values: raw };
}
