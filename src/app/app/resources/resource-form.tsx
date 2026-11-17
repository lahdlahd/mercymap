"use client";

import { useState } from "react";
import { ActionForm, ChoiceGroup, Field, SelectField, SubmitButton, TextAreaField } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";
import type { Resource } from "@/lib/resources";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function ResourceForm({
  action,
  categories,
  members,
  resource,
}: {
  action: Action;
  categories: Array<{ key: string; label: string }>;
  members: Array<{ user_id: string; email: string }>;
  resource?: Resource;
}) {
  const [source, setSource] = useState<string>(resource?.source_type ?? "church");
  return (
    <ActionForm action={action} className="space-y-5">
      <Field name="name" label="Name" defaultValue={resource?.name} maxLength={160} hint="For example, Food package (family of 4)." />
      <SelectField
        name="category"
        label="Kind of help"
        defaultValue={resource?.category_key ?? ""}
        options={[{ value: "", label: "Choose…" }, ...categories.map((c) => ({ value: c.key, label: c.label }))]}
      />
      <TextAreaField name="description" label="Description (optional)" defaultValue={resource?.description ?? ""} rows={3} maxLength={2000} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="unit" label="Unit" defaultValue={resource?.unit} maxLength={40} hint="What one of these is: package, voucher, visit." />
        <Field
          name="total"
          label="Total quantity"
          type="number"
          inputMode="numeric"
          min={0}
          max={1000000}
          defaultValue={resource?.total_quantity ?? ""}
          hint={resource ? `${resource.reserved} reserved and ${resource.distributed} given out so far.` : "Everything you have, including what will be reserved."}
        />
      </div>
      <ChoiceGroup
        name="sourceType"
        legend="Where it comes from"
        defaultValue={resource?.source_type ?? "church"}
        onChange={setSource}
        columns={2}
        options={[
          { value: "church", label: "The church" },
          { value: "partner", label: "A partner", hint: "Another organisation provides it." },
        ]}
      />
      {source === "partner" ? (
        <Field name="sourceName" label="Partner name" defaultValue={resource?.source_name ?? ""} maxLength={160} />
      ) : null}
      <TextAreaField
        name="areas"
        label="Areas it covers (optional)"
        defaultValue={resource?.coverage_areas.join("\n") ?? ""}
        rows={3}
        hint="One per line or separated by commas. Leave empty if it can serve any area."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="validFrom" label="Available from (optional)" type="date" defaultValue={resource?.valid_from ?? ""} />
        <Field name="validUntil" label="Available until (optional)" type="date" defaultValue={resource?.valid_until ?? ""} />
      </div>
      <SelectField
        name="manager"
        label="Person responsible (optional)"
        defaultValue={resource?.manager_user_id ?? ""}
        options={[{ value: "", label: "No one in particular" }, ...members.map((m) => ({ value: m.user_id, label: m.email }))]}
      />
      <SubmitButton pendingLabel="Saving…">{resource ? "Save changes" : "Add resource"}</SubmitButton>
    </ActionForm>
  );
}

export function StatusButton({ action, archived }: { action: Action; archived: boolean }) {
  return (
    <ActionForm
      action={action}
      confirm={archived ? "Restore this resource so it can be offered again?" : "Archive this resource? It will no longer be offered for new requests. Stock already reserved stays reserved."}
    >
      <SubmitButton variant="secondary" pendingLabel="Saving…">
        {archived ? "Restore" : "Archive"}
      </SubmitButton>
    </ActionForm>
  );
}
