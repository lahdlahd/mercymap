import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { resourceState, type Resource, type ResourceAllocation } from "@/lib/resources";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import { saveResourceAction, setResourceStatusAction } from "../actions";
import { ResourceForm, StatusButton } from "../resource-form";

export const metadata: Metadata = { title: "Resource" };

const ALLOCATION_LABEL = { reserved: "Reserved", fulfilled: "Given out", released: "Returned" } as const;
const ALLOCATION_TONE = { reserved: "info", fulfilled: "success", released: "neutral" } as const;

export default async function ResourcePage({
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
  const [result, categories, members] = await Promise.all([
    supabase.rpc("get_resource", { p_resource_id: id }),
    supabase.from("categories").select("key, label").eq("is_active", true).order("sort_order", { ascending: true }),
    supabase.rpc("list_church_members", { p_church_id: membership.church.id }),
  ]);
  // Another church's resource and a missing one look the same.
  if (result.error) {
    if (/forbidden/.test(result.error.message)) notFound();
    return <Alert tone="error">This resource could not be loaded. Refresh the page to try again.</Alert>;
  }
  const r = result.data as Resource & { allocations: ResourceAllocation[] };
  if (r.church_id !== membership.church.id) notFound();
  const state = resourceState(r);
  const suspended = membership.church.status === "suspended";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/resources" className="text-sm font-semibold text-forest underline">← Resources</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-charcoal">{r.name}</h1>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">
          {r.category_label} · {r.source_type === "partner" ? `from ${r.source_name}` : "church stock"}
          {r.valid_from ? ` · from ${formatDate(r.valid_from)}` : ""}
          {r.valid_until ? ` · until ${formatDate(r.valid_until)}` : ""}
        </p>
      </div>

      {created ? <Alert tone="success">Resource added. It can now be reserved for matching requests.</Alert> : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Available", r.available],
          ["Reserved", r.reserved],
          ["Given out", r.distributed],
          ["Total", r.total_quantity],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-4" data-stat={String(label).toLowerCase()}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-bold text-charcoal">{value}</dd>
            <dd className="text-xs text-muted">{r.unit}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <h2 className="mb-4 text-lg font-bold text-charcoal">Details</h2>
          {suspended ? (
            <Alert tone="error">This workspace is suspended, so resources cannot be changed.</Alert>
          ) : r.status === "archived" ? (
            <p className="text-sm text-muted">Restore this resource to change it.</p>
          ) : categories.error || members.error ? (
            <Alert tone="error">The form could not be loaded. Refresh the page to try again.</Alert>
          ) : (
            <ResourceForm
              action={saveResourceAction.bind(null, r.id)}
              categories={(categories.data ?? []) as Array<{ key: string; label: string }>}
              members={((members.data ?? []) as Array<{ user_id: string; email: string; status: string }>).filter((m) => m.status === "active")}
              resource={r}
            />
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-bold text-charcoal">Coverage</h2>
            <p className="mt-2 text-sm text-charcoal">
              {r.coverage_areas.length ? r.coverage_areas.join(", ") : "Any area"}
            </p>
            <p className="mt-3 text-sm text-muted">
              Person responsible: {r.manager_email ?? "no one in particular"}
            </p>
          </Card>
          {suspended ? null : (
            <Card>
              <h2 className="text-lg font-bold text-charcoal">{r.status === "archived" ? "Archived" : "Archive"}</h2>
              <p className="mt-2 mb-4 text-sm text-muted">
                {r.status === "archived"
                  ? "It is not offered for new requests. Its history is kept."
                  : "Stop offering it for new requests. Its history is kept and reserved stock stays reserved."}
              </p>
              <StatusButton
                action={setResourceStatusAction.bind(null, r.id, r.status === "archived" ? "active" : "archived")}
                archived={r.status === "archived"}
              />
            </Card>
          )}
          <Card>
            <h2 className="text-lg font-bold text-charcoal">Requests using it</h2>
            {r.allocations.length === 0 ? (
              <p className="mt-2 text-sm text-muted">None yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line text-sm">
                {r.allocations.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <Link href={`/app/requests/${a.request_id}`} className="font-mono font-semibold text-forest underline">
                        {a.reference}
                      </Link>
                      <div className="text-xs text-muted">
                        {a.quantity} {r.unit} · {formatDateTime(a.fulfilled_at ?? a.released_at ?? a.approved_at)}
                      </div>
                    </div>
                    <Badge tone={ALLOCATION_TONE[a.status]}>{ALLOCATION_LABEL[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
