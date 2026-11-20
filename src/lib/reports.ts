// Shared by the reports page and the CSV export. Pure functions, unit-tested.

export const PERIODS = [7, 30, 90, 365] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = 30;

export function parsePeriod(value: unknown): Period {
  const n = Number(value);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : DEFAULT_PERIOD;
}

export const PERIOD_LABEL: Record<Period, string> = {
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 365 days",
};

export const EXPORT_KINDS = ["requests", "stock", "tasks"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === "string" && (EXPORT_KINDS as readonly string[]).includes(value);
}

// Column order and headings for each export. Only these columns are written,
// whatever else a row might hold.
export const EXPORT_COLUMNS: Record<ExportKind, Array<[key: string, heading: string]>> = {
  requests: [
    ["reference", "Reference"],
    ["received", "Received"],
    ["kind_of_help", "Kind of help"],
    ["status", "Status"],
    ["quantity", "Quantity"],
    ["area", "Area"],
    ["channel", "Received through"],
    ["closed", "Closed"],
  ],
  stock: [
    ["given_out", "Given out"],
    ["reference", "Reference"],
    ["resource", "Resource"],
    ["quantity", "Quantity"],
    ["unit", "Unit"],
    ["source", "Source"],
    ["ai_suggested", "AI-suggested resource"],
  ],
  tasks: [
    ["given", "Given"],
    ["reference", "Reference"],
    ["status", "Status"],
    ["completed", "Completed"],
  ],
};

export const EXPORT_LABEL: Record<ExportKind, string> = {
  requests: "Requests",
  stock: "Stock given out",
  tasks: "Volunteer tasks",
};

// RFC 4180 quoting, plus protection against spreadsheet formula injection:
// a cell starting with = + - @ or a control character is prefixed with an
// apostrophe so Excel or Sheets shows it as text instead of running it.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(kind: ExportKind, rows: Array<Record<string, unknown>>): string {
  const columns = EXPORT_COLUMNS[kind];
  const lines = [columns.map(([, heading]) => csvCell(heading)).join(",")];
  for (const row of rows) lines.push(columns.map(([key]) => csvCell(row[key])).join(","));
  // A byte-order mark so Excel opens the file as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function exportFileName(kind: ExportKind, days: Period, today: string): string {
  return `mercymap-${kind}-last-${days}-days-${today}.csv`;
}

export type ReportSummary = {
  days: Period;
  from: string;
  to: string;
  bucket: "day" | "week" | "month";
  totals: {
    received: number;
    fulfilled: number;
    units_given: number;
    median_days_to_fulfil: number | null;
    tasks_completed: number;
    approvals: number;
    approvals_ai_suggested: number;
  };
  over_time: Array<{ bucket: string; received: number; fulfilled: number }>;
  by_kind: Array<{ key: string; label: string; count: number }>;
  outcomes: Array<{ key: string; label: string; count: number }>;
  given_by_resource: Array<{ resource_id: string; name: string; unit: string; quantity: number }>;
};

// "12 Nov" for days and weeks, "Nov 2026" for months.
export function bucketLabel(isoDate: string, bucket: ReportSummary["bucket"]): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return bucket === "month"
    ? d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}
