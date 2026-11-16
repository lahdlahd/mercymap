import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { siteUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { membership } = await requireMembership();
  const { church } = membership;
  const publicLink = `${siteUrl()}/request/${church.slug}`;

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
        <Alert tone="success" title="Your church is verified">
          Your public request link is reserved: <span className="break-all font-medium">{publicLink}</span>. The
          request page itself is the next part of MERCYMAP to be switched on.
        </Alert>
      ) : null}

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
