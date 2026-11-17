import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { requestPasswordResetAction } from "../actions";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      intro="Enter your email address and we will send you a link to choose a new password."
      footer={
        <Link href="/sign-in" className="font-semibold text-forest underline">
          Back to sign in
        </Link>
      }
    >
      <ActionForm action={requestPasswordResetAction} className="space-y-4">
        <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
        <SubmitButton className="w-full" pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
