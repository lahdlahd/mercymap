import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/validation";

export type CurrentUser = { id: string; email: string };

export type Membership = {
  membershipId: string;
  role: StaffRole;
  church: { id: string; name: string; slug: string; status: "pending" | "verified" | "suspended"; area: string | null };
};

// The signed-in user, from a verified token. Never trust getSession() here.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
});

export async function requireUser(nextPath = "/app"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  return user;
}

// The user's active church membership, read through Row Level Security.
// The first version supports one church per person in the interface.
export const getMembership = cache(async (): Promise<Membership | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("church_memberships")
    .select("id, role, churches ( id, name, slug, status, area )")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const church = (Array.isArray(data.churches) ? data.churches[0] : data.churches) as
    | Membership["church"]
    | null;
  if (!church) return null;
  return { membershipId: data.id as string, role: data.role as StaffRole, church };
});

export async function requireMembership(): Promise<{ user: CurrentUser; membership: Membership }> {
  const user = await requireUser();
  const membership = await getMembership();
  if (!membership) redirect("/onboarding");
  return { user, membership };
}

export function canManageStaff(role: StaffRole): boolean {
  return role === "owner" || role === "admin";
}
