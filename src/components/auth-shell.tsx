import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Wordmark } from "@/components/ui";

export function AuthShell({ title, intro, children, footer }: { title: string; intro?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center bg-ivory px-4 py-10 sm:py-16">
      <Link href="/" className="mb-8 text-forest" aria-label="MERCYMAP home">
        <Wordmark className="text-2xl" />
      </Link>
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-charcoal">{title}</h1>
        {intro ? <p className="mt-2 text-sm text-muted">{intro}</p> : null}
        <div className="mt-6">{children}</div>
      </Card>
      {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
    </main>
  );
}
