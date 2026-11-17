"use client";

import { createContext, useActionState, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { Alert, buttonClass, type ButtonVariant } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: emptyFormState, pending: false });

// Wraps a server action: shows its message, field errors and pending state.
export function ActionForm({
  action,
  children,
  className,
  confirm,
  renderResult,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  // If set, the browser asks this question before submitting.
  confirm?: string;
  renderResult?: (state: FormState) => ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  return (
    <FormContext value={{ state, pending }}>
      <form
        action={formAction}
        className={className}
        noValidate
        onSubmit={(event) => {
          if (confirm && !window.confirm(confirm)) event.preventDefault();
        }}
      >
        {state.message ? (
          <div className="mb-4 w-full basis-full">
            <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
          </div>
        ) : null}
        {state.ok && renderResult ? <div className="mb-4 w-full basis-full">{renderResult(state)}</div> : null}
        {children}
      </form>
    </FormContext>
  );
}

export function Field({
  name,
  label,
  hint,
  className,
  defaultValue,
  ...input
}: { name: string; label: string; hint?: string } & Omit<ComponentProps<"input">, "name">) {
  const { state } = useContext(FormContext);
  const id = useId();
  const error = state.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const remembered = input.type === "password" ? undefined : state.values?.[name];
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-charcoal">
        {label}
      </label>
      <input
        id={id}
        name={name}
        key={remembered}
        defaultValue={input.value !== undefined ? undefined : (remembered ?? defaultValue)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block min-h-11 w-full rounded-lg border bg-white px-3 text-base text-charcoal placeholder:text-muted/70 ${
          error ? "border-danger" : "border-line"
        }`}
        {...input}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField({
  name,
  label,
  options,
  defaultValue,
  className,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  className?: string;
}) {
  const { state } = useContext(FormContext);
  const id = useId();
  const error = state.fieldErrors?.[name];
  const remembered = state.values?.[name];
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-charcoal">
        {label}
      </label>
      <select
        id={id}
        name={name}
        key={remembered}
        defaultValue={remembered ?? defaultValue}
        aria-invalid={error ? true : undefined}
        className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-base text-charcoal"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1.5 text-sm font-medium text-danger-ink">{error}</p> : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useContext(FormContext);
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, className)}>
      {pending ? pendingLabel : children}
    </button>
  );
}

function useField(name: string) {
  const { state } = useContext(FormContext);
  return { error: state.fieldErrors?.[name], remembered: state.values?.[name] };
}

function FieldMessages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  className,
  defaultValue,
  ...props
}: { name: string; label: string; hint?: string } & Omit<ComponentProps<"textarea">, "name">) {
  const id = useId();
  const { error, remembered } = useField(name);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-charcoal">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        key={remembered}
        defaultValue={remembered ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block min-h-32 w-full rounded-lg border bg-white px-3 py-2.5 text-base text-charcoal placeholder:text-muted/70 ${
          error ? "border-danger" : "border-line"
        }`}
        {...props}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

// Large, tappable choices. Works without JavaScript.
export function ChoiceGroup({
  name,
  legend,
  options,
  defaultValue,
  onChange,
  columns = 1,
}: {
  name: string;
  legend: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  defaultValue?: string;
  onChange?: (value: string) => void;
  columns?: 1 | 2;
}) {
  const id = useId();
  const { error, remembered } = useField(name);
  const selected = remembered ?? defaultValue;
  return (
    <fieldset aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-2 text-sm font-medium text-charcoal">{legend}</legend>
      <div key={remembered} className={`grid gap-2 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border border-line bg-white px-3 py-3 text-base has-[:checked]:border-forest has-[:checked]:bg-sage has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emerald"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={selected === o.value}
              onChange={() => onChange?.(o.value)}
              className="mt-1 h-4 w-4 shrink-0 accent-forest"
            />
            <span>
              <span className="block font-medium text-charcoal">{o.label}</span>
              {o.hint ? <span className="mt-0.5 block text-sm text-muted">{o.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <FieldMessages id={id} error={error} />
    </fieldset>
  );
}

export function CheckboxField({ name, label, required }: { name: string; label: React.ReactNode; required?: boolean }) {
  const id = useId();
  const { error } = useField(name);
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-charcoal">
        <input
          id={id}
          type="checkbox"
          name={name}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-forest"
        />
        <span>{label}</span>
      </label>
      <FieldMessages id={id} error={error} />
    </div>
  );
}
