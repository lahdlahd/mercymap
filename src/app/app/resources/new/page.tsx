import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveResourceAction } from "../actions";
import { ResourceForm } from "../resource-form";

export const metadata: Metadata = { title: "Add a resource" };

export default async function NewResourcePage() {
  const { membership } = await requireMembership();
  const supabase = await createClient();
  const [categories, members] = await Promise.all([
    supabase.from("categories").select("key, label").eq("is_active", true).order("sort_order", { ascending: true }),
    supabase.rpc("list_church_members", { p_church_id: membership.church.id }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/app/resources" className="text-sm font-semibold text-forest underline">← Resources</Link>
        <h1 className="mt-2 text-2xl font-bold text-charcoal">Add a resource</h1>
      </div>
      {membership.church.status === "suspended" ? (
        <Alert tone="error">This workspace is suspended, so resources cannot be added.</Alert>
      ) : categories.error || members.error ? (
        <Alert tone="error">The form could not be loaded. Refresh the page to try again.</Alert>
      ) : (
        <Card>
          <ResourceForm
            action={saveResourceAction.bind(null, null)}
            categories={(categories.data ?? []) as Array<{ key: string; label: string }>}
            members={((members.data ?? []) as Array<{ user_id: string; email: string; status: string }>).filter((m) => m.status === "active")}
          />
        </Card>
      )}
    </div>
  );
}
