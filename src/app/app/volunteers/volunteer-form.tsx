"use client";

import { ActionForm, CheckboxField, Field, SubmitButton, TextAreaField } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";
import type { Volunteer } from "@/lib/volunteers";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function VolunteerForm({ action, volunteer }: { action: Action; volunteer?: Volunteer }) {
  return (
    <ActionForm action={action} className="space-y-5">
      <Field name="fullName" label="Name" defaultValue={volunteer?.full_name} maxLength={120} autoComplete="off" />
      <Field
        name="phone"
        label="Phone (optional)"
        type="tel"
        inputMode="tel"
        defaultValue={volunteer?.phone ?? ""}
        hint="Used to send them task briefs on WhatsApp."
      />
      <CheckboxField
        name="consent"
        defaultChecked={Boolean(volunteer?.consent_given_at)}
        label="They agreed that the church may keep their phone number for volunteer tasks."
      />
      <TextAreaField
        name="skills"
        label="Skills (optional)"
        rows={2}
        defaultValue={volunteer?.skills.join(", ") ?? ""}
        hint="Separated by commas, for example: driving, cooking, has a car."
      />
      <TextAreaField
        name="availability"
        label="When they can help (optional)"
        rows={2}
        maxLength={500}
        defaultValue={volunteer?.availability_notes ?? ""}
      />
      <SubmitButton pendingLabel="Saving…">{volunteer ? "Save changes" : "Add volunteer"}</SubmitButton>
    </ActionForm>
  );
}

export function VolunteerStatusButton({ action, inactive }: { action: Action; inactive: boolean }) {
  return (
    <ActionForm
      action={action}
      confirm={inactive ? "Make this volunteer available for new tasks again?" : "Mark this volunteer as not available? Existing tasks stay as they are."}
    >
      <SubmitButton variant="secondary" pendingLabel="Saving…">{inactive ? "Make available again" : "Mark as not available"}</SubmitButton>
    </ActionForm>
  );
}
