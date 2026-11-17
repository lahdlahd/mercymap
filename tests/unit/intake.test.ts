import { afterEach, describe, expect, test, vi } from "vitest";
import { clientIp, hashIp } from "@/lib/client-ip";
import { intakeDbError, isValidPhone, readRequestForm, redisplayValues, requestSchema } from "@/lib/intake";
import { serverConfig } from "@/lib/server-env";
import { verifyTurnstile } from "@/lib/turnstile";

const valid = {
  category: "food",
  description: "We have run out of food this week.",
  quantity: "3",
  name: "",
  contactMethod: "phone_call",
  contactValue: "0803 123 4567",
  area: "",
  consent: "on",
};

describe("phone numbers", () => {
  test.each(["0803 123 4567", "+234 803 123 4567", "08031234567", "(0803) 123-4567", "+1 555 010 9999"])("accepts %s", (v) =>
    expect(isValidPhone(v)).toBe(true));
  test.each(["", "12345", "call me", "+", "0803-abc-4567", "1".repeat(16), "+234 803 123 4567 ext 9"])("rejects %j", (v) =>
    expect(isValidPhone(v)).toBe(false));
});

describe("request form validation", () => {
  test("a complete request passes and the quantity becomes a number", () => {
    const parsed = requestSchema.parse(valid);
    expect(parsed.quantity).toBe(3);
    expect(parsed.description).toBe("We have run out of food this week.");
  });
  test("consent must be ticked", () => {
    const r = requestSchema.safeParse({ ...valid, consent: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["consent"]);
  });
  test("a phone number is required only for call or SMS", () => {
    expect(requestSchema.safeParse({ ...valid, contactValue: "" }).success).toBe(false);
    expect(requestSchema.safeParse({ ...valid, contactMethod: "sms", contactValue: "nope" }).success).toBe(false);
    expect(requestSchema.safeParse({ ...valid, contactMethod: "none", contactValue: "" }).success).toBe(true);
    expect(requestSchema.safeParse({ ...valid, contactMethod: "in_person", contactValue: "" }).success).toBe(true);
  });
  test.each([
    ["category", ""],
    ["description", "short"],
    ["description", "x".repeat(5001)],
    ["quantity", "0"],
    ["quantity", "1.5"],
    ["quantity", "abc"],
    ["quantity", "5000"],
    ["contactMethod", "pigeon"],
    ["name", "n".repeat(121)],
    ["area", "a".repeat(121)],
  ])("rejects %s = %j", (field, value) => {
    const r = requestSchema.safeParse({ ...valid, [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe(field);
  });
  test("reading the form defaults the quantity and never carries consent forward", () => {
    const fd = new FormData();
    fd.set("description", "Help please, we need food.");
    fd.set("consent", "on");
    const raw = readRequestForm(fd);
    expect(raw.quantity).toBe("1");
    expect(redisplayValues(raw)).not.toHaveProperty("consent");
  });
});

describe("database error messages", () => {
  test.each([
    ["intake_unavailable", undefined, /not accepting requests/],
    ["rate_limited", undefined, /Too many requests/],
    ["church_daily_limit", undefined, /very large number/],
    ["invalid_phone", "contactValue", /valid phone number/],
    ["invalid_description", "description", /a little more/],
    ["invalid_category", "category", /kind of help/],
    ['relation "secret" does not exist', undefined, /could not be sent/],
  ])("%s", (message, field, pattern) => {
    const mapped = intakeDbError(message);
    expect(mapped.field).toBe(field);
    expect(mapped.message).toMatch(pattern);
  });
});

describe("client address", () => {
  test("uses the first forwarded address, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "102.89.1.2, 10.0.0.1" }))).toBe("102.89.1.2");
    expect(clientIp(new Headers({ "x-real-ip": "41.58.0.9" }))).toBe("41.58.0.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
  test("only a keyed hash is produced, and it depends on the secret", () => {
    const a = hashIp("102.89.1.2", "secret-one-123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("102.89");
    expect(hashIp("102.89.1.2", "secret-one-123456")).toBe(a);
    expect(hashIp("102.89.1.2", "secret-two-123456")).not.toBe(a);
  });
});

describe("Turnstile verification", () => {
  const opts = (impl: typeof fetch) => ({ secret: "s", verifyUrl: "https://verify.test", remoteIp: "1.2.3.4", fetchImpl: impl });
  const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

  test("passes when Cloudflare says success and sends secret, token and address", async () => {
    const impl = reply({ success: true });
    expect(await verifyTurnstile("tok", opts(impl))).toEqual({ ok: true });
    const [url, init] = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://verify.test");
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.get("secret")).toBe("s");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });
  test("fails on rejection, a missing or oversized token, and network errors", async () => {
    expect(await verifyTurnstile("tok", opts(reply({ success: false, "error-codes": ["timeout-or-duplicate"] })))).toEqual({ ok: false, reason: "rejected" });
    expect(await verifyTurnstile(null, opts(reply({ success: true })))).toEqual({ ok: false, reason: "missing" });
    expect(await verifyTurnstile("x".repeat(2049), opts(reply({ success: true })))).toEqual({ ok: false, reason: "missing" });
    const broken = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", opts(broken))).toEqual({ ok: false, reason: "unreachable" });
    expect(await verifyTurnstile("tok", opts(reply({})))).toEqual({ ok: false, reason: "rejected" });
  });
});

describe("server configuration", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("fails closed when a secret is missing or the hash secret is too short", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    vi.stubEnv("INTAKE_HASH_SECRET", "short");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "t");
    expect(serverConfig()).toBeNull();
    vi.stubEnv("INTAKE_HASH_SECRET", "long-enough-secret-value");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(serverConfig()).toBeNull();
  });
  test("defaults the verification address to Cloudflare", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_x");
    vi.stubEnv("INTAKE_HASH_SECRET", "long-enough-secret-value");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "t");
    vi.stubEnv("TURNSTILE_VERIFY_URL", "");
    expect(serverConfig()?.turnstileVerifyUrl).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
  });
});
