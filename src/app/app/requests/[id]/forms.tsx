"use client";

import { useState } from "react";
import { ActionForm, ChoiceGroup, SubmitButton, TextAreaField } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";
import { ACTION_LABEL, actionLabel, needsNote, type RequestStatus } from "@/lib/requests";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function StatusForm({ action, status, options }: { action: Action; status: RequestStatus; options: RequestStatus[] }) {
  const [choice, setChoice] = useState<RequestStatus | null>(null);
  const prompt = choice ? ACTION_LABEL[choice]?.notePrompt : undefined;
  const required = choice ? needsNote(choice) : false;
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-4">
      <ChoiceGroup
        key={status}
        name="toStatus"
        legend="What happens next?"
        options={options.map((o) => {
          const a = actionLabel(status, o);
          return { value: o, label: a.label, hint: a.help };
        })}
        onChange={(v) => setChoice(v as RequestStatus)}
      />
      <TextAreaField
        key={`note-${status}`}
        name="note"
        label={prompt ?? (required ? "Note" : "Note (optional)")}
        hint={required ? "Required. Kept in this request's history." : "Kept in this request's history."}
        rows={3}
        maxLength={1000}
      />
      <SubmitButton pendingLabel="Saving…">Update status</SubmitButton>
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-3">
      <TextAreaField name="note" label="Add a note" hint="For example, a call made or something the person said." rows={3} maxLength={2000} />
      <SubmitButton variant="secondary" pendingLabel="Saving…">Add note</SubmitButton>
    </ActionForm>
  );
}

export function FlagForm({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-danger-ink underline">
        Raise a safeguarding concern
      </button>
    );
  }
  return (
    <ActionForm action={action} className="space-y-3">
      <TextAreaField
        name="reason"
        label="What is the concern?"
        hint="For example, a risk to a child, abuse, violence or a medical emergency. This marks the request as needing attention until someone records that it was reviewed."
        rows={3}
        maxLength={500}
      />
      <SubmitButton variant="danger" pendingLabel="Saving…">Raise concern</SubmitButton>
    </ActionForm>
  );
}

export function AcknowledgeForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="mt-3 space-y-3">
      <TextAreaField
        name="note"
        label="What was done or decided?"
        hint="Your name and the time are recorded with this."
        rows={2}
        maxLength={1000}
      />
      <SubmitButton pendingLabel="Saving…">Mark as reviewed</SubmitButton>
    </ActionForm>
  );
}
