import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { emailSchema } from "@/lib/validation";
import { resendConfirmationAction } from "../actions";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const parsed = emailSchema.safeParse((await searchParams).email ?? "");
  const email = parsed.success ? parsed.data : null;

  return (
    <AuthShell
      title="Check your email"
      footer={
        <Link href="/sign-in" className="font-semibold text-forest underline">
          Back to sign in
        </Link>
      }
    >
      <p className="text-sm text-charcoal">
        We sent a confirmation link{email ? <> to <strong className="break-all">{email}</strong></> : null}. Open it on
        this device to finish creating your account. The link can be used once.
      </p>
      <p className="mt-3 text-sm text-muted">Nothing after a few minutes? Check your spam folder, then ask for another.</p>
      {email ? (
        <ActionForm action={resendConfirmationAction} className="mt-5">
          <input type="hidden" name="email" value={email} />
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            Send the email again
          </SubmitButton>
        </ActionForm>
      ) : null}
    </AuthShell>
  );
}
