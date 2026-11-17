import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { siteUrl } from "@/lib/env";

export const INVITATION_DAYS = 7;

// 32 random bytes (256 bits). Only the SHA-256 hash is stored; the raw token
// exists in the invitation link alone. Must match private.hash_invitation_token.
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function invitationUrl(token: string): string {
  return `${siteUrl()}/invite/${token}`;
}

export function invitationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
}

// Tokens are base64url of 32 bytes: exactly 43 characters.
export function looksLikeInvitationToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isPast(iso: string, now = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}
