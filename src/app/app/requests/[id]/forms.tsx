"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { withPhone } from "@/lib/volunteers";
import { ActionForm, CheckboxField, ChoiceGroup, SelectField, SubmitButton, TextAreaField } from "@/components/action-form";
import type { FormState } from "@/lib/form-state";
import { ACTION_LABEL, actionLabel, holdsStock, needsNote, type RequestStatus } from "@/lib/requests";
import { COVERAGE_LABEL, MISMATCH_LABEL, type Coverage, type MismatchReason } from "@/lib/resources";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export function StatusForm({ action, status, options }: { action: Action; status: RequestStatus; options: RequestStatus[] }) {
  // The choice belongs to the status it was made on. If the page refreshes to
  // a new status (after a change, or someone else's), the old choice is dropped
  // so the note label never describes an option that is no longer selected.
  const [picked, setPicked] = useState<{ on: RequestStatus; value: RequestStatus } | null>(null);
  const choice = picked && picked.on === status ? picked.value : null;
  const prompt = choice
    ? ACTION_LABEL[choice]?.notePrompt ?? (holdsStock(status) && choice === "awaiting_match" ? "Why is the stock being released?" : undefined)
    : undefined;
  const required = choice ? needsNote(status, choice) : false;
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
        onChange={(v) => setPicked({ on: status, value: v as RequestStatus })}
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

export type Candidate = {
  id: string;
  name: string;
  unit: string;
  source_type: "church" | "partner";
  source_name: string | null;
  available: number;
  total: number;
  valid_until: string | null;
  coverage: Coverage;
  reason: MismatchReason | null;
};

// Lists the church's resources of the right kind. Only ones that fit every
// rule can be chosen; the others are shown with the reason, so staff can see
// why nothing matched. The database checks the rules again when approving.
export function ApproveForm({
  action,
  candidates,
  quantity,
}: {
  action: Action;
  candidates: Candidate[];
  quantity: number;
}) {
  const fitting = candidates.filter((c) => !c.reason);
  const other = candidates.filter((c) => c.reason);
  return (
    <ActionForm action={action} className="space-y-4" confirm="Approve this request and reserve the stock?">
      {fitting.length === 0 ? (
        <p className="rounded-lg border border-pending/40 bg-pending-soft p-3 text-sm text-pending-ink">
          No resource can meet this request right now. Add or restock a resource of this kind, or close the request.
        </p>
      ) : (
        <ChoiceGroup
          name="resourceId"
          legend={`Reserve ${quantity} from:`}
          options={fitting.map((c) => ({
            value: c.id,
            label: c.name,
            hint: `${c.available} ${c.unit} available · ${c.source_type === "partner" ? `from ${c.source_name}` : "church stock"} · ${COVERAGE_LABEL[c.coverage]}${c.valid_until ? ` · until ${c.valid_until}` : ""}`,
          }))}
        />
      )}
      {other.length > 0 ? (
        <div className="text-sm">
          <p className="font-semibold text-muted">Cannot be used for this request:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
            {other.map((c) => (
              <li key={c.id}>
                {c.name}: {MISMATCH_LABEL[c.reason as MismatchReason]}
                {c.reason === "not_enough" ? ` (${c.available} ${c.unit} left)` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {fitting.length > 0 ? (
        <>
          <TextAreaField name="note" label="Note (optional)" hint="For example, when and where to collect." rows={2} maxLength={1000} />
          <SubmitButton pendingLabel="Approving…">Approve and reserve</SubmitButton>
        </>
      ) : null}
    </ActionForm>
  );
}

export function FulfilForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="space-y-3" confirm="Record that this help has been given? The stock will be counted as distributed.">
      <TextAreaField name="note" label="Delivery note (optional)" hint="For example, who handed it over." rows={2} maxLength={1000} />
      <SubmitButton pendingLabel="Saving…">Mark as fulfilled</SubmitButton>
    </ActionForm>
  );
}

// Removes ?changed=1 from the address once the notice is shown, so a later
// refresh or action does not show it again.
export function ClearChangedNotice() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("changed")) {
      url.searchParams.delete("changed");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, []);
  return null;
}

// While an analysis is waiting or running, refresh the page a few times so the
// suggestions appear without the person reloading.
export function AiAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= 10) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

export function RerunAiForm({ action, label }: { action: Action; label: string }) {
  return (
    <ActionForm action={action}>
      <SubmitButton variant="secondary" pendingLabel="Analysing…">{label}</SubmitButton>
    </ActionForm>
  );
}

export function UseCategoryForm({ action, label }: { action: Action; label: string }) {
  return (
    <ActionForm action={action} confirm={`Change the kind of help to ${label}?`}>
      <SubmitButton variant="secondary" pendingLabel="Saving…">Use suggested category</SubmitButton>
    </ActionForm>
  );
}

export function AssignVolunteerForm({
  action,
  volunteers,
  baseBrief,
  requesterPhone,
}: {
  action: Action;
  volunteers: Array<{ id: string; name: string }>;
  baseBrief: string;
  requesterPhone: string | null;
}) {
  const [includePhone, setIncludePhone] = useState(false);
  const [brief, setBrief] = useState(baseBrief);
  const toggle = (on: boolean) => {
    setIncludePhone(on);
    setBrief((b) => (on ? withPhone(b, requesterPhone) : b.replace(`\nContact: ${requesterPhone}`, "")));
  };
  return (
    <ActionForm action={action} className="space-y-4">
      <SelectField
        name="volunteerId"
        label="Volunteer"
        defaultValue=""
        options={[{ value: "", label: "Choose…" }, ...volunteers.map((v) => ({ value: v.id, label: v.name }))]}
      />
      <div>
        <label htmlFor="task-brief" className="block font-semibold text-charcoal">Task brief</label>
        <p className="mt-0.5 text-sm text-muted">What the volunteer receives. It leaves out the person&apos;s name and story.</p>
        <textarea
          id="task-brief"
          name="brief"
          rows={6}
          maxLength={2000}
          value={brief}
          onChange={(e) => setBrief(e.currentTarget.value)}
          className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-base text-charcoal"
        />
      </div>
      {requesterPhone ? (
        <CheckboxField
          name="includePhone"
          defaultChecked={includePhone}
          onChange={toggle}
          label="Include the person's phone number in the brief"
        />
      ) : null}
      <SubmitButton pendingLabel="Saving…">Give task</SubmitButton>
    </ActionForm>
  );
}

export function TaskStatusForm({ action, label, confirm }: { action: Action; label: string; confirm?: string }) {
  return (
    <ActionForm action={action} confirm={confirm}>
      <SubmitButton variant="secondary" pendingLabel="Saving…">{label}</SubmitButton>
    </ActionForm>
  );
}

export function CopyBriefButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass("secondary")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Copied" : "Copy brief"}
    </button>
  );
}
