import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Wordmark } from "@/components/ui";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 flex-col items-center justify-center bg-ivory px-6 py-16 text-center">
      <Wordmark className="text-2xl text-forest" />
      <h1 className="mt-6 text-2xl font-bold text-charcoal">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page you were looking for does not exist or has moved.</p>
      <Link href="/" className={buttonClass("primary", "mt-6")}>
        Go to the home page
      </Link>
    </main>
  );
}
