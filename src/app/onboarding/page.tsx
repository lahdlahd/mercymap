import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";
import { getMembership, requireUser } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createChurchAction } from "./actions";
import { ChurchFields } from "./church-fields";

export const metadata: Metadata = { title: "Register your church" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  if (await getMembership()) redirect("/app");
  const siteHost = new URL(siteUrl()).host;
  const supabase = await createClient();
  const { data: pending } = await supabase.rpc("my_pending_invitations");
  const invitations = (pending ?? []) as Array<{ church_name: string; role: "admin" | "coordinator"; expires_at: string }>;

  return (
    <AuthShell
      title="Register your church"
      intro="You will be the owner of this workspace. We review each registration before its public request link goes live."
      footer={
        <form action="/auth/sign-out" method="post" className="flex flex-col items-center gap-2">
          <span>
            Signed in as <strong className="break-all">{user.email}</strong>
          </span>
          <span>Were you invited to an existing church? Open the invitation link you were sent.</span>
          <Button variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      }
    >
      {invitations.length ? (
        <div role="status" className="mb-6 rounded-lg border border-pending/40 bg-pending-soft p-4 text-sm text-pending-ink" data-pending-invitations="">
          <p className="font-semibold">
            You have been invited to join {invitations.map((i) => i.church_name).join(", ")}.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {invitations.map((i) => (
              <li key={`${i.church_name}-${i.expires_at}`}>
                {i.church_name} as {i.role === "admin" ? "an administrator" : "a coordinator"}, until{" "}
                {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }).format(new Date(i.expires_at))}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            To join, open the invitation link you were sent. Only register a new church below if you are setting up a
            different one.
          </p>
        </div>
      ) : null}
      <ActionForm action={createChurchAction} className="space-y-4">
        <ChurchFields siteHost={siteHost} />
        <SubmitButton className="w-full" pendingLabel="Registering…">
          Register church
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
