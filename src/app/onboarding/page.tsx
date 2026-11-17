import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui";
import { getMembership, requireUser } from "@/lib/auth";
import { siteUrl } from "@/lib/env";
import { createChurchAction } from "./actions";
import { ChurchFields } from "./church-fields";

export const metadata: Metadata = { title: "Register your church" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding");
  if (await getMembership()) redirect("/app");
  const siteHost = new URL(siteUrl()).host;

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
      <ActionForm action={createChurchAction} className="space-y-4">
        <ChurchFields siteHost={siteHost} />
        <SubmitButton className="w-full" pendingLabel="Registering…">
          Register church
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
