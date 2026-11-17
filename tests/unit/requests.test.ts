import { describe, expect, test } from "vitest";
import rules from "@/lib/request-transitions.json";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  ACTION_LABEL, actionLabel, holdsStock, isClosed, isListTab, isRequestStatus, LIST_TABS, needsNote, nextStatuses, REQUEST_STATUSES,
  requestDbError, STATUS_LABEL, STATUS_TONE,
} from "@/lib/requests";

describe("request statuses", () => {
  test("every status has a label and a colour", () => {
    for (const s of REQUEST_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });
  test("manual changes never reach approved or fulfilled, and in progress only from approved", () => {
    for (const s of REQUEST_STATUSES) {
      for (const n of nextStatuses(s)) {
        expect(["approved", "fulfilled"]).not.toContain(n);
        if (n === "in_progress") expect(s).toBe("approved");
      }
    }
  });
  test("only approved and in progress hold stock", () => {
    expect(REQUEST_STATUSES.filter(holdsStock)).toEqual(["approved", "in_progress"]);
  });
  test("closed requests have no manual next step, and every offered step has a button label", () => {
    for (const s of REQUEST_STATUSES) {
      if (isClosed(s)) expect(nextStatuses(s)).toEqual([]);
      for (const n of nextStatuses(s)) expect(ACTION_LABEL[n]?.label).toBeTruthy();
    }
  });
  test("statuses that need a note have a prompt for it", () => {
    for (const s of rules.noteRequired) {
      expect(needsNote("under_review", s as never)).toBe(true);
      expect(ACTION_LABEL[s as keyof typeof ACTION_LABEL]?.notePrompt).toBeTruthy();
    }
    expect(needsNote("submitted", "under_review")).toBe(false);
  });
  test("releasing reserved stock always needs a note, starting delivery does not", () => {
    expect(needsNote("approved", "in_progress")).toBe(false);
    expect(needsNote("approved", "awaiting_match")).toBe(true);
    expect(needsNote("in_progress", "awaiting_match")).toBe(true);
    expect(needsNote("under_review", "awaiting_match")).toBe(false);
    for (const from of rules.allocatedStatuses) {
      for (const to of nextStatuses(from as never)) {
        expect(needsNote(from as never, to)).toBe(to !== "in_progress");
      }
    }
  });
  test("type guards", () => {
    expect(isRequestStatus("awaiting_match")).toBe(true);
    expect(isRequestStatus("approved; drop table")).toBe(false);
    expect(isListTab("attention")).toBe(true);
    expect(isListTab("fulfilled")).toBe(false);
    expect(LIST_TABS[0].key).toBe("open");
  });
});

describe("button labels", () => {
  test("going back to review is worded as a return", () => {
    expect(actionLabel("submitted", "under_review").label).toBe("Start review");
    expect(actionLabel("awaiting_match", "under_review").label).toBe("Return to review");
    expect(actionLabel("awaiting_clarification", "under_review").label).toBe("Return to review");
    expect(actionLabel("under_review", "declined").label).toBe("Decline");
  });
  test("leaving an approved request says the stock goes back", () => {
    expect(actionLabel("approved", "in_progress").label).toBe("Start delivery");
    expect(actionLabel("approved", "awaiting_match").label).toMatch(/Release and choose another/);
    expect(actionLabel("in_progress", "cancelled").help).toMatch(/reserved stock is returned/);
  });
});

describe("error messages", () => {
  test.each([
    ["status_changed", /Someone else changed/],
    ["reason_required", /short note/],
    ["note_required", /short note/],
    ["invalid_transition", /not possible/],
    ["requires_allocation", /resource is reserved/],
    ["already_flagged", /already open/],
    ["forbidden", /permission/],
    ["resource_not_suitable: not_enough", /enough/],
    ["resource_not_suitable: area_not_covered", /area/],
    ["resource_not_suitable: expired", /date/],
    ["no_reservation", /reserved/],
    ['column "x" does not exist', /Something went wrong/],
  ])("%s", (raw, pattern) => expect(requestDbError(raw)).toMatch(pattern));
});

describe("dates are shown in West Africa Time", () => {
  test("a UTC time late in the evening shows the next day in Lagos", () => {
    expect(formatDateTime("2026-11-16T23:30:00Z")).toBe("17 Nov 2026, 00:30");
    expect(formatDate("2026-11-16T23:30:00Z")).toBe("17 Nov 2026");
  });
});
