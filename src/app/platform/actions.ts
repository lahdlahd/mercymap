"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { churchStatusSchema, uuidSchema } from "@/lib/validation";

// The database function checks that the caller is a platform administrator.
export async function setChurchStatusAction(_state: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return { message: "Your session has ended. Sign in again." };
  const id = uuidSchema.safeParse(formData.get("churchId"));
  const status = churchStatusSchema.safeParse(formData.get("status"));
  if (!id.success || !status.success) return { message: "That request was not valid." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_church_status", { p_church_id: id.data, p_status: status.data });
  if (error) return { message: friendlyDbError(error.message) };

  revalidatePath("/platform");
  return { ok: true, message: `Status set to ${status.data}.` };
}
