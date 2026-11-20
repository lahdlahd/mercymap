"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function MarkAllReadForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant="secondary" pendingLabel="Saving…">Mark all as read</SubmitButton>
    </ActionForm>
  );
}

export function OpenNotificationForm({ action, label }: { action: Action; label: string }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant="secondary" pendingLabel="Opening…">{label}</SubmitButton>
    </ActionForm>
  );
}
