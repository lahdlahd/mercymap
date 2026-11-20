import { describe, expect, test } from "vitest";
import { EXPORT_COLUMNS, bucketLabel, csvCell, exportFileName, isExportKind, parsePeriod, percent, toCsv } from "@/lib/reports";

describe("periods", () => {
  test("only 7, 30, 90 and 365 days; anything else falls back to 30", () => {
    expect([7, 30, 90, 365].map(parsePeriod)).toEqual([7, 30, 90, 365]);
    for (const bad of [undefined, "", "0", "31", "abc", "-7", "1e3", 30.5]) expect(parsePeriod(bad)).toBe(30);
    expect(parsePeriod("90")).toBe(90);
  });
});

describe("CSV", () => {
  test("quotes commas, quotes and new lines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
  test("cells that a spreadsheet would run as a formula are made text", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+234")).toBe("'+234");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  test("only the agreed columns are written, in order, with headings", () => {
    const csv = toCsv("requests", [{
      reference: "MM-1", received: "2026-11-20 10:00", kind_of_help: "Food and groceries", status: "fulfilled",
      quantity: 2, area: "Ijapo", channel: "public", closed: "",
      requester_name: "Zainab Secret", contact_value: "0803 999 0000", original_text: "secret story",
    }]);
    expect(csv.startsWith("﻿")).toBe(true);
    const [head, row] = csv.slice(1).trimEnd().split("\r\n");
    expect(head).toBe("Reference,Received,Kind of help,Status,Quantity,Area,Received through,Closed");
    expect(row).toBe("MM-1,2026-11-20 10:00,Food and groceries,fulfilled,2,Ijapo,public,");
    expect(csv).not.toMatch(/Zainab|0803|secret/);
  });
  test("no export column could hold a name, phone number or description", () => {
    const keys = Object.values(EXPORT_COLUMNS).flat().map(([k]) => k);
    for (const banned of ["requester_name", "name", "full_name", "phone", "contact_value", "original_text", "description", "volunteer_name"]) {
      expect(keys).not.toContain(banned);
    }
  });
  test("kinds and file names", () => {
    expect(isExportKind("requests")).toBe(true);
    expect(isExportKind("people")).toBe(false);
    expect(exportFileName("stock", 90, "2026-11-20")).toBe("mercymap-stock-last-90-days-2026-11-20.csv");
  });
});

describe("labels", () => {
  test("bucket labels", () => {
    expect(bucketLabel("2026-11-02", "day")).toBe("2 Nov");
    expect(bucketLabel("2026-11-01", "month")).toBe("Nov 2026");
  });
  test("percent", () => {
    expect(percent(1, 4)).toBe("25%");
    expect(percent(0, 0)).toBe("—");
  });
});
