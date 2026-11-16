"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/env";
import { friendlyAuthError } from "@/lib/errors";
import type { FormState } from "@/lib/form-state";
import { safeNextPath } from "@/lib/safe-redirect";
import { emailSchema, fieldErrors, newPasswordSchema, signInSchema, signUpSchema } from "@/lib/validation";
import { getCurrentUser } from "@/lib/auth";

const NEXT_COOKIE = "mm_next";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signUpAction(_state: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const parsed = signUpSchema.safeParse({
    email,
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { email } };

  const next = safeNextPath(text(formData, "next"), "");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
  });
  if (error) {
    console.error("sign-up failed:", error.code ?? error.name);
    return { message: friendlyAuthError(error.code ?? error.name, error.message), values: { email } };
  }

  // Remember where the person was heading (an invitation, say) so the
  // confirmation link can take them back there.
  if (next) {
    (await cookies()).set(NEXT_COOKIE, next, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60,
      path: "/",
    });
  }

  // If the project does not require email confirmation a session exists already.
  if (data.session) redirect(next || "/app");
  redirect(`/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}

export async function signInAction(_state: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const parsed = signInSchema.safeParse({ email, password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    console.error("sign-in failed:", error.code ?? error.name);
    return { message: friendlyAuthError(error.code ?? error.name, error.message), values: { email } };
  }
  redirect(safeNextPath(text(formData, "next")));
}

// Always answers the same way so the form cannot be used to discover which
// email addresses have accounts.
export async function resendConfirmationAction(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(text(formData, "email"));
  if (parsed.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: parsed.data,
      options: { emailRedirectTo: `${siteUrl()}/auth/confirm` },
    });
    if (error) {
      console.error("resend confirmation failed:", error.code ?? error.name);
      if (/rate/i.test(`${error.code} ${error.message}`)) {
        return { message: "Please wait a minute before asking for another email." };
      }
    }
  }
  return { ok: true, message: "If that address is waiting to be confirmed, a new email is on its way." };
}

export async function requestPasswordResetAction(_state: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0].message }, values: { email } };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${siteUrl()}/auth/confirm?next=/update-password`,
  });
  if (error) {
    console.error("password reset request failed:", error.code ?? error.name);
    if (/rate/i.test(`${error.code} ${error.message}`)) {
      return { message: "Please wait a minute before asking for another email.", values: { email } };
    }
  }
  return { ok: true, message: "If an account exists for that address, a reset link is on its way." };
}

export async function updatePasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/update-password");

  const parsed = newPasswordSchema.safeParse({
    password: text(formData, "password"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("password update failed:", error.code ?? error.name);
    return { message: friendlyAuthError(error.code ?? error.name, error.message) };
  }
  redirect("/app");
}
