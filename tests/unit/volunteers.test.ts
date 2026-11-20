import { describe, expect, test } from "vitest";
import { TASK_NEXT, defaultBrief, parseSkills, volunteerDbError, volunteerSchema, whatsappLink, withPhone } from "@/lib/volunteers";

const valid = { fullName: "Bola Driver", phone: "", consent: false, skills: "", availability: "" };
const errors = (v: object) => {
  const r = volunteerSchema.safeParse(v);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("volunteer form", () => {
  test("a name alone is enough", () => expect(volunteerSchema.safeParse(valid).success).toBe(true));
  test("a phone number needs the volunteer's consent", () => {
    expect(errors({ ...valid, phone: "0803 000 0001" }).consent).toMatch(/Tick this/);
    expect(volunteerSchema.safeParse({ ...valid, phone: "0803 000 0001", consent: true }).success).toBe(true);
  });
  test("a bad phone number is refused before consent is asked", () => {
    const e = errors({ ...valid, phone: "call me" });
    expect(e.phone).toMatch(/phone number/);
    expect(e.consent).toBeUndefined();
  });
  test("name, skills and availability limits", () => {
    expect(errors({ ...valid, fullName: " A " }).fullName).toBeTruthy();
    expect(errors({ ...valid, skills: Array.from({ length: 11 }, (_, i) => `s${i}`).join(",") }).skills).toMatch(/up to 10/);
    expect(errors({ ...valid, skills: "x".repeat(41) }).skills).toMatch(/40/);
    expect(errors({ ...valid, availability: "a".repeat(501) }).availability).toBeTruthy();
  });
  test("skills are split, trimmed, lower-cased and de-duplicated", () => {
    expect(parseSkills("Driving, cooking\nDRIVING ,, Has a car")).toEqual(["driving", "cooking", "has a car"]);
  });
  test("database errors go to the right field without leaking details", () => {
    expect(volunteerDbError("consent_required")).toEqual({ field: "consent", message: expect.stringMatching(/Tick this/) });
    expect(volunteerDbError("invalid_phone").field).toBe("phone");
    expect(volunteerDbError('relation "x" does not exist')).toEqual({ message: "The volunteer could not be saved. Please try again." });
  });
});

describe("task brief", () => {
  const brief = defaultBrief({ reference: "MM-ABC123-DEF456", categoryLabel: "Food package", quantity: 2, unit: "package", area: "Ijapo", churchName: "Grace Community Church" });
  test("holds only what the volunteer needs", () => {
    expect(brief).toBe([
      "Grace Community Church: volunteer task for MM-ABC123-DEF456",
      "Help: 2 package (Food package)",
      "Area: Ijapo",
      "Please confirm with the church office when it is done.",
    ].join("\n"));
  });
  test("no area says so", () => {
    expect(defaultBrief({ reference: "MM-1", categoryLabel: "Food", quantity: 1, area: null, churchName: "C" })).toContain("Area: not given");
  });
  test("the phone is added only when asked, once", () => {
    expect(withPhone(brief, null)).toBe(brief);
    const once = withPhone(brief, "0803 555 0101");
    expect(once.endsWith("\nContact: 0803 555 0101")).toBe(true);
    expect(withPhone(once, "0803 555 0101")).toBe(once);
  });
});

describe("sending on WhatsApp", () => {
  test("Nigerian local numbers get the country code; text is encoded", () => {
    expect(whatsappLink("0803 555 0101", "Hi & bye")).toBe("https://wa.me/2348035550101?text=Hi%20%26%20bye");
    expect(whatsappLink("+44 7700 900123", "x")).toBe("https://wa.me/447700900123?text=x");
  });
  test("without a phone it opens WhatsApp to choose a contact", () => {
    expect(whatsappLink(null, "x")).toBe("https://wa.me/?text=x");
  });
});

describe("task status", () => {
  test("finished tasks offer no further steps", () => {
    expect(TASK_NEXT.completed).toEqual([]);
    expect(TASK_NEXT.cancelled).toEqual([]);
    expect(TASK_NEXT.assigned.map((x) => x.to)).toEqual(["in_progress", "completed", "cancelled"]);
  });
});
