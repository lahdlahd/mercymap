import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  CHANNEL_LABEL,
  CONTACT_LABEL,
  EVENT_LABEL,
  isClosed,
  nextStatuses,
  STATUS_LABEL,
  STATUS_TONE,
  type RequestStatus,
  requestDbError,
} from "@/lib/requests";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";
import { acknowledgeAttentionAction, addNoteAction, approveAction, changeStatusAction, flagAttentionAction, fulfilAction } from "./actions";
import { AcknowledgeForm, ApproveForm, ClearChangedNotice, FlagForm, FulfilForm, NoteForm, StatusForm, type Candidate } from "./forms";

export const metadata: Metadata = { title: "Request", robots: { index: false, follow: false } };

type Detail = {
  request: {
    id: string;
    reference: string;
    status: RequestStatus;
    channel: "public" | "staff";
    original_text: string;
    quantity_needed: number;
    requester_name: string | null;
    contact_method: string;
    contact_value: string | null;
    area: string | null;
    consent_given_at: string;
    outcome_reason: string | null;
    attention_flag: boolean;
    attention_source: "ai" | "keyword" | "staff" | null;
    attention_reason: string | null;
    attention_acknowledged_at: string | null;
    attention_note: string | null;
    created_at: string;
  };
  category_label: string;
  created_by_email: string | null;
  allocation: {
    id: string;
    status: "reserved" | "fulfilled" | "released";
    quantity: number;
    resource_id: string;
    resource_name: string;
    unit: string;
    source_type: "church" | "partner";
    source_name: string | null;
    approved_at: string;
    approved_by_email: string | null;
    fulfilled_at: string | null;
    fulfilled_by_email: string | null;
    released_at: string | null;
    release_reason: string | null;
  } | null;
  attention_acknowledged_by_email: string | null;
  events: Array<{
    id: string;
    event_type: string;
    from_status: RequestStatus | null;
    to_status: RequestStatus | null;
    note: string | null;
    created_at: string;
    actor_email: string | null;
  }>;
};

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ changed?: string }>;
}) {
  const changed = (await searchParams).changed === "1";
  const { membership } = await requireMembership();
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  // Reading through this function records the view in the audit log.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_request_detail", { p_request_id: id });
  if (error || !data) notFound();
  const d = data as Detail;
  const r = d.request;
  const options = nextStatuses(r.status);
  const attentionOpen = r.attention_flag && !r.attention_acknowledged_at;
  const suspended = membership.church.status === "suspended";
  const allocation = d.allocation;

  let candidates: Candidate[] | null = null;
  if (r.status === "awaiting_match" && !suspended) {
    const m = await supabase.rpc("list_matching_resources", { p_request_id: r.id });
    candidates = m.error ? null : ((m.data as { resources: Candidate[] }).resources ?? []);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link href="/app/requests" className="inline-flex min-h-11 items-center text-sm font-semibold text-forest underline">
        ← All requests
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-charcoal">{r.reference}</h1>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {attentionOpen ? <Badge tone="danger">⚠ Needs attention</Badge> : null}
      </div>
      <p className="-mt-3 text-sm text-muted">
        {d.category_label} · received {formatDateTime(r.created_at)} ·{" "}
        {r.channel === "staff" ? `recorded by ${d.created_by_email ?? "a former staff member"}` : CHANNEL_LABEL.public}
      </p>

      {changed ? (
        <div>
          <ClearChangedNotice />
          <Alert tone="error">{requestDbError("status_changed")}</Alert>
        </div>
      ) : null}

      {attentionOpen ? (
        <section aria-labelledby="attention-heading" className="rounded-xl border border-danger/40 bg-danger-soft p-5 text-danger-ink">
          <h2 id="attention-heading" className="font-bold">Safeguarding concern: needs a person to review it</h2>
          <p className="mt-1 whitespace-pre-wrap">{r.attention_reason}</p>
          <p className="mt-2 text-sm">
            Follow your church&apos;s safeguarding procedure. This flag is a prompt for people to act; it is not an assessment.
          </p>
          {!suspended ? <AcknowledgeForm action={acknowledgeAttentionAction.bind(null, r.id)} /> : null}
        </section>
      ) : r.attention_flag && r.attention_acknowledged_at ? (
        <Alert tone="info" title="Safeguarding concern reviewed">
          <p className="whitespace-pre-wrap">Concern: {r.attention_reason}</p>
          <p className="mt-1 whitespace-pre-wrap">
            Reviewed by {d.attention_acknowledged_by_email ?? "a former staff member"} on {formatDateTime(r.attention_acknowledged_at)}: {r.attention_note}
          </p>
        </Alert>
      ) : null}

      {isClosed(r.status) && r.outcome_reason ? (
        <Alert tone={r.status === "declined" ? "warning" : "info"} title={`${STATUS_LABEL[r.status]}`}>
          <p className="whitespace-pre-wrap">{r.outcome_reason}</p>
        </Alert>
      ) : null}

      {allocation && allocation.status !== "released" ? (
        <section aria-labelledby="allocation-heading"
          className={`rounded-xl border p-5 ${allocation.status === "fulfilled" ? "border-success/30 bg-sage" : "border-progress/30 bg-[#e8f0f8]"}`}>
          <h2 id="allocation-heading" className="font-bold text-charcoal">
            {allocation.status === "fulfilled" ? "Help given" : "Stock reserved"}
          </h2>
          <p className="mt-1 text-charcoal">
            {allocation.quantity} {allocation.unit} from{" "}
            <Link href={`/app/resources/${allocation.resource_id}`} className="font-semibold underline">{allocation.resource_name}</Link>
            {allocation.source_type === "partner" && allocation.source_name ? ` (${allocation.source_name})` : ""}
          </p>
          <p className="mt-1 text-sm text-muted">
            Approved by {allocation.approved_by_email ?? "a former staff member"} on {formatDateTime(allocation.approved_at)}
            {allocation.fulfilled_at ? ` · delivered ${formatDateTime(allocation.fulfilled_at)}${allocation.fulfilled_by_email ? ` (recorded by ${allocation.fulfilled_by_email})` : ""}` : ""}
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-bold text-charcoal">What they told us</h2>
            <p className="mt-3 whitespace-pre-wrap break-words text-base text-charcoal">{r.original_text}</p>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-charcoal">Details</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label="Kind of help">{d.category_label}</Item>
              <Item label="Quantity needed">{r.quantity_needed}</Item>
              <Item label="Name">{r.requester_name ?? <span className="text-muted">Not given</span>}</Item>
              <Item label="Area">{r.area ?? <span className="text-muted">Not given</span>}</Item>
              <Item label="How to reach them">{CONTACT_LABEL[r.contact_method] ?? r.contact_method}</Item>
              <Item label="Phone">
                {r.contact_value ? (
                  <a href={`tel:${r.contact_value.replace(/[^+0-9]/g, "")}`} className="font-semibold text-forest underline">{r.contact_value}</a>
                ) : <span className="text-muted">None</span>}
              </Item>
              <Item label="Consent given">{formatDateTime(r.consent_given_at)}</Item>
              <Item label="Received through">{CHANNEL_LABEL[r.channel]}</Item>
            </dl>
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-charcoal">History</h2>
            <ol className="mt-4 space-y-4 border-l-2 border-line pl-5">
              {d.events.map((e) => (
                <li key={e.id} className="relative">
                  <span aria-hidden="true" className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald" />
                  <p className="text-sm font-semibold text-charcoal">
                    {e.event_type === "status_changed" && e.from_status && e.to_status
                      ? `${STATUS_LABEL[e.from_status]} → ${STATUS_LABEL[e.to_status]}`
                      : EVENT_LABEL[e.event_type] ?? e.event_type}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.created_at)}
                    {e.actor_email ? ` · ${e.actor_email}` : e.event_type === "submitted" && r.channel === "public" ? " · online form" : ""}
                  </p>
                  {e.note ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-charcoal">{e.note}</p> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-bold text-charcoal">Next step</h2>
            <div className="mt-3">
              {suspended ? (
                <p className="text-sm text-muted">This workspace is suspended, so requests cannot be changed.</p>
              ) : isClosed(r.status) ? (
                <p className="text-sm text-muted">This request is closed.</p>
              ) : options.length === 0 ? (
                <p className="text-sm text-muted">No manual changes are available from this status.</p>
              ) : (
                <div className="space-y-6">
                  {r.status === "awaiting_match" ? (
                    candidates ? (
                      <div>
                        <h3 className="mb-2 font-semibold text-charcoal">Approve and reserve stock</h3>
                        <ApproveForm action={approveAction.bind(null, r.id, r.status)} candidates={candidates} quantity={r.quantity_needed} />
                      </div>
                    ) : (
                      <Alert tone="error">Matching resources could not be loaded. Refresh the page to try again.</Alert>
                    )
                  ) : null}
                  {(r.status === "approved" || r.status === "in_progress") && allocation?.status === "reserved" ? (
                    <div>
                      <h3 className="mb-2 font-semibold text-charcoal">Help given?</h3>
                      <FulfilForm action={fulfilAction.bind(null, r.id, r.status)} />
                    </div>
                  ) : null}
                  <div className={r.status === "awaiting_match" || r.status === "approved" || r.status === "in_progress" ? "border-t border-line pt-5" : undefined}>
                    {r.status === "awaiting_match" || r.status === "approved" || r.status === "in_progress" ? (
                      <h3 className="mb-2 font-semibold text-charcoal">Or</h3>
                    ) : null}
                    <StatusForm action={changeStatusAction.bind(null, r.id, r.status)} status={r.status} options={options} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {!suspended ? (
            <Card>
              <NoteForm action={addNoteAction.bind(null, r.id)} />
              {!attentionOpen ? (
                <div className="mt-5 border-t border-line pt-4">
                  <FlagForm action={flagAttentionAction.bind(null, r.id)} />
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-charcoal">{children}</dd>
    </div>
  );
}
