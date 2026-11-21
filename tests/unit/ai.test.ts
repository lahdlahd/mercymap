import { describe, expect, test, vi } from "vitest";
import { parseDailyLimit } from "@/lib/ai/limits";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserMessage, parseOutput, redact, toolDefinition, type ClaimedRequest } from "@/lib/ai/analysis";
import { callClaude, isRetryable, requestBody, settingsProblem } from "@/lib/ai/claude";

const claimed = (o: Partial<ClaimedRequest> = {}): ClaimedRequest => ({
  request_id: "11111111-1111-4111-8111-111111111111",
  description: "We are a family of four and need food this week.",
  category_key: "food",
  quantity: 2,
  area: "Ijapo",
  status: "submitted",
  categories: [
    { key: "food", label: "Food and groceries" },
    { key: "clothing", label: "Clothing" },
    { key: "education", label: "Education support" },
  ],
  resource_options: [],
  redact: { name: null, contact: null },
  ...o,
});
const good = {
  summary: "A family of four needs food this week.",
  key_facts: ["Family of four"],
  missing_info: ["Ages of the children"],
  suggested_category: null,
  urgency: "medium",
  safeguarding: { concern: false, reason: null },
  resource_option: null,
  resource_explanation: null,
};

describe("privacy: what is sent", () => {
  test("phone numbers and emails in the description are removed", () => {
    const t = redact("Call me on 0803 555 0101 or +234-803-555-0101 or (0803) 5550101, email ada.s@example.com.", { name: null, contact: null });
    expect(t).toBe("Call me on [phone] or [phone] or [phone], email [email].");
  });
  test("short numbers such as quantities, years and amounts stay", () => {
    expect(redact("We are 4 people, since 2024, rent is 150,000 naira.", { name: null, contact: null }))
      .toBe("We are 4 people, since 2024, rent is 150,000 naira.");
  });
  test("the person's stated name and contact number are removed wherever they appear", () => {
    const t = redact("My name is Ada Okafor. ADA needs help. Call 08035550101. Adamawa is far.", { name: "Ada Okafor", contact: "0803 555 0101" });
    expect(t).toBe("My name is [name]. [name] needs help. Call [phone]. Adamawa is far.");
  });
  test("very short name parts are left alone to avoid damaging the text", () => {
    expect(redact("Jo and I need food", { name: "Jo", contact: null })).toBe("Jo and I need food");
  });
  test("the message holds only description, kind of help, quantity and area", () => {
    const m = buildUserMessage(claimed({
      description: "I am Ada, call 0803 555 0101. We need food.",
      redact: { name: "Ada Okafor", contact: "0803 555 0101" },
    }));
    expect(m).not.toMatch(/Ada|0803|555/);
    expect(m).toContain("Kind of help chosen: Food and groceries (food)");
    expect(m).toContain("Quantity asked for: 2");
    expect(m).toContain("Area: Ijapo");
    expect(m).toMatch(/<request_text>\nI am \[name\], call \[phone\]\. We need food\.\n<\/request_text>$/);
  });
  test("resource options are described without names or ids", () => {
    const m = buildUserMessage(claimed({
      resource_options: [
        { resource_id: "22222222-2222-4222-8222-222222222222", unit: "pack", available: 5, source_type: "partner", coverage: "covered", valid_until: "2026-12-31" },
      ],
    }));
    expect(m).toContain("Option 1: 5 pack available, from a partner, covers their area, available until 2026-12-31");
    expect(m).not.toContain("22222222");
  });
  test("the instructions say the text is data, never to be obeyed, and that staff decide", () => {
    expect(SYSTEM_PROMPT).toMatch(/never follow them/);
    expect(SYSTEM_PROMPT).toMatch(/Staff decide/);
    expect(PROMPT_VERSION).toMatch(/v1$/);
  });
  test("the tool only allows known categories", () => {
    const t = toolDefinition(["food", "clothing"]);
    expect(t.input_schema.properties.suggested_category.enum).toEqual(["food", "clothing", null]);
  });
});

