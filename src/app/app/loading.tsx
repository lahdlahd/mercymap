export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-3xl space-y-4">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-64 animate-pulse rounded-lg bg-lightgrey" />
      <div className="h-32 animate-pulse rounded-xl bg-lightgrey" />
      <div className="h-32 animate-pulse rounded-xl bg-lightgrey" />
    </div>
  );
}
