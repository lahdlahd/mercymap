import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

// A client holding the Supabase secret key. It runs as the service_role and
// bypasses Row Level Security, so it is used for exactly two calls, both
// database functions that do their own checks: get_public_intake and
// submit_public_request. Never use it for anything a signed-in user does.
export function createAdminClient(secretKey: string) {
  const { url } = supabaseEnv();
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
