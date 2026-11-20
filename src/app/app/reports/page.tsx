import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  EXPORT_KINDS,
  EXPORT_LABEL,
  PERIOD_LABEL,
  PERIODS,
  bucketLabel,
  parsePeriod,
  percent,
  type ReportSummary,
} from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { OverTimeChart, RankedBars } from "./charts";

export const metadata: Metadata = { title: "Reports & Impact" };

function Figure({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4" data-figure={label}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-bold text-charcoal">{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-muted">{note}</dd> : null}
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { membership } = await requireMembership();
  const days = parsePeriod((await searchParams).days);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_summary", { p_church_id: membership.church.id, p_days: days });
  const r = data as ReportSummary | null;
  const canExport = membership.role === "owner" || membership.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Reports & Impact</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Worked out from {membership.church.name}&apos;s own records each time you open this page. Days are counted in
          Lagos time.
        </p>
      </div>

      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={p === 30 ? "/app/reports" : `/app/reports?days=${p}`}
            aria-current={p === days ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${
              p === days ? "border-forest bg-forest text-white" : "border-line bg-white text-charcoal hover:bg-lightgrey"
            }`}
          >
            {PERIOD_LABEL[p]}
          </Link>
        ))}
      </nav>

      {error || !r ? (
        <Alert tone="error">The report could not be loaded. Refresh the page to try again.</Alert>
      ) : (
        <>
          <p className="text-sm text-muted" data-period="">
            {formatDate(r.from)} to {formatDate(r.to)}
          </p>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Figure label="Requests received" value={r.totals.received} />
            <Figure label="Requests fulfilled" value={r.totals.fulfilled} />
            <Figure label="Units given out" value={r.totals.units_given} />
            <Figure
              label="Typical days to fulfil"
              value={r.totals.median_days_to_fulfil ?? "—"}
              note={r.totals.median_days_to_fulfil === null ? "No requests fulfilled yet" : "Median, received to fulfilled"}
            />
            <Figure label="Volunteer tasks completed" value={r.totals.tasks_completed} />
          </dl>
          <p className="text-sm text-muted" data-ai-share="">
            Staff chose the AI-suggested resource for {r.totals.approvals_ai_suggested} of {r.totals.approvals} approvals (
            {percent(r.totals.approvals_ai_suggested, r.totals.approvals)}). The AI only suggests; people approve.
          </p>

          <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <h2 className="text-lg font-bold text-charcoal">Requests over time</h2>
              <p className="mb-3 text-sm text-muted">
                Received and fulfilled per {r.bucket === "day" ? "day" : r.bucket === "week" ? "week" : "month"}
              </p>
              <OverTimeChart data={r.over_time} bucket={r.bucket} />
            </Card>
            <Card>
              <h2 className="text-lg font-bold text-charcoal">Requests by kind of help</h2>
              <p className="mb-3 text-sm text-muted">Requests received in this period</p>
              <RankedBars
                data={r.by_kind.map((k) => ({ name: k.label, value: k.count }))}
                label="Requests received by kind of help"
                unit="requests"
                empty="No requests in this period."
              />
            </Card>
            <Card>
              <h2 className="text-lg font-bold text-charcoal">Outcomes</h2>
              <p className="mb-3 text-sm text-muted">Where the requests received in this period stand now</p>
              <RankedBars
                data={r.outcomes.map((o) => ({ name: o.label, value: o.count }))}
                label="Outcomes of requests received in this period"
                unit="requests"
                empty="No requests in this period."
              />
            </Card>
            <Card>
              <h2 className="text-lg font-bold text-charcoal">Stock given out</h2>
              <p className="mb-3 text-sm text-muted">Units handed over in this period, by resource</p>
              <RankedBars
                data={r.given_by_resource.map((g) => ({ name: g.name, value: Number(g.quantity) }))}
                label="Units given out by resource"
                unit="units"
                empty="Nothing has been given out in this period."
              />
            </Card>
          </div>

          <details className="rounded-xl border border-line bg-white p-5">
            <summary className="cursor-pointer font-semibold text-charcoal">Show the figures as tables</summary>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <table className="w-full text-left text-sm" data-table="over-time">
                <caption className="mb-2 text-left font-semibold text-charcoal">Requests over time</caption>
                <thead className="text-muted"><tr><th scope="col" className="py-1">Starting</th><th scope="col" className="py-1 text-right">Received</th><th scope="col" className="py-1 text-right">Fulfilled</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {r.over_time.map((b) => (
                    <tr key={b.bucket}><td className="py-1">{bucketLabel(b.bucket, r.bucket)}</td><td className="py-1 text-right">{b.received}</td><td className="py-1 text-right">{b.fulfilled}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-6">
                {[
                  ["Requests by kind of help", r.by_kind.map((k) => [k.label, k.count])],
                  ["Outcomes", r.outcomes.map((o) => [o.label, o.count])],
                  ["Stock given out", r.given_by_resource.map((g) => [`${g.name} (${g.unit})`, g.quantity])],
                ].map(([title, rows]) => (
                  <table key={title as string} className="w-full text-left text-sm">
                    <caption className="mb-2 text-left font-semibold text-charcoal">{title as string}</caption>
                    <tbody className="divide-y divide-line">
                      {(rows as Array<[string, number]>).length === 0 ? (
                        <tr><td className="py-1 text-muted">None</td></tr>
                      ) : (
                        (rows as Array<[string, number]>).map(([name, value]) => (
                          <tr key={name}><td className="py-1">{name}</td><td className="py-1 text-right">{value}</td></tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ))}
              </div>
            </div>
          </details>

          <Card>
            <h2 className="text-lg font-bold text-charcoal">Download</h2>
            {canExport ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  CSV files for {PERIOD_LABEL[days].toLowerCase()}. They never include names, phone numbers or what people
                  wrote. Each download is recorded.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {EXPORT_KINDS.map((kind) => (
                    <form key={kind} action="/app/reports/export" method="post">
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="days" value={days} />
                      <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-forest hover:bg-lightgrey">
                        {EXPORT_LABEL[kind]} (CSV)
                      </button>
                    </form>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted">Only owners and administrators can download exports.</p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
