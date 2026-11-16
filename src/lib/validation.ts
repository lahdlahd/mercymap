import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

// Supabase hashes passwords with bcrypt, which only reads the first 72 bytes.
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(72, "Use 72 characters or fewer.")
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number.");

export const signUpSchema = z
  .object({ email: emailSchema, password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match.",
  });

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(72, "That password is too long."),
});

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords do not match.",
  });

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Turns "Grace Community Church!" into "grace-community-church".
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const churchSchema = z.object({
  name: z.string().trim().min(2, "Enter your church's name.").max(120, "Use 120 characters or fewer."),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters.")
    .max(60, "Use 60 characters or fewer.")
    .regex(SLUG_PATTERN, "Use lower-case letters, numbers and single hyphens only."),
  area: z.string().trim().max(120, "Use 120 characters or fewer.").optional().or(z.literal("")),
});

export const invitableRoles = ["admin", "coordinator"] as const;
export const staffRoles = ["owner", "admin", "coordinator"] as const;
export type StaffRole = (typeof staffRoles)[number];

export const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(invitableRoles, { message: "Choose a role." }),
});

export const uuidSchema = z.string().uuid();
export const roleSchema = z.enum(staffRoles);
export const churchStatusSchema = z.enum(["pending", "verified", "suspended"]);

export type FieldErrors = Record<string, string>;

// First message per field, in a shape that is easy to render.
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
