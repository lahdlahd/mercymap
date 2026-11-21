import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, buttonClass, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  CHANNEL_LABEL,
  isListTab,
  LIST_TABS,
  STATUS_LABEL,
  STATUS_TONE,
  type ListTab,
  type RequestStatus,
} from "@/lib/requests";
import { aiConfig } from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";
import { analyseWaitingAction } from "./actions";

export const metadata: Metadata = { title: "Requests" };
// "Analyse waiting requests" runs up to 30 AI analyses in one action.
export const maxDuration = 300;

const PAGE_SIZE = 25;

type Row = {
  id: string;
  reference: string;
  status: RequestStatus;
  category_key: string;
  category_label: string;
  channel: "public" | "staff";
  quantity_needed: number;
  attention_open: boolean;
  created_at: string;
};
type Counts = { total: number; open: number; closed: number; attention_open: number; by_status: Record<string, number> };
type Params = { status?: string; category?: string; channel?: string; q?: string; page?: string; analysed?: string; failed?: string; limited?: string };

// Result of "Analyse waiting requests", carried in the address after the run.
function aiRunResult(params: Params): { done: number; failed: number; limited: number } | null {
  const read = (v?: string) => (v && /^\d{1,2}$/.test(v) ? Number(v) : null);
  const done = read(params.analysed);
  const failed = read(params.failed);
  const limited = read(params.limited) ?? 0;
  return done === null || failed === null ? null : { done, failed, limited };
}

