import Link from "next/link";
import type { ReactNode } from "react";
import { Button, StatusBadge, Wordmark } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Navigation grows as each milestone delivers a working section.
const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/requests", label: "Requests" },
  { href: "/app/requests/new", label: "Record a request" },
  { href: "/app/resources", label: "Resources" },
  { href: "/app/volunteers", label: "Volunteers" },
  { href: "/app/settings", label: "Settings" },
];

const ROLE_LABEL = { owner: "Owner", admin: "Administrator", coordinator: "Coordinator" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await requireMembership();
  const { church } = membership;
  const supabase = await createClient();
  const unreadResult = await supabase.rpc("unread_notification_count", { p_church_id: church.id });
  const unread = unreadResult.error ? 0 : Number(unreadResult.data ?? 0);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="bg-forest text-white md:w-64 md:shrink-0">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/app" aria-label="MERCYMAP overview">
            <Wordmark />
          </Link>
          <p className="truncate text-sm text-white/80 md:mt-4" title={church.name}>
            {church.name}
          </p>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm font-medium text-white/90 hover:bg-white/10"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden truncate font-display text-base font-bold text-charcoal md:inline">{church.name}</span>
            <StatusBadge status={church.status} />
          </div>
          <div className="flex items-center gap-3">
          <Link
            href="/app/notifications"
            data-bell=""
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 text-charcoal hover:bg-lightgrey"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {unread ? (
              <span data-unread-count="" className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-danger px-1.5 text-center text-xs font-bold leading-5 text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
          <form action="/auth/sign-out" method="post" className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              {user.email} · {ROLE_LABEL[membership.role]}
            </span>
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
          </div>
        </header>
        <main className="flex-1 px-5 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
