import type { Metadata } from "next";
import { RequestForm } from "@/components/intake/request-form";
import { Alert, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffSubmitRequestAction } from "./actions";

export const metadata: Metadata = { title: "Record a request" };

export default async function NewRequestPage() {
  const { membership } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("key, label")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Record a request</h1>
        <p className="mt-1 text-sm text-muted">
          For someone who has come to the church or called, and cannot or would rather not use the online form. It
          goes into the same list as online requests, marked as recorded by you.
        </p>
      </div>
      {membership.church.status === "suspended" ? (
        <Alert tone="error">This workspace is suspended, so requests cannot be recorded.</Alert>
      ) : error ? (
        <Alert tone="error">The form could not be loaded. Refresh the page to try again.</Alert>
      ) : (
        <Card>
          <RequestForm
            mode="staff"
            action={staffSubmitRequestAction}
            categories={(data ?? []) as Array<{ key: string; label: string }>}
            churchName={membership.church.name}
          />
        </Card>
      )}
    </div>
  );
}