function tabCount(tab: ListTab, counts: Counts | null): number | null {
  if (!counts) return null;
  if (tab === "open" || tab === "closed") return counts[tab];
  if (tab === "all") return counts.total;
  if (tab === "attention") return counts.attention_open;
  return counts.by_status[tab] ?? 0;
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { membership } = await requireMembership();
  const params = await searchParams;
  const tab: ListTab = isListTab(params.status) ? params.status : "open";
  const category = params.category && /^[a-z_]{2,40}$/.test(params.category) ? params.category : "";
  const channel = params.channel === "public" || params.channel === "staff" ? params.channel : "";
  const q = (params.q ?? "").trim().slice(0, 20);
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  const supabase = await createClient();
  const churchId = membership.church.id;
  const showAiBacklog = canManageStaff(membership.role) && aiConfig() !== null;
  const [listResult, countsResult, categoriesResult, waitingResult] = await Promise.all([
    supabase.rpc("list_requests", {
      p_church_id: churchId,
      p_status: tab === "attention" ? "all" : tab,
      p_category: category || null,
      p_channel: channel || null,
      p_search: q || null,
      p_attention: tab === "attention",
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.rpc("request_status_counts", { p_church_id: churchId }),
    supabase.from("categories").select("key, label").eq("is_active", true).order("sort_order"),
    showAiBacklog ? supabase.rpc("ai_waiting_count", { p_church_id: churchId }) : Promise.resolve({ data: 0 }),
  ]);
  const aiWaiting = typeof waitingResult.data === "number" ? waitingResult.data : 0;
  const aiResult = aiRunResult(params);
  const list = listResult.data as { total: number; rows: Row[] } | null;
  const counts = countsResult.data as Counts | null;
  const categories = (categoriesResult.data ?? []) as Array<{ key: string; label: string }>;

  const link = (overrides: Partial<Params>) => {
    const next = new URLSearchParams();
    const merged = { status: tab, category, channel, q, page: "1", ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v && !(k === "status" && v === "open") && !(k === "page" && v === "1")) next.set(k, String(v));
    }
    const qs = next.toString();
    return `/app/requests${qs ? `?${qs}` : ""}`;
  };
  const filtered = Boolean(category || channel || q);
  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Requests</h1>
          <p className="mt-1 text-sm text-muted">Every request for {membership.church.name}, online and recorded by staff.</p>
        </div>
        <Link href="/app/requests/new" className={buttonClass("primary")}>
          Record a request
        </Link>
      </div>

      {counts && counts.attention_open > 0 && tab !== "attention" ? (
        <Alert tone="error" title={`${counts.attention_open} safeguarding ${counts.attention_open === 1 ? "concern needs" : "concerns need"} review`}>
          <Link href={link({ status: "attention", category: "", channel: "", q: "" })} className="font-semibold underline">
            Show them
          </Link>
        </Alert>
      ) : null}

      {aiResult ? (
        <Alert tone={aiResult.failed > 0 || aiResult.limited > 0 ? "error" : "success"} title={`AI suggestions added to ${aiResult.done} ${aiResult.done === 1 ? "request" : "requests"}.`}>
          {aiResult.limited > 0
            ? `Today's AI limit has been reached, so ${aiResult.limited} ${aiResult.limited === 1 ? "request is" : "requests are"} still waiting. Try again tomorrow.`
            : aiResult.failed > 0
              ? `${aiResult.failed} could not be analysed; the AI may be unavailable. Try again later.`
              : "Open a request to see its suggestions. People still make every decision."}
        </Alert>
      ) : null}

      {aiWaiting > 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3" data-ai-waiting="">
          <p className="text-sm text-charcoal">
            <span className="font-semibold">{aiWaiting} {aiWaiting === 1 ? "request is" : "requests are"} waiting for AI suggestions.</span>{" "}
            <span className="text-muted">Names and contact details are removed before anything is sent. Up to 30 at a time.</span>
          </p>
          <ActionForm action={analyseWaitingAction}>
            <SubmitButton variant="secondary" pendingLabel="Analysing… this can take a minute">Analyse waiting requests</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}

      <nav aria-label="Request status" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1 lg:flex-wrap lg:overflow-visible">
        {LIST_TABS.map((t) => {
          const active = t.key === tab;
          const n = tabCount(t.key, counts);
          return (
            <Link
              key={t.key}
              href={link({ status: t.key, page: "1" })}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex min-h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${
                active ? "border-forest text-forest" : "border-transparent text-muted hover:text-forest"
              }`}
            >
              {t.label}
              {n !== null ? (
                <span className={`rounded-full px-1.5 text-xs ${t.key === "attention" && n > 0 ? "bg-danger-soft text-danger-ink" : "bg-lightgrey text-charcoal"}`}>
                  {n}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <form method="get" action="/app/requests" className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        {tab !== "open" ? <input type="hidden" name="status" value={tab} /> : null}
        <div>
          <label htmlFor="filter-q" className="mb-1 block text-sm font-medium text-charcoal">Reference</label>
          <input id="filter-q" name="q" defaultValue={q} placeholder="e.g. MM-EEDC36" maxLength={20} autoCapitalize="characters"
            className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base" />
        </div>
        <div>
          <label htmlFor="filter-category" className="mb-1 block text-sm font-medium text-charcoal">Kind of help</label>
          <select id="filter-category" name="category" defaultValue={category}
            className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base">
            <option value="">All kinds</option>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="filter-channel" className="mb-1 block text-sm font-medium text-charcoal">Received through</label>
          <select id="filter-channel" name="channel" defaultValue={channel}
            className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base">
            <option value="">Any</option>
            <option value="public">Online form</option>
            <option value="staff">Recorded by staff</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("secondary")}>Filter</button>
          {filtered ? <Link href={link({ category: "", channel: "", q: "" })} className={buttonClass("ghost")}>Clear</Link> : null}
        </div>
      </form>

      {listResult.error || !list ? (
        <Alert tone="error">Requests could not be loaded. Refresh the page to try again.</Alert>
      ) : list.rows.length === 0 ? (
        <Card className="text-center">
          <p className="font-semibold text-charcoal">{filtered || tab !== "open" ? "No requests match." : "No open requests."}</p>
          <p className="mt-1 text-sm text-muted">
            {filtered
              ? "Try clearing the filters."
              : membership.church.status === "verified"
                ? "New requests from your public page and from staff will appear here."
                : "Requests recorded by staff appear here. Your public page opens once your church is verified."}
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm text-muted" aria-live="polite">
            {list.total} {list.total === 1 ? "request" : "requests"}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {list.rows.map((r) => (
              <li key={r.id}>
                <Link href={`/app/requests/${r.id}`}
                  className="flex flex-col gap-2 px-4 py-3 hover:bg-canvas sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-charcoal">{r.reference}</span>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      {r.attention_open ? <Badge tone="danger">⚠ Needs attention</Badge> : null}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {r.category_label}
                      {r.quantity_needed > 1 ? ` · ${r.quantity_needed} needed` : ""} · {CHANNEL_LABEL[r.channel]}
                    </p>
                  </div>
                  <time dateTime={r.created_at} className="shrink-0 text-sm text-muted">{formatDateTime(r.created_at)}</time>
                </Link>
              </li>
            ))}
          </ul>
          {totalPages > 1 ? (
            <nav aria-label="Pages" className="flex items-center justify-between">
              {page > 1 ? <Link href={link({ page: String(page - 1) })} className={buttonClass("secondary")}>Previous</Link> : <span />}
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              {page < totalPages ? <Link href={link({ page: String(page + 1) })} className={buttonClass("secondary")}>Next</Link> : <span />}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

