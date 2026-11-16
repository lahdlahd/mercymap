export type FormState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  // Non-secret values to put back into the form after a failed submit.
  values?: Record<string, string>;
  // Extra data for the page to show after success (for example an invitation link).
  data?: Record<string, string>;
};

export const emptyFormState: FormState = {};
