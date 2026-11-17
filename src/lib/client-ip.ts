import "server-only";
import { createHmac } from "node:crypto";

// The caller's address as reported by the hosting platform. On Vercel the
// first x-forwarded-for entry is set by Vercel itself.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

// Only a keyed hash of the address is stored, for rate limiting.
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}
