import { describe, expect, test } from "vitest";
import { friendlyAuthError, friendlyDbError } from "@/lib/errors";
import {
  generateInvitationToken, hashInvitationToken, invitationExpiry, invitationUrl, isPast, looksLikeInvitationToken,
} from "@/lib/invitations";
import { safeNextPath } from "@/lib/safe-redirect";
import {
  churchSchema, emailSchema, fieldErrors, inviteSchema, newPasswordSchema, roleSchema, signUpSchema, slugify, SLUG_PATTERN,
} from "@/lib/validation";

describe("safeNextPath", () => {
  test("keeps internal paths, with their query string", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/invite/abc?x=1")).toBe("/invite/abc?x=1");
  });
  test.each([
    ["absolute URL", "https://evil.example/app"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["second backslash trick", "\\\\evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["no leading slash", "app"],
    ["control character", "/app\nSet-Cookie: x=1"],
    ["empty", ""],
    ["not a string", 42],
    ["null", null],
    ["oversized", "/" + "a".repeat(600)],
  ])("rejects %s", (_name, value) => {
    expect(safeNextPath(value)).toBe("/app");
    expect(safeNextPath(value, "")).toBe("");
  });
  test("drops fragments and never leaves the site", () => {
    expect(safeNextPath("/app#//evil.example")).toBe("/app");
    expect(safeNextPath("/@evil.example")).toBe("/@evil.example");
  });
});

describe("email and password rules", () => {
  test("email is trimmed and lower-cased", () => {
    expect(emailSchema.parse("  Pastor@Grace.Test ")).toBe("pastor@grace.test");
  });
  test.each(["", "nope", "a@", "@b.test", "a b@c.test"])("rejects email %j", (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
  test("password needs 10+ characters, a letter and a number", () => {
    const base = { email: "a@b.test" };
    const ok = signUpSchema.safeParse({ ...base, password: "harvest2026x", confirmPassword: "harvest2026x" });
    expect(ok.success).toBe(true);
    for (const password of ["short1a", "onlyletterslong", "12345678901", "a1".repeat(40)]) {
      expect(signUpSchema.safeParse({ ...base, password, confirmPassword: password }).success).toBe(false);
    }
  });
  test("mismatched confirmation is reported on the confirmation field", () => {
    const result = newPasswordSchema.safeParse({ password: "harvest2026x", confirmPassword: "harvest2026y" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error)).toHaveProperty("confirmPassword");
  });
});

describe("church details", () => {
  test.each([
    ["Grace Community Church", "grace-community-church"],
    ["  St. Mary's (Akure)!  ", "st-mary-s-akure"],
    ["Église Évangélique", "eglise-evangelique"],
    ["---", ""],
    ["A".repeat(100), "a".repeat(60)],
  ])("slugify(%j) -> %j", (input, expected) => {
    const slug = slugify(input);
    expect(slug).toBe(expected);
    if (slug) expect(SLUG_PATTERN.test(slug)).toBe(true);
  });
  test("slug never ends with a hyphen after truncation", () => {
    expect(slugify("a".repeat(59) + " b c")).not.toMatch(/-$/);
  });
  test("accepts a valid church and normalises the slug", () => {
    const parsed = churchSchema.parse({ name: " Grace Community ", slug: "Grace-Community", area: "" });
    expect(parsed).toEqual({ name: "Grace Community", slug: "grace-community", area: "" });
  });
  test.each(["ab", "has space", "double--hyphen", "-leading", "trailing-", "UPPER_snake", "x".repeat(61)])(
    "rejects slug %j", (slug) => {
      expect(churchSchema.safeParse({ name: "Grace", slug }).success).toBe(false);
    });
  test("rejects a blank name", () => {
    expect(churchSchema.safeParse({ name: " ", slug: "grace" }).success).toBe(false);
  });
});

describe("roles", () => {
  test("nobody can be invited as owner", () => {
    expect(inviteSchema.safeParse({ email: "a@b.test", role: "owner" }).success).toBe(false);
    expect(inviteSchema.safeParse({ email: "a@b.test", role: "admin" }).success).toBe(true);
    expect(inviteSchema.safeParse({ email: "a@b.test", role: "superuser" }).success).toBe(false);
  });
  test("role changes accept only the three staff roles", () => {
    expect(roleSchema.safeParse("owner").success).toBe(true);
    expect(roleSchema.safeParse("platform_admin").success).toBe(false);
  });
});

describe("invitation tokens", () => {
  test("tokens are 43 URL-safe characters, unique, and stored only as a SHA-256 hash", () => {
    const a = generateInvitationToken();
    const b = generateInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).toBe(hashInvitationToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });
  test("hash matches the known SHA-256 value the database also computes", () => {
    expect(hashInvitationToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  test("token shape check", () => {
    expect(looksLikeInvitationToken(generateInvitationToken().token)).toBe(true);
    for (const bad of ["", "short", "a".repeat(44), "../../etc/passwd", "a".repeat(42) + "/"]) {
      expect(looksLikeInvitationToken(bad)).toBe(false);
    }
  });
  test("links and expiry", () => {
    expect(invitationUrl("tok")).toBe("http://localhost:3000/invite/tok");
    const now = new Date("2026-11-16T00:00:00Z");
    expect(invitationExpiry(now).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(isPast("2026-11-15T00:00:00Z", now)).toBe(true);
    expect(isPast("2026-11-17T00:00:00Z", now)).toBe(false);
  });
});

describe("error messages", () => {
  test("database errors map to plain language", () => {
    expect(friendlyDbError("pending_church_exists")).toMatch(/awaiting verification/);
    expect(friendlyDbError('duplicate key value violates unique constraint "churches_slug_key"')).toMatch(/already taken/);
    expect(friendlyDbError("last_owner_required")).toMatch(/at least one owner/);
    expect(friendlyDbError('new row violates row-level security policy for table "invitations"')).toMatch(/permission/);
  });
  test("unknown errors never leak internals", () => {
    const message = friendlyDbError('relation "public.secret_table" does not exist');
    expect(message).toBe("Something went wrong. Please try again.");
    expect(friendlyDbError(null)).toBe("Something went wrong. Please try again.");
  });
  test("auth errors", () => {
    expect(friendlyAuthError("invalid_credentials", "Invalid login credentials")).toMatch(/do not match/);
    expect(friendlyAuthError("email_not_confirmed", "")).toMatch(/Confirm your email/);
    expect(friendlyAuthError("over_email_send_rate_limit", "")).toMatch(/Too many attempts/);
    expect(friendlyAuthError(undefined, undefined)).toBe("Something went wrong. Please try again.");
    expect(friendlyAuthError("AuthRetryableFetchError", "fetch failed")).toMatch(/could not reach the account service/);
  });
});
