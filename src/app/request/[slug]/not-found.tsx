import { Wordmark } from "@/components/ui";

// Same page whether the church does not exist, is awaiting verification or is
// suspended, so the link cannot be used to learn which churches are registered.
export default function RequestPageNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ivory px-6 py-16 text-center">
      <Wordmark className="text-2xl text-forest" />
      <h1 className="mt-6 text-2xl font-bold text-charcoal">This request page is not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        The link may be mistyped, or the church may not be accepting requests through MERCYMAP yet. Please contact the
        church directly.
      </p>
      <p className="mt-4 max-w-md text-sm text-muted">
        If anyone is in immediate danger or needs urgent medical help, contact your local emergency services now.
      </p>
    </main>
  );
}
