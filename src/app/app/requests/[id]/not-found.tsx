import Link from "next/link";
import { buttonClass, Card } from "@/components/ui";

// Shown for unknown requests and for requests that belong to another church alike.
export default function RequestNotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <Card className="text-center">
        <h1 className="text-xl font-bold text-charcoal">Request not found</h1>
        <p className="mt-2 text-sm text-muted">It may not exist, or it may belong to another church.</p>
        <Link href="/app/requests" className={buttonClass("primary", "mt-5")}>All requests</Link>
      </Card>
    </div>
  );
}
