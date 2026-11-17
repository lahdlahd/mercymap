import "server-only";

export type TurnstileResult = { ok: true } | { ok: false; reason: "missing" | "rejected" | "unreachable" };

// Server-side check of a Cloudflare Turnstile token. Tokens are single-use and
// expire after five minutes, so every submission needs a fresh one.
export async function verifyTurnstile(
  token: string | null,
  opts: { secret: string; verifyUrl: string; remoteIp?: string; fetchImpl?: typeof fetch },
): Promise<TurnstileResult> {
  if (!token || token.length > 2048) return { ok: false, reason: "missing" };
  const body = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.remoteIp) body.set("remoteip", opts.remoteIp);
  try {
    const response = await (opts.fetchImpl ?? fetch)(opts.verifyUrl, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return { ok: true };
    console.error("turnstile rejected:", (data["error-codes"] ?? []).join(",") || "no code");
    return { ok: false, reason: "rejected" };
  } catch (error) {
    console.error("turnstile unreachable:", (error as Error).name);
    return { ok: false, reason: "unreachable" };
  }
}
