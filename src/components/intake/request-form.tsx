"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  CheckboxField,
  ChoiceGroup,
  Field,
  FormContext,
  SubmitButton,
  TextAreaField,
} from "@/components/action-form";
import { Alert, Button } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";
import { DESCRIPTION_MAX } from "@/lib/intake";
import { Turnstile } from "./turnstile";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Category = { key: string; label: string };

type Props = {
  action: Action;
  categories: Category[];
  mode: "public" | "staff";
  churchName: string;
  siteKey?: string | null;
};

const CONTACT_OPTIONS = {
  public: [
    { value: "phone_call", label: "Call me" },
    { value: "sms", label: "Send me a text message (SMS)" },
    { value: "in_person", label: "I will visit the church" },
    { value: "none", label: "I don't have a phone", hint: "Visit the church and give your reference number." },
  ],
  staff: [
    { value: "in_person", label: "In person at the church" },
    { value: "phone_call", label: "Phone call" },
    { value: "sms", label: "SMS" },
    { value: "none", label: "No way to contact them" },
  ],
};

// One form for both channels. The public version adds the bot check and a
// hidden trap field; the staff version records consent given in person.
export function RequestForm(props: Props) {
  const [round, setRound] = useState(0);
  return <RequestFormInner key={round} {...props} onAnother={() => setRound((r) => r + 1)} />;
}

function RequestFormInner({ action, categories, mode, churchName, siteKey, onAnother }: Props & { onAnother: () => void }) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const defaultMethod = mode === "public" ? "phone_call" : "in_person";
  const [method, setMethod] = useState(state.values?.contactMethod ?? defaultMethod);
  const [length, setLength] = useState(state.values?.description?.length ?? 0);
  const topRef = useRef<HTMLDivElement>(null);

  // Bring any error message (or the confirmation) into view on small screens.
  useEffect(() => {
    if (state !== emptyFormState) topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [state]);

  if (state.ok && state.data?.reference) {
    return (
      <div ref={topRef}>
        {mode === "public" ? (
          <PublicConfirmation reference={state.data.reference} churchName={churchName} method={state.data.method} />
        ) : (
          <div className="space-y-4">
            <Alert tone="success" title="Request recorded">
              Reference <strong className="font-mono">{state.data.reference}</strong>. Give this to the person so they can
              quote it when they get in touch.
            </Alert>
            <Button type="button" variant="secondary" onClick={onAnother}>
              Record another request
            </Button>
          </div>
        )}
      </div>
    );
  }

  const phoneNeeded = method === "phone_call" || method === "sms";

  return (
    <FormContext value={{ state, pending }}>
      <div ref={topRef} />
      <form action={formAction} noValidate className="space-y-6">
        {state.message ? <Alert tone="error">{state.message}</Alert> : null}

        <ChoiceGroup
          name="category"
          legend={mode === "public" ? "What kind of help do you need?" : "Kind of help needed"}
          options={categories.map((c) => ({ value: c.key, label: c.label }))}
          columns={2}
        />

        <TextAreaField
          name="description"
          label={mode === "public" ? "Tell us about your situation" : "What did they tell you?"}
          hint={
            mode === "public"
              ? "Write in your own words. Only share what you are comfortable sharing."
              : "Record what the person said, in their words where possible."
          }
          maxLength={DESCRIPTION_MAX}
          rows={6}
          required
          onChange={(e) => setLength(e.target.value.length)}
        />
        <p className="-mt-4 text-right text-xs text-muted" aria-live="polite">
          {length} / {DESCRIPTION_MAX}
        </p>

        <Field
          name="quantity"
          label={mode === "public" ? "How many do you need?" : "Quantity needed"}
          hint="For example, food packages for 3 people. Leave as 1 if you are not sure."
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          defaultValue="1"
          className="max-w-xs"
        />

        <Field
          name="name"
          label={mode === "public" ? "Your name (optional)" : "Their name (optional)"}
          autoComplete={mode === "public" ? "name" : "off"}
          maxLength={120}
        />

        <ChoiceGroup
          name="contactMethod"
          legend={mode === "public" ? `How can ${churchName} reach you?` : "How can the church reach them?"}
          options={CONTACT_OPTIONS[mode]}
          defaultValue={defaultMethod}
          onChange={setMethod}
        />

        {phoneNeeded ? (
          <Field
            name="contactValue"
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete={mode === "public" ? "tel" : "off"}
            placeholder="0803 123 4567"
            maxLength={40}
          />
        ) : null}

        <Field
          name="area"
          label={mode === "public" ? "Your area or neighbourhood (optional)" : "Area or neighbourhood (optional)"}
          hint="Not your full address. This helps the church know who can help nearby."
          maxLength={120}
        />

        <CheckboxField
          name="consent"
          label={
            mode === "public" ? (
              <>
                I agree that {churchName} may use what I have written to review my request and contact me about it. I
                understand that automated tools, including AI services that may be based outside Nigeria, may help the
                church read requests, and that people at the church make every decision.
              </>
            ) : (
              <>
                The person agreed that {churchName} may record and use this information to review their request and
                contact them about it, including with the help of automated tools.
              </>
            )
          }
        />

        {mode === "public" ? (
          <>
            {/* Trap for automated form-fillers; hidden from people and screen readers. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Leave this empty
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {siteKey ? <Turnstile siteKey={siteKey} resetSignal={state} /> : null}
          </>
        ) : null}

        <SubmitButton className="w-full sm:w-auto" pendingLabel={mode === "public" ? "Sending…" : "Saving…"}>
          {mode === "public" ? "Send my request" : "Record request"}
        </SubmitButton>
      </form>
    </FormContext>
  );
}

function PublicConfirmation({ reference, churchName, method }: { reference: string; churchName: string; method?: string }) {
  const contact =
    method === "phone_call"
      ? "They may call you on the number you gave."
      : method === "sms"
        ? "They may send a text message to the number you gave."
        : method === "in_person"
          ? "Visit the church and give them your reference number."
          : "Visit the church and give them your reference number, as you did not leave a phone number.";
  return (
    <div className="space-y-5" role="status">
      <div className="rounded-xl border border-success/30 bg-sage p-5">
        <h2 className="text-xl font-bold text-charcoal">Your request has been sent</h2>
        <p className="mt-2 text-sm text-charcoal">Your reference number is</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-forest">{reference}</p>
        <p className="mt-2 text-sm text-muted">Write it down or take a screenshot. You may be asked for it.</p>
      </div>
      <div>
        <h3 className="font-bold text-charcoal">What happens next</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-charcoal">
          <li>Someone at {churchName} will read your request.</li>
          <li>{contact}</li>
          <li>Sending a request does not guarantee help, and it is not an emergency service.</li>
        </ul>
      </div>
      <p className="text-sm text-muted">
        For your privacy, this reference does not let anyone see your request online.
      </p>
    </div>
  );
}
