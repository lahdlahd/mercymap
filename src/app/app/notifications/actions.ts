"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getMembership } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export async function markAllReadAction(): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_church_id: membership.church.id, p_ids: null });
  if (error) return { message: "Notifications could not be updated. Please try again." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "All notifications marked as read." };
}

// Opening a notification marks it read, then goes to the request (or stays here).
export async function openNotificationAction(notificationId: string, requestId: string | null): Promise<FormState> {
  const membership = await getMembership();
  if (!membership) return { message: "Your session has ended. Sign in again." };
  if (!uuidSchema.safeParse(notificationId).success) return { message: "That notification could not be found." };
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read", { p_church_id: membership.church.id, p_ids: [notificationId] });
  revalidatePath("/app", "layout");
  if (requestId && uuidSchema.safeParse(requestId).success) redirect(`/app/requests/${requestId}`);
  return { ok: true };
}
