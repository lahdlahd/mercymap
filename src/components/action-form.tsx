"use client";

import { createContext, useActionState, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { Alert, buttonClass, type ButtonVariant } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/form-state";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const FormContext = createContext<{ state: FormState; pending: boolean }>({ state: emptyFormState, pending: false });

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
          <div className="mb-4">
            <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
          </div>
        ) : null}
        {state.ok && renderResult ? <div className="mb-4">{renderResult(state)}</div> : null}
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
