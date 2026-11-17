import { describe, expect, test } from "vitest";
import { COVERAGE_LABEL, MISMATCH_LABEL, parseAreas, resourceDbError, resourceSchema, resourceState } from "@/lib/resources";

const valid = {
  name: "Food package", category: "food", description: "", unit: "package", total: "5",
  sourceType: "church", sourceName: "", areas: "", validFrom: "", validUntil: "", manager: "",
};
const errors = (v: Record<string, string>) => {
  const r = resourceSchema.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("resource form", () => {
  test("a complete church resource is accepted", () => {
    const r = resourceSchema.safeParse(valid);
    expect(r.success && r.data.total).toBe(5);
  });
  test("an empty quantity is an error, not zero", () => {
    expect(errors({ ...valid, total: "" }).total).toMatch(/Enter a number/);
    expect(errors({ ...valid, total: "  " }).total).toMatch(/Enter a number/);
    expect(resourceSchema.safeParse({ ...valid, total: "0" }).success).toBe(true);
  });
  test.each([["-1", /0 or more/], ["2.5", /whole number/], ["1000001", /1,000,000/], ["ten", /Enter a number/]])(
    "quantity %s is refused", (total, pattern) => expect(errors({ ...valid, total }).total).toMatch(pattern));
  test("a partner resource needs the partner's name", () => {
    expect(errors({ ...valid, sourceType: "partner" }).sourceName).toMatch(/Name the partner/);
    expect(resourceSchema.safeParse({ ...valid, sourceType: "partner", sourceName: "Hope Foods" }).success).toBe(true);
  });
  test("end date cannot be before start date; the same day is fine", () => {
    expect(errors({ ...valid, validFrom: "2026-12-10", validUntil: "2026-12-01" }).validUntil).toMatch(/before the start/);
    expect(resourceSchema.safeParse({ ...valid, validFrom: "2026-12-10", validUntil: "2026-12-10" }).success).toBe(true);
  });
  test("at most 20 areas", () => {
    const many = Array.from({ length: 21 }, (_, i) => `Area ${i}`).join(", ");
    expect(errors({ ...valid, areas: many }).areas).toMatch(/20 areas/);
  });
  test("name, kind and unit are required", () => {
    const e = errors({ ...valid, name: "", category: "", unit: "" });
    expect(e.name && e.category && e.unit).toBeTruthy();
  });
  test("manager must be an id or empty", () => {
    expect(errors({ ...valid, manager: "someone" }).manager).toBeTruthy();
  });
});

describe("areas", () => {
  test("split on commas and new lines, blanks dropped", () => {
    expect(parseAreas("Ijapo, Oke-Aro\n\nAlagbaka ,")).toEqual(["Ijapo", "Oke-Aro", "Alagbaka"]);
    expect(parseAreas("")).toEqual([]);
  });
});

describe("labels and states", () => {
  test("every coverage and mismatch has words", () => {
    for (const v of Object.values(COVERAGE_LABEL)) expect(v).toBeTruthy();
    for (const v of Object.values(MISMATCH_LABEL)) expect(v).toBeTruthy();
  });
  test("state shows the most important reason first", () => {
    const base = { status: "active" as const, expired: false, not_yet_valid: false, available: 3 };
    expect(resourceState(base).label).toBe("Available");
    expect(resourceState({ ...base, available: 0 }).label).toBe("None left");
    expect(resourceState({ ...base, not_yet_valid: true }).label).toBe("Not available yet");
    expect(resourceState({ ...base, expired: true, available: 0 }).label).toBe("Past end date");
    expect(resourceState({ ...base, status: "archived", expired: true }).label).toBe("Archived");
  });
});

describe("database errors", () => {
  test.each([
    ["total_below_committed_quantity", "total", /already reserved/],
    ["partner_name_required", "sourceName", /partner/],
    ["invalid_dates", "validUntil", /end date/],
    ["invalid_manager", "manager", /staff/],
    ["too_many_areas", "areas", /20/],
  ])("%s goes to the %s field", (raw, field, pattern) => {
    const e = resourceDbError(raw);
    expect(e.field).toBe(field);
    expect(e.message).toMatch(pattern);
  });
  test("unknown errors do not leak details", () => {
    expect(resourceDbError('relation "x" does not exist')).toEqual({ message: "The resource could not be saved. Please try again." });
    expect(resourceDbError("forbidden").message).toMatch(/permission/);
  });
});
