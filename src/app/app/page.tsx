import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Alert, buttonClass, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

type Dashboard = {
  open: number;
  new: number;
  attention: number;
  awaiting_match: number;
  approved: number;
  in_progress: number;
  fulfilled_this_month: number;
  units_given_this_month: number;
  low_stock: number;
  month_start: string;
};

// Every tile opens the list it counts.
function Tile({ href, label, value, note, alert, warn }: { href: string; label: string; value: number; note?: string; alert?: boolean; warn?: boolean }) {
  const tone = alert ? "border-danger/40 bg-danger-soft" : warn ? "border-pending/40 bg-pending-soft" : "border-line bg-white";
  const ink = alert ? "text-danger-ink" : warn ? "text-pending-ink" : "text-charcoal";
  return (
    <Link href={href} className={`block rounded-xl border p-4 hover:shadow-sm ${tone}`} data-tile={label}>
      <dt className={`text-sm ${alert || warn ? ink : "text-muted"}`}>{label}</dt>
      <dd className={`mt-1 font-display text-3xl font-bold ${ink}`}>{value}</dd>
      {note ? <dd className="text-xs text-muted">{note}</dd> : null}
    </Link>
  );
}

export default async function OverviewPage() {
  const { membership } = await requireMembership();
  const { church } = membership;
  const publicLink = `${siteUrl()}/request/${church.slug}`;
  const supabase = await createClient();
  const { data: summary } = await supabase.rpc("dashboard_summary", { p_church_id: church.id });
  const d = summary as Dashboard | null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold text-charcoal">Welcome to {church.name}</h1>

      {church.status === "pending" ? (
        <Alert tone="warning" title="Your church is awaiting verification">
          We review every registration before its public request link goes live. You can set up your staff while you
          wait.
        </Alert>
      ) : null}
      {church.status === "suspended" ? (
        <Alert tone="error" title="This workspace is suspended">
          Public requests are switched off. Contact MERCYMAP support to resolve this.
        </Alert>
      ) : null}
      {church.status === "verified" ? (
        <Card>
          <h2 className="text-lg font-bold text-charcoal">Your public request page is live</h2>
          <p className="mt-1 text-sm text-muted">
            Share this link so people can ask for help without creating an account.
          </p>
          <p className="mt-3 rounded-md border border-line bg-canvas p-3 font-mono text-sm [overflow-wrap:anywhere]">
            {publicLink}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={publicLink} />
            <a href={`/request/${church.slug}`} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              Open the page
            </a>
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="dashboard-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="dashboard-heading" className="text-lg font-bold text-charcoal">At a glance</h2>
          <Link href="/app/reports" className="text-sm font-semibold text-forest underline">Reports & Impact</Link>
        </div>
        {d ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile href="/app/requests?status=attention" label="Needs attention" value={d.attention} alert={d.attention > 0} />
            <Tile href="/app/requests?status=submitted" label="New" value={d.new} />
            <Tile href="/app/requests" label="Open" value={d.open} />
            <Tile href="/app/requests?status=awaiting_match" label="Awaiting a resource" value={d.awaiting_match} />
            <Tile href="/app/requests?status=approved" label="Approved" value={d.approved} />
            <Tile href="/app/requests?status=in_progress" label="In delivery" value={d.in_progress} />
            <Tile href="/app/reports" label="Helped this month" value={d.fulfilled_this_month} note={`Since ${formatDate(d.month_start)}`} />
            <Tile href="/app/reports" label="Units given this month" value={d.units_given_this_month} note={`Since ${formatDate(d.month_start)}`} />
            <Tile href="/app/resources" label="Resources running low" value={d.low_stock} warn={d.low_stock > 0} />
          </dl>
        ) : (
          <p className="text-sm text-muted">The figures could not be loaded. Refresh the page to try again.</p>
        )}
      </section>

      <Card>
        <h2 className="text-lg font-bold text-charcoal">Someone at the church needs help?</h2>
        <p className="mt-1 text-sm text-muted">Record their request for them. It joins the same list as online requests.</p>
        <Link href="/app/requests/new" className={buttonClass("primary", "mt-4")}>
          Record a request
        </Link>
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-charcoal">Your team</h2>
        <p className="mt-1 text-sm text-muted">
          {canManageStaff(membership.role)
            ? "Invite the people who will review and coordinate requests."
            : "See who else works in this workspace."}
        </p>
        <Link href="/app/settings/staff" className={buttonClass("primary", "mt-4")}>
          {canManageStaff(membership.role) ? "Manage staff" : "View staff"}
        </Link>
      </Card>
    </div>
  );
}
