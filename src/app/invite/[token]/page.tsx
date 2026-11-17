import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Alert, Button, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { looksLikeInvitationToken } from "@/lib/invitations";
import { createClient } from "@/lib/supabase/server";
import { acceptInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Invitation", robots: { index: false, follow: false } };

const ROLE_LABEL: Record<string, string> = { admin: "an administrator", coordinator: "a coordinator" };

function InvalidInvitation() {
  return (
    <AuthShell title="This invitation is not valid">
      <Alert tone="warning">
        The link may have expired, been used already or been revoked. Ask the person who invited you to send a new one.
      </Alert>
      <Link href="/sign-in" className={buttonClass("secondary", "mt-5 w-full")}>
        Go to sign in
      </Link>
    </AuthShell>
  );
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!looksLikeInvitationToken(token)) return <InvalidInvitation />;

  const here = encodeURIComponent(`/invite/${token}`);
  const user = await getCurrentUser();

  if (!user) {
    return (
      <AuthShell
        title="You have been invited to MERCYMAP"
        intro="Sign in or create an account with the email address this invitation was sent to. You will see the details before you accept."
      >
        <div className="flex flex-col gap-3">
          <Link href={`/sign-up?next=${here}`} className={buttonClass("primary", "w-full")}>
            Create an account
          </Link>
          <Link href={`/sign-in?next=${here}`} className={buttonClass("secondary", "w-full")}>
            I already have an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_invitation", { p_token: token });
  const invitation = (data as Array<{ church_name: string; role: string; invited_email: string; email_matches: boolean }> | null)?.[0];
  if (error || !invitation) return <InvalidInvitation />;

  if (!invitation.email_matches) {
    return (
      <AuthShell title="This invitation is for a different email address">
        <Alert tone="warning">
          You are signed in as <strong className="break-all">{user.email}</strong>, but this invitation was sent to
          another address. Sign out, then sign in with the address that received it.
        </Alert>
        <form action="/auth/sign-out" method="post" className="mt-5">
          <Button variant="secondary" type="submit" className="w-full">
            Sign out
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={`Join ${invitation.church_name}`}
      intro={`You have been invited to join as ${ROLE_LABEL[invitation.role] ?? "a staff member"}.`}
    >
      <p className="text-sm text-charcoal">
        You will be able to see and work on assistance requests for this church. Signed in as{" "}
        <strong className="break-all">{user.email}</strong>.
      </p>
      <ActionForm action={acceptInvitationAction} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <SubmitButton className="w-full" pendingLabel="Joining…">
          Accept invitation
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
