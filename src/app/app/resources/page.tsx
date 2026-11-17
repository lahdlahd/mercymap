import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, buttonClass, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { resourceState, type Resource } from "@/lib/resources";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Resources" };

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { membership } = await requireMembership();
  const showArchived = (await searchParams).show === "archived";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_resources", {
    p_church_id: membership.church.id,
    p_include_archived: showArchived,
  });
  const resources = (data ?? []) as Resource[];
  const suspended = membership.church.status === "suspended";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Resources</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            What the church can give. A request is approved by reserving one of these, so the numbers here are what
            decides whether help can be promised.
          </p>
        </div>
        {suspended ? null : (
          <Link href="/app/resources/new" className={buttonClass("primary")}>
            Add a resource
          </Link>
        )}
      </div>

      {error ? (
        <Alert tone="error">Resources could not be loaded. Refresh the page to try again.</Alert>
      ) : resources.length === 0 ? (
        <Card>
          <p className="text-charcoal">
            {showArchived ? "There are no resources yet." : "There are no active resources yet."}
          </p>
          <p className="mt-1 text-sm text-muted">
            Add the food packages, vouchers, transport credits and other help the church has, so requests can be approved
            against them.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line bg-lightgrey text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Resource</th>
                <th scope="col" className="px-4 py-3 font-semibold">Kind</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Available</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Reserved</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Given out</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Total</th>
                <th scope="col" className="px-4 py-3 font-semibold">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {resources.map((r) => {
                const state = resourceState(r);
                return (
                  <tr key={r.id} data-resource={r.name}>
                    <td className="px-4 py-3">
                      <Link href={`/app/resources/${r.id}`} className="font-semibold text-forest underline-offset-2 hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {r.source_type === "partner" ? `From ${r.source_name}` : "Church stock"}
                        {r.valid_until ? ` · until ${formatDate(r.valid_until)}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-charcoal">{r.category_label}</td>
                    <td className="px-4 py-3 text-right font-semibold text-charcoal" data-col="available">{r.available}</td>
                    <td className="px-4 py-3 text-right text-charcoal" data-col="reserved">{r.reserved}</td>
                    <td className="px-4 py-3 text-right text-charcoal" data-col="distributed">{r.distributed}</td>
                    <td className="px-4 py-3 text-right text-muted">{r.total_quantity} {r.unit}</td>
                    <td className="px-4 py-3"><Badge tone={state.tone}>{state.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-sm">
        {showArchived ? (
          <Link href="/app/resources" className="font-semibold text-forest underline">Hide archived resources</Link>
        ) : (
          <Link href="/app/resources?show=archived" className="font-semibold text-forest underline">Show archived resources</Link>
        )}
      </p>
    </div>
  );
}
