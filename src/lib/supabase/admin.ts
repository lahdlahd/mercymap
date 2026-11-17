import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

// A client holding the Supabase secret key. It runs as the service_role and
// bypasses Row Level Security, so it is used only for database functions
// granted to the service role that do their own checks: get_public_intake,
// submit_public_request, ai_claim and ai_save. Signed-in staff actions use
// the user's own session; the AI runner is started only after the database
// has confirmed the user may ask (ai_request_rerun) or after a submission.
export function createAdminClient(secretKey: string) {
  const { url } = supabaseEnv();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
