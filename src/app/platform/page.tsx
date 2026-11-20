import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Button, Card, StatusBadge, Wordmark } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setChurchStatusAction } from "./actions";

export const metadata: Metadata = { title: "Platform administration", robots: { index: false, follow: false } };

type Church = {
  id: string; name: string; slug: string; status: "pending" | "verified" | "suspended";
  area: string | null; owner_email: string | null; created_at: string; verified_at: string | null;
  is_member: boolean;
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

// Church verification for MERCYMAP's own administrators. Anyone else gets a
// plain "not found" page, so the page's existence is not advertised.
export default async function PlatformPage() {
  const user = await requireUser("/platform");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_list_churches");
  if (error) notFound();
  const churches = (data ?? []) as Church[];

  return (
    <main id="main" tabIndex={-1} className="flex-1 bg-canvas px-5 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Wordmark className="text-forest" />
            <h1 className="mt-2 text-2xl font-bold text-charcoal">Church verification</h1>
            <p className="text-sm text-muted">Signed in as {user.email}</p>
          </div>
          <form action="/auth/sign-out" method="post">
            <Button variant="secondary" type="submit">
              Sign out
            </Button>
          </form>
        </div>

        {churches.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No churches have registered yet.</p>
          </Card>
        ) : (
          churches.map((c) => (
            <Card key={c.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-charcoal">{c.name}</h2>
                <StatusBadge status={c.status} />
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div><dt className="inline text-muted">Link name: </dt><dd className="inline break-all">{c.slug}</dd></div>
                <div><dt className="inline text-muted">Area: </dt><dd className="inline">{c.area ?? "Not given"}</dd></div>
                <div><dt className="inline text-muted">Registered by: </dt><dd className="inline break-all">{c.owner_email ?? "Unknown"}</dd></div>
                <div><dt className="inline text-muted">Registered: </dt><dd className="inline">{formatDate(c.created_at)}</dd></div>
              </dl>
              {c.is_member ? (
                <p className="rounded-lg bg-lightgrey p-3 text-sm text-muted" data-own-church="">
                  You belong to this church, so another platform administrator must review it.
                </p>
              ) : (
              <div className="flex flex-wrap gap-2">
                {c.status !== "verified" ? (
                  <ActionForm action={setChurchStatusAction} confirm={`Verify ${c.name}? Its public request link will be allowed to go live.`}>
                    <input type="hidden" name="churchId" value={c.id} />
                    <input type="hidden" name="status" value="verified" />
                    <SubmitButton pendingLabel="Verifying…">Verify</SubmitButton>
                  </ActionForm>
                ) : null}
                {c.status !== "suspended" ? (
                  <ActionForm action={setChurchStatusAction} confirm={`Suspend ${c.name}? Its public request link will stop working.`}>
                    <input type="hidden" name="churchId" value={c.id} />
                    <input type="hidden" name="status" value="suspended" />
                    <SubmitButton variant="danger" pendingLabel="Suspending…">Suspend</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
              )}
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
