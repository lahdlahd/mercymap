"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getMembership } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { parseAreas, resourceDbError, resourceSchema, type Resource } from "@/lib/resources";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

const FIELDS = ["name", "category", "description", "unit", "total", "sourceType", "sourceName", "areas", "validFrom", "validUntil", "manager"] as const;

// The church comes from the signed-in member, never from the form. The
// database checks membership, the church status and every rule again.
export async function saveResourceAction(resourceId: string | null, _state: FormState, formData: FormData): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (resourceId && !uuidSchema.safeParse(resourceId).success) return { message: "That resource could not be found." };

  const values = Object.fromEntries(FIELDS.map((k) => [k, String(formData.get(k) ?? "").trim()])) as Record<(typeof FIELDS)[number], string>;
  const parsed = resourceSchema.safeParse(values);
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
  const { data, error } = await supabase.rpc("save_resource", {
    p_resource_id: resourceId,
    p_church_id: membership.church.id,
    p_name: v.name,
    p_category: v.category,
    p_description: v.description || null,
    p_unit: v.unit,
    p_total_quantity: v.total,
    p_source_type: v.sourceType,
    p_source_name: v.sourceType === "partner" ? v.sourceName || null : null,
    p_coverage_areas: parseAreas(v.areas ?? ""),
    p_valid_from: v.validFrom || null,
    p_valid_until: v.validUntil || null,
    p_manager: v.manager || null,
    p_status: "active",
  });
  if (error) {
    console.error("save resource failed:", error.code ?? "unknown");
    const e = resourceDbError(error.message);
    return e.field ? { fieldErrors: { [e.field]: e.message }, values } : { message: e.message, values };
  }
  revalidatePath("/app/resources", "layout");
  if (!resourceId) redirect(`/app/resources/${data as string}?created=1`);
  return { ok: true, message: "Changes saved." };
}

// Archiving keeps the history. Reserved stock stays reserved, but an
// archived resource cannot be chosen for new requests.
export async function setResourceStatusAction(resourceId: string, status: "active" | "archived"): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (!uuidSchema.safeParse(resourceId).success) return { message: "That resource could not be found." };
  const supabase = await createClient();
  const current = await supabase.rpc("get_resource", { p_resource_id: resourceId });
  if (current.error) return { message: resourceDbError(current.error.message).message };
  const r = current.data as Resource;
  const { error } = await supabase.rpc("save_resource", {
    p_resource_id: r.id,
    p_church_id: membership.church.id,
    p_name: r.name,
    p_category: r.category_key,
    p_description: r.description,
    p_unit: r.unit,
    p_total_quantity: r.total_quantity,
    p_source_type: r.source_type,
    p_source_name: r.source_name,
    p_coverage_areas: r.coverage_areas,
    p_valid_from: r.valid_from,
    p_valid_until: r.valid_until,
    p_manager: r.manager_user_id,
    p_status: status,
  });
  if (error) {
    console.error("resource status failed:", error.code ?? "unknown");
    return { message: resourceDbError(error.message).message };
  }
  revalidatePath("/app/resources", "layout");
  return { ok: true, message: status === "archived" ? "Archived. It will not be offered for new requests." : "Restored. It can be offered again." };
}
