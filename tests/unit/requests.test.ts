import { describe, expect, test } from "vitest";
import rules from "@/lib/request-transitions.json";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  ACTION_LABEL, actionLabel, isClosed, isListTab, isRequestStatus, LIST_TABS, needsNote, nextStatuses, REQUEST_STATUSES,
  requestDbError, STATUS_LABEL, STATUS_TONE,
} from "@/lib/requests";

describe("request statuses", () => {
  test("every status has a label and a colour", () => {
    for (const s of REQUEST_STATUSES) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });
  test("manual changes never reach approved, in progress or fulfilled", () => {
    for (const s of REQUEST_STATUSES) {
      for (const n of nextStatuses(s)) expect(["approved", "in_progress", "fulfilled"]).not.toContain(n);
    }
  });
  test("closed requests have no manual next step, and every offered step has a button label", () => {
    for (const s of REQUEST_STATUSES) {
      if (isClosed(s)) expect(nextStatuses(s)).toEqual([]);
      for (const n of nextStatuses(s)) expect(ACTION_LABEL[n]?.label).toBeTruthy();
    }
  });
  test("statuses that need a note have a prompt for it", () => {
    for (const s of rules.noteRequired) {
      expect(needsNote(s as never)).toBe(true);
      expect(ACTION_LABEL[s as keyof typeof ACTION_LABEL]?.notePrompt).toBeTruthy();
    }
    expect(needsNote("under_review")).toBe(false);
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
    ['column "x" does not exist', /Something went wrong/],
  ])("%s", (raw, pattern) => expect(requestDbError(raw)).toMatch(pattern));
});

describe("dates are shown in West Africa Time", () => {
  test("a UTC time late in the evening shows the next day in Lagos", () => {
    expect(formatDateTime("2026-11-16T23:30:00Z")).toBe("17 Nov 2026, 00:30");
    expect(formatDate("2026-11-16T23:30:00Z")).toBe("17 Nov 2026");
  });
});
