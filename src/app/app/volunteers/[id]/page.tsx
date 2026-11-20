import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import type { Volunteer } from "@/lib/volunteers";
import { saveVolunteerAction, setVolunteerStatusAction } from "../actions";
import { VolunteerForm, VolunteerStatusButton } from "../volunteer-form";

export const metadata: Metadata = { title: "Volunteer" };

export default async function VolunteerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const created = (await searchParams).created === "1";
  if (!uuidSchema.safeParse(id).success) notFound();
  const { membership } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_volunteers", { p_church_id: membership.church.id, p_include_inactive: true });
  if (error) return <Alert tone="error">This volunteer could not be loaded. Refresh the page to try again.</Alert>;
  // Only this church's volunteers are listed, so another church's id is simply not found.
  const v = ((data ?? []) as Volunteer[]).find((x) => x.id === id);
  if (!v) notFound();
  const suspended = membership.church.status === "suspended";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/app/volunteers" className="text-sm font-semibold text-forest underline">← Volunteers</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-charcoal">{v.full_name}</h1>
          {v.status === "inactive" ? <Badge tone="neutral">Not available</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted">
          {v.open_tasks} open {v.open_tasks === 1 ? "task" : "tasks"} · {v.completed_tasks} completed
        </p>
      </div>
      {created ? <Alert tone="success">Volunteer added. They can now be given tasks on approved requests.</Alert> : null}
      {suspended ? (
        <Alert tone="error">This workspace is suspended, so volunteers cannot be changed.</Alert>
      ) : (
        <>
          <Card>
            <VolunteerForm action={saveVolunteerAction.bind(null, v.id)} volunteer={v} />
          </Card>
          <Card>
            <h2 className="text-lg font-bold text-charcoal">Availability</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              {v.status === "inactive"
                ? "Not offered for new tasks. Their history is kept."
                : "Mark them as not available if they can no longer help. Their history is kept."}
            </p>
            <VolunteerStatusButton
              action={setVolunteerStatusAction.bind(null, v.id, v.status === "inactive" ? "active" : "inactive")}
              inactive={v.status === "inactive"}
            />
          </Card>
        </>
      )}
    </div>
  );
}
