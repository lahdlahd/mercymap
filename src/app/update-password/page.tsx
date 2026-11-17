import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { AuthShell } from "@/components/auth-shell";
import { requireUser } from "@/lib/auth";
import { updatePasswordAction } from "../(auth)/actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  const user = await requireUser("/update-password");
  return (
    <AuthShell title="Choose a new password" intro={`For ${user.email}`}>
      <ActionForm action={updatePasswordAction} className="space-y-4">
        <Field
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters, with a letter and a number."
          required
        />
        <Field name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required />
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save new password
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
