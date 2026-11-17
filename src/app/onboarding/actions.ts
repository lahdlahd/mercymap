"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { churchSchema, fieldErrors } from "@/lib/validation";

export async function createChurchAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/onboarding");

  const raw = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    area: String(formData.get("area") ?? ""),
  };
  const parsed = churchSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: raw };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_church", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_area: parsed.data.area || null,
  });
  if (error) {
    console.error("create_church failed:", error.code);
    const message = friendlyDbError(error.message);
    if (/link name/.test(message)) return { fieldErrors: { slug: message }, values: raw };
    return { message, values: raw };
  }
  redirect("/app");
}
