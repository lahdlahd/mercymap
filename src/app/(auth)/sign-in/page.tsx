import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { signInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Record<string, { tone: "info" | "warning"; text: string }> = {
  "signed-out": { tone: "info", text: "You have been signed out." },
  "link-invalid": {
    tone: "warning",
    text: "That link has expired or was already used. Sign in, or ask for a new link.",
  },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getCurrentUser()) redirect(next);
  const notice = params.notice ? NOTICES[params.notice] : undefined;
  const nextQuery = next !== "/app" ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <AuthShell
      title="Sign in"
      intro="For church staff. People asking for help never need an account."
      footer={
        <>
          New to MERCYMAP?{" "}
          <Link href={`/sign-up${nextQuery}`} className="font-semibold text-forest underline">
            Create an account
          </Link>
        </>
      }
    >
      {notice ? (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      <ActionForm action={signInAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <Field name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-forest underline">
            Forgot your password?
          </Link>
        </p>
      </ActionForm>
    </AuthShell>
  );
}
