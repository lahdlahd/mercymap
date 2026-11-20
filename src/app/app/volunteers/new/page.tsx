import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { saveVolunteerAction } from "../actions";
import { VolunteerForm } from "../volunteer-form";

export const metadata: Metadata = { title: "Add a volunteer" };

export default async function NewVolunteerPage() {
  const { membership } = await requireMembership();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/app/volunteers" className="text-sm font-semibold text-forest underline">← Volunteers</Link>
        <h1 className="mt-2 text-2xl font-bold text-charcoal">Add a volunteer</h1>
      </div>
      {membership.church.status === "suspended" ? (
        <Alert tone="error">This workspace is suspended, so volunteers cannot be added.</Alert>
      ) : (
        <Card>
          <VolunteerForm action={saveVolunteerAction.bind(null, null)} />
        </Card>
      )}
    </div>
  );
}
