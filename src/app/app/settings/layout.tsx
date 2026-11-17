import Link from "next/link";
import type { ReactNode } from "react";

const TABS = [
  { href: "/app/settings", label: "Church profile" },
  { href: "/app/settings/staff", label: "Staff" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-charcoal">Settings</h1>
      <nav aria-label="Settings" className="mt-4 mb-6 flex gap-2 border-b border-line">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="-mb-px flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm font-semibold text-muted hover:text-forest"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
