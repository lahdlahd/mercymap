import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-redirect";

const NEXT_COOKIE = "mm_next";
const ALLOWED_TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "magiclink", "email_change"];

// Landing point for links in Supabase emails (confirm sign-up, reset password).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const cookieStore = await cookies();
  const next = safeNextPath(searchParams.get("next") ?? cookieStore.get(NEXT_COOKIE)?.value, "/app");
  const supabase = await createClient();

  let verified = false;
  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verified = !error;
  } else if (code) {
    // Used when the project's email templates still point at Supabase's default link.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }

  if (verified) {
    cookieStore.delete(NEXT_COOKIE);
    return NextResponse.redirect(new URL(next, request.url), 303);
  }
  return NextResponse.redirect(new URL("/sign-in?notice=link-invalid", request.url), 303);
}
