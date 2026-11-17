import { z } from "zod";

export const CONTACT_METHODS = ["phone_call", "sms", "in_person", "none"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 5000;

// Digits, spaces, brackets and hyphens, optionally starting with +; 7 to 15
// digits in total. Mirrors the check in the database.
export function isValidPhone(value: string): boolean {
  if (!/^\+?[0-9(][0-9 ()-]{5,24}$/.test(value)) return false;
  const digits = value.replace(/[^0-9]/g, "").length;
  return digits >= 7 && digits <= 15;
}

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().or(z.literal(""));

const baseRequestSchema = z.object({
  category: z.string().trim().min(1, "Choose the kind of help you need.").max(40),
  description: z
    .string()
    .trim()
    .min(DESCRIPTION_MIN, `Tell us a little more (at least ${DESCRIPTION_MIN} characters).`)
    .max(DESCRIPTION_MAX, `Please keep this under ${DESCRIPTION_MAX} characters.`),
  quantity: z.coerce
    .number({ message: "Enter a number." })
    .int("Enter a whole number.")
    .min(1, "Enter at least 1.")
    .max(1000, "Enter 1000 or fewer."),
  name: optionalText(120, "Name"),
  contactMethod: z.enum(CONTACT_METHODS, { message: "Choose how the church can reach you." }),
  contactValue: z.string().trim().max(40).optional().or(z.literal("")),
  area: optionalText(120, "Area"),
  consent: z.literal("on", { message: "Please tick this box so the church can use your request." }),
});

// The phone check is a separate pass over the raw input so that its message
// appears together with every other problem, not only once the rest is valid.
function phoneIssue(raw: { contactMethod?: unknown; contactValue?: unknown }): string | null {
  if (raw.contactMethod !== "phone_call" && raw.contactMethod !== "sms") return null;
  const value = typeof raw.contactValue === "string" ? raw.contactValue.trim() : "";
  if (!value) return "Enter a phone number, or choose another option.";
  if (!isValidPhone(value)) return "Enter a valid phone number, for example 0803 123 4567.";
  return null;
}

export const requestSchema = {
  safeParse(raw: Record<string, unknown>) {
    const result = baseRequestSchema.safeParse(raw);
    const phone = phoneIssue(raw);
    if (!phone) return result;
    const issue = { code: "custom" as const, path: ["contactValue"], message: phone, input: raw.contactValue };
    const error = result.success ? new z.ZodError([issue]) : new z.ZodError([...result.error.issues, issue]);
    return { success: false as const, error };
  },
  parse(raw: Record<string, unknown>) {
    const result = this.safeParse(raw);
    if (!result.success) throw result.error;
    return result.data;
  },
};

export type RequestInput = z.infer<typeof baseRequestSchema>;

export function readRequestForm(formData: FormData) {
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    category: get("category"),
    description: get("description"),
    quantity: get("quantity") || "1",
    name: get("name"),
    contactMethod: get("contactMethod"),
    contactValue: get("contactValue"),
    area: get("area"),
    consent: get("consent"),
  };
}

// Database errors from the intake functions, as field errors where possible.
export function intakeDbError(message: string | undefined): { field?: string; message: string } {
  const text = message ?? "";
  if (/intake_unavailable/.test(text)) return { message: "This church is not accepting requests through MERCYMAP right now. Please contact the church directly." };
  if (/rate_limited/.test(text)) return { message: "Too many requests have been sent from this connection. Please try again in an hour, or contact the church directly." };
  if (/church_daily_limit/.test(text)) return { message: "This church has received a very large number of requests today. Please try again tomorrow, or contact the church directly." };
  if (/church_suspended/.test(text)) return { message: "This workspace is suspended, so requests cannot be recorded." };
  if (/invalid_category/.test(text)) return { field: "category", message: "Choose the kind of help you need." };
  if (/invalid_description/.test(text)) return { field: "description", message: `Tell us a little more (at least ${DESCRIPTION_MIN} characters).` };
  if (/invalid_quantity/.test(text)) return { field: "quantity", message: "Enter a number from 1 to 1000." };
  if (/invalid_phone/.test(text)) return { field: "contactValue", message: "Enter a valid phone number, for example 0803 123 4567." };
  if (/invalid_contact_method/.test(text)) return { field: "contactMethod", message: "Choose how the church can reach you." };
  if (/forbidden|permission denied|row-level security/.test(text)) return { message: "You do not have permission to do that." };
  return { message: "Your request could not be sent. Please try again." };
}

// Values to put back into the form after a failed submit. Consent is never
// carried over: the person ticks it again.
export function redisplayValues(raw: ReturnType<typeof readRequestForm>): Record<string, string> {
  return {
    category: raw.category,
    description: raw.description,
    quantity: raw.quantity,
    name: raw.name,
    contactMethod: raw.contactMethod,
    contactValue: raw.contactValue,
    area: raw.area,
  };
}
