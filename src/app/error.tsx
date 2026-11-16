"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ivory px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-charcoal">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        Nothing was lost. Try again, and if it keeps happening, sign out and back in.
      </p>
      <Button className="mt-6" onClick={() => reset()}>
        Try again
      </Button>
    </main>
  );
}
