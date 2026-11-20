import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, buttonClass, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Volunteer } from "@/lib/volunteers";

export const metadata: Metadata = { title: "Volunteers" };

export default async function VolunteersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { membership } = await requireMembership();
  const showAll = (await searchParams).show === "all";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_volunteers", {
    p_church_id: membership.church.id,
    p_include_inactive: showAll,
  });
  const volunteers = (data ?? []) as Volunteer[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Volunteers</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            People who help deliver support. They do not need an account: you send them a short task brief.
          </p>
        </div>
        {membership.church.status === "suspended" ? null : (
          <Link href="/app/volunteers/new" className={buttonClass("primary")}>Add a volunteer</Link>
        )}
      </div>

      {error ? (
        <Alert tone="error">Volunteers could not be loaded. Refresh the page to try again.</Alert>
      ) : volunteers.length === 0 ? (
        <Card>
          <p className="text-charcoal">There are no volunteers yet.</p>
          <p className="mt-1 text-sm text-muted">Add the people who drive, deliver or visit, so approved requests can be given to them.</p>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {volunteers.map((v) => (
            <li key={v.id} data-volunteer={v.full_name}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/app/volunteers/${v.id}`} className="font-semibold text-forest underline-offset-2 hover:underline">
                    {v.full_name}
                  </Link>
                  {v.status === "inactive" ? <Badge tone="neutral">Not available</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted">{v.phone ?? "No phone kept"}</p>
                {v.skills.length ? <p className="mt-2 text-sm text-charcoal">{v.skills.join(", ")}</p> : null}
                <p className="mt-2 text-xs text-muted">
                  {v.open_tasks} open {v.open_tasks === 1 ? "task" : "tasks"} · {v.completed_tasks} completed
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href={showAll ? "/app/volunteers" : "/app/volunteers?show=all"} className="font-semibold text-forest underline">
          {showAll ? "Hide volunteers who are not available" : "Show volunteers who are not available"}
        </Link>
      </p>
    </div>
  );
}
