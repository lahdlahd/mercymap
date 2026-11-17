import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { Alert, buttonClass, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { membership } = await requireMembership();
  const { church } = membership;
  const publicLink = `${siteUrl()}/request/${church.slug}`;
  const supabase = await createClient();
  const { data: countsData } = await supabase.rpc("request_status_counts", { p_church_id: church.id });
  const counts = countsData as { open: number; attention_open: number; by_status: Record<string, number> } | null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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

      <Card>
        <h2 className="text-lg font-bold text-charcoal">Requests</h2>
        {counts ? (
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Link href="/app/requests?status=submitted" className="rounded-lg border border-line p-3 hover:bg-canvas">
              <dt className="text-xs text-muted">New</dt>
              <dd className="font-display text-2xl font-bold text-charcoal">{counts.by_status.submitted ?? 0}</dd>
            </Link>
            <Link href="/app/requests" className="rounded-lg border border-line p-3 hover:bg-canvas">
              <dt className="text-xs text-muted">Open</dt>
              <dd className="font-display text-2xl font-bold text-charcoal">{counts.open}</dd>
            </Link>
            <Link href="/app/requests?status=attention"
              className={`rounded-lg border p-3 hover:bg-canvas ${counts.attention_open > 0 ? "border-danger/40 bg-danger-soft" : "border-line"}`}>
              <dt className={`text-xs ${counts.attention_open > 0 ? "text-danger-ink" : "text-muted"}`}>Need attention</dt>
              <dd className={`font-display text-2xl font-bold ${counts.attention_open > 0 ? "text-danger-ink" : "text-charcoal"}`}>{counts.attention_open}</dd>
            </Link>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">Request counts could not be loaded.</p>
        )}
        <Link href="/app/requests" className={buttonClass("secondary", "mt-4")}>View requests</Link>
      </Card>

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
