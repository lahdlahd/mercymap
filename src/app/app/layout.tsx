import Link from "next/link";
import type { ReactNode } from "react";
import { Button, StatusBadge, Wordmark } from "@/components/ui";
import { requireMembership } from "@/lib/auth";

// Navigation grows as each milestone delivers a working section.
const NAV = [
  { href: "/app", label: "Overview" },
  { href: "/app/requests", label: "Requests" },
  { href: "/app/requests/new", label: "Record a request" },
  { href: "/app/settings", label: "Settings" },
];

const ROLE_LABEL = { owner: "Owner", admin: "Administrator", coordinator: "Coordinator" } as const;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, membership } = await requireMembership();
  const { church } = membership;

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
          <form action="/auth/sign-out" method="post" className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              {user.email} · {ROLE_LABEL[membership.role]}
            </span>
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </header>
        <main className="flex-1 px-5 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
