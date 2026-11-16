import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { signUpAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next, "");
  if (await getCurrentUser()) redirect(next || "/app");
  const invited = next.startsWith("/invite/");

  return (
    <AuthShell
      title="Create your staff account"
      intro={
        invited
          ? "Use the email address your invitation was sent to. You will confirm it before joining."
          : "Create an account, confirm your email, then register your church."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-forest underline">
            Sign in
          </Link>
        </>
      }
    >
      <ActionForm action={signUpAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, with a letter and a number."
          required
        />
        <Field name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password" required />
        <SubmitButton className="w-full" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