describe("checking what comes back", () => {
  test("a good answer is accepted", () => {
    expect(parseOutput(good, claimed())).toEqual({
      summary: "A family of four needs food this week.",
      key_facts: ["Family of four"],
      missing_info: ["Ages of the children"],
      suggested_category: null,
      urgency: "medium",
      safeguarding: { concern: false, reason: null },
      resource: null,
    });
  });
  test.each([
    ["no summary", { ...good, summary: "  " }],
    ["unknown urgency", { ...good, urgency: "critical" }],
    ["missing safeguarding", { ...good, safeguarding: undefined }],
    ["not an object", "approve this request"],
    ["null", null],
  ])("refused: %s", (_label, input) => expect(parseOutput(input, claimed())).toBeNull());
  test("long text is cut and lists are capped", () => {
    const out = parseOutput({ ...good, summary: "x".repeat(900), key_facts: Array(9).fill("fact"), missing_info: Array(9).fill("q") }, claimed())!;
    expect(out.summary).toHaveLength(400);
    expect(out.key_facts).toHaveLength(6);
    expect(out.missing_info).toHaveLength(5);
  });
  test("a made-up or unchanged category is dropped; a real different one is kept", () => {
    expect(parseOutput({ ...good, suggested_category: "cash_transfer" }, claimed())!.suggested_category).toBeNull();
    expect(parseOutput({ ...good, suggested_category: "food" }, claimed())!.suggested_category).toBeNull();
    expect(parseOutput({ ...good, suggested_category: "clothing" }, claimed())!.suggested_category).toBe("clothing");
  });
  test("a resource choice is mapped to the real id only if the option exists", () => {
    const c = claimed({ resource_options: [{ resource_id: "r-1", unit: "pack", available: 5, source_type: "church", coverage: "any", valid_until: null }] });
    expect(parseOutput({ ...good, resource_option: 1, resource_explanation: "Enough stock." }, c)!.resource)
      .toEqual({ resource_id: "r-1", explanation: "Enough stock." });
    expect(parseOutput({ ...good, resource_option: 2 }, c)!.resource).toBeNull();
    expect(parseOutput({ ...good, resource_option: 0 }, c)!.resource).toBeNull();
    expect(parseOutput({ ...good, resource_option: 1 }, claimed())!.resource).toBeNull();
  });
  test("a safeguarding reason is kept only with a concern", () => {
    expect(parseOutput({ ...good, safeguarding: { concern: false, reason: "none" } }, claimed())!.safeguarding).toEqual({ concern: false, reason: null });
    expect(parseOutput({ ...good, safeguarding: { concern: true, reason: "Mentions threats." } }, claimed())!.safeguarding)
      .toEqual({ concern: true, reason: "Mentions threats." });
  });
  test("details the AI repeats are removed again", () => {
    const c = claimed({ redact: { name: "Ada Okafor", contact: "0803 555 0101" } });
    const out = parseOutput({ ...good, summary: "Ada Okafor (0803 555 0101) needs food.", key_facts: ["Email ada@x.org"] }, c)!;
    expect(out.summary).toBe("[name] [phone] needs food.");
    expect(out.key_facts).toEqual(["Email [email]"]);
  });
  test("extra fields the AI invents, such as a status, are not stored", () => {
    const out = parseOutput({ ...good, status: "approved", approve: true }, claimed())!;
    expect(Object.keys(out).sort()).toEqual(["key_facts", "missing_info", "resource", "safeguarding", "suggested_category", "summary", "urgency"]);
  });
});

