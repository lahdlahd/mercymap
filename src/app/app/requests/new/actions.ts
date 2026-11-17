"use server";

import { getCurrentUser, getMembership } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { intakeDbError, readRequestForm, redisplayValues, requestSchema } from "@/lib/intake";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/lib/validation";

// Runs as the signed-in staff member; the database function checks that they
// belong to the church. The church comes from their membership, not the form.
export async function staffSubmitRequestAction(_state: FormState, formData: FormData): Promise<FormState> {
  const raw = readRequestForm(formData);
  const values = redisplayValues(raw);

  const user = await getCurrentUser();
  const membership = user ? await getMembership() : null;
  if (!user || !membership) return { message: "Your session has ended. Sign in again.", values };

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const d = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_submit_request", {
    p_church_id: membership.church.id,
    p_category: d.category,
    p_text: d.description,
    p_quantity: d.quantity,
    p_name: d.name || null,
    p_contact_method: d.contactMethod,
    p_contact_value: d.contactValue || null,
    p_area: d.area || null,
  });
  if (error) {
    console.error("staff_submit_request failed:", error.code ?? "unknown");
    const mapped = intakeDbError(error.message);
    return mapped.field
      ? { fieldErrors: { [mapped.field]: mapped.message }, values }
      : { message: mapped.message, values };
  }
  const row = (data as Array<{ id: string; reference: string }> | null)?.[0];
  if (!row) return { message: "The request could not be saved. Please try again.", values };
  return { ok: true, data: { reference: row.reference, id: row.id } };
}
