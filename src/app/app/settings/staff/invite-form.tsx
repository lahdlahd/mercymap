"use client";

import { ActionForm, Field, SelectField, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { inviteStaffAction } from "./actions";

export function InviteForm({ canInviteAdmin, expiryDays }: { canInviteAdmin: boolean; expiryDays: number }) {
  const roles = [
    { value: "coordinator", label: "Coordinator" },
    ...(canInviteAdmin ? [{ value: "admin", label: "Administrator" }] : []),
  ];
  return (
    <ActionForm
      action={inviteStaffAction}
      className="space-y-4"
      renderResult={(state) =>
        state.data?.url ? (
          <div className="rounded-lg border border-line bg-canvas p-4">
            <p className="text-sm font-semibold text-charcoal">Send this link to {state.data.email}</p>
            <p className="mt-1 text-sm text-muted">
              It is shown only once, works for {expiryDays} days and can be used by that email address alone.
            </p>
            <p className="mt-3 break-all rounded-md border border-line bg-white p-3 font-mono text-sm">{state.data.url}</p>
            <div className="mt-3">
              <CopyButton value={state.data.url} />
            </div>
          </div>
        ) : null
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field name="email" label="Email address" type="email" inputMode="email" autoComplete="off" required />
        <SelectField name="role" label="Role" options={roles} defaultValue="coordinator" />
      </div>
      <SubmitButton pendingLabel="Creating…">Create invitation</SubmitButton>
    </ActionForm>
  );
}