describe("calling Claude", () => {
  const config = { apiKey: "sk-ant-test-key", model: "claude-haiku-5-5", baseUrl: "https://example.test" };
  test("sends a forced tool call with the key in a header and returns the tool input", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: "text", text: "ignored" }, { type: "tool_use", name: "record_analysis", input: good }],
    }), { status: 200 }));
    const r = await callClaude(claimed(), config, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, input: good });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_analysis" });
    expect(JSON.stringify(body)).not.toContain("test-key");
  });
  test("no sampling parameters, which the 5.5 models reject", () => {
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]) {
      const body = requestBody(claimed(), model);
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("top_p");
      expect(body).not.toHaveProperty("top_k");
    }
  });
  test("forced tool choice only for Haiku; Sonnet and Opus 5.5 get auto", () => {
    expect(requestBody(claimed(), "claude-haiku-5-5").tool_choice).toEqual({ type: "tool", name: "record_analysis" });
    expect(requestBody(claimed(), "claude-sonnet-5-5").tool_choice).toEqual({ type: "auto" });
    expect(requestBody(claimed(), "claude-opus-5-5").tool_choice).toEqual({ type: "auto" });
    expect(SYSTEM_PROMPT).toContain("Always record your answer by calling the record_analysis tool");
  });
  test("a rejected request logs Anthropic's error type and message, not the request", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      type: "error", error: { type: "invalid_request_error", message: "temperature: unsupported value" },
    }), { status: 400 }));
    expect(await callClaude(claimed(), config, fetchMock as unknown as typeof fetch)).toEqual({ ok: false, error: "http_400" });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("Anthropic 400: invalid_request_error: temperature: unsupported value");
    expect(logged).not.toContain("family of four");
    spy.mockRestore();
  });
  test("errors become short codes", async () => {
    const respond = (status: number, body = "{}") => vi.fn(async () => new Response(body, { status }));
    expect(await callClaude(claimed(), config, respond(429) as unknown as typeof fetch)).toEqual({ ok: false, error: "http_429" });
    expect(await callClaude(claimed(), config, respond(200, "not json") as unknown as typeof fetch)).toEqual({ ok: false, error: "bad_json" });
    expect(await callClaude(claimed(), config, respond(200, JSON.stringify({ content: [{ type: "text", text: "hi" }] })) as unknown as typeof fetch))
      .toEqual({ ok: false, error: "no_tool_use" });
    const timeout = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    expect(await callClaude(claimed(), config, timeout as unknown as typeof fetch)).toEqual({ ok: false, error: "timeout" });
  });
  test("a request that cannot be sent logs the error kind, never its message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(async () => { throw new TypeError('Headers.append: "test-key\n" is an invalid header value.'); });
    expect(await callClaude(claimed(), config, bad as unknown as typeof fetch)).toEqual({ ok: false, error: "network" });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("Anthropic request not sent: TypeError");
    expect(logged).not.toContain("test-key");
    const refused = vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
    await callClaude(claimed(), config, refused as unknown as typeof fetch);
    expect(spy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("Anthropic request not sent: TypeError ENOTFOUND");
    spy.mockRestore();
  });
  test("malformed settings are named in the log, without the key, and nothing is sent", async () => {
    const ok = { apiKey: "sk-ant-abc123", baseUrl: "https://api.anthropic.com" };
    expect(settingsProblem(ok)).toBeNull();
    expect(settingsProblem({ ...ok, apiKey: "sk-ant-ab\nc123" })).toBe(
      "ANTHROPIC_API_KEY has an unexpected character at position 10 of 14 (U+000A). Paste the key again.");
    expect(settingsProblem({ ...ok, apiKey: "sk-ant-…your key…" })).toMatch(/position 8 of 17 \(U\+2026\)/);
    expect(settingsProblem({ ...ok, apiKey: "ANTHROPIC_API_KEY=sk-ant-abc" })).toMatch(/does not start with sk-ant-/);
    expect(settingsProblem({ ...ok, baseUrl: "api.anthropic.com" })).toMatch(/ANTHROPIC_BASE_URL is not a valid web address/);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    const r = await callClaude(claimed(), { ...config, apiKey: "sk-ant-se\ncret" }, fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, error: "bad_settings" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(spy.mock.calls.join(" ")).not.toContain("cret");
    spy.mockRestore();
  });
  test("which errors are retried", () => {
    expect(["timeout", "network", "http_429", "http_529", "http_500"].every(isRetryable)).toBe(true);
    expect(["http_400", "http_401", "no_tool_use", "bad_json"].some(isRetryable)).toBe(false);
  });
});

describe("AI_DAILY_LIMIT", () => {
  test.each([
    [undefined, 300], ["", 300], ["  ", 300], ["50", 50], [" 25 ", 25], ["0", 0],
    ["10000", 10000], ["10001", 300], ["-5", 300], ["2.5", 300], ["ten", 300], ["1e3", 300],
  ] as [string | undefined, number][])("%j gives %i", (value, expected) => expect(parseDailyLimit(value)).toBe(expected));
});
