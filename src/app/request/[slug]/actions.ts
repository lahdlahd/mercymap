"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { runAnalysis } from "@/lib/ai/run";
import { clientIp, hashIp } from "@/lib/client-ip";
import { fieldErrors } from "@/lib/validation";
import type { FormState } from "@/lib/form-state";
import { intakeDbError, readRequestForm, redisplayValues, requestSchema } from "@/lib/intake";
import { serverConfig } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";

const UNAVAILABLE: FormState = {
  message: "Requests cannot be sent right now. Please try again later, or contact the church directly.",
};

// The church comes from the page's own link (bound on the server), never from
// a church id in the form. The database function resolves it again and checks
// the church is verified.
export async function submitPublicRequestAction(
  slug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = readRequestForm(formData);
  const values = redisplayValues(raw);

  // Hidden trap field: people never fill it in.
  if (String(formData.get("website") ?? "").length > 0) {
    return { message: "Your request could not be sent. Please try again.", values };
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const config = serverConfig();
  if (!config) return { ...UNAVAILABLE, values };

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  const check = await verifyTurnstile(formData.get("cf-turnstile-response")?.toString() ?? null, {
    secret: config.turnstileSecretKey,
    verifyUrl: config.turnstileVerifyUrl,
    remoteIp: ip === "unknown" ? undefined : ip,
  });
  if (!check.ok) {
    return {
      message:
        check.reason === "unreachable"
          ? "We could not complete the security check. Check your connection and try again."
          : "Please complete the security check, then send your request again.",
      values,
    };
  }

  const d = parsed.data;
  const admin = createAdminClient(config.supabaseSecretKey);
  const { data, error } = await admin.rpc("submit_public_request", {
    p_slug: slug,
    p_ip_hash: hashIp(ip, config.intakeHashSecret),
    p_category: d.category,
    p_text: d.description,
    p_quantity: d.quantity,
    p_name: d.name || null,
    p_contact_method: d.contactMethod,
    p_contact_value: d.contactValue || null,
    p_area: d.area || null,
  });
  if (error) {
    console.error("submit_public_request failed:", error.code ?? "unknown");
    const mapped = intakeDbError(error.message);
    return mapped.field
      ? { fieldErrors: { [mapped.field]: mapped.message }, values }
      : { message: mapped.message, values };
  }

  const row = (data as Array<{ reference: string }> | null)?.[0];
  if (!row) return { message: "Your request could not be sent. Please try again.", values };
  // AI suggestions for staff are prepared after the person has their answer.
  after(() => runAnalysis(row.reference).then(() => undefined));
  return { ok: true, data: { reference: row.reference, method: d.contactMethod } };
}
