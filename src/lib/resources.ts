import { z } from "zod";

export type Coverage = "any" | "covered" | "unconfirmed" | "not_covered";
export type MismatchReason =
  | "archived" | "wrong_category" | "not_yet_valid" | "expired" | "not_enough" | "area_not_covered" | "other_church";

export const COVERAGE_LABEL: Record<Coverage, string> = {
  any: "Serves any area",
  covered: "Covers their area",
  unconfirmed: "Area not given: check coverage",
  not_covered: "Does not cover their area",
};

export const MISMATCH_LABEL: Record<MismatchReason, string> = {
  archived: "Archived",
  wrong_category: "Different kind of help",
  not_yet_valid: "Not available yet",
  expired: "Past its end date",
  not_enough: "Not enough left",
  area_not_covered: "Does not cover their area",
  other_church: "Belongs to another church",
};

// "Ijapo, Oke-Aro\nAlagbaka" -> ["Ijapo", "Oke-Aro", "Alagbaka"]
export function parseAreas(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((a) => a.trim())
    .filter(Boolean)
    .slice(0, 50);
}

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
  .optional()
  .or(z.literal(""));

export const resourceSchema = z
  .object({
    name: z.string().trim().min(2, "Give the resource a name.").max(160, "Use 160 characters or fewer."),
    category: z.string().trim().min(1, "Choose the kind of help it provides."),
    description: z.string().trim().max(2000, "Use 2000 characters or fewer.").optional().or(z.literal("")),
    unit: z.string().trim().min(1, "Say what one unit is, for example package or voucher.").max(40, "Use 40 characters or fewer."),
    // An empty box must not quietly become 0.
    total: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.coerce
        .number({ message: "Enter a number." })
        .int("Enter a whole number.")
        .min(0, "Enter 0 or more.")
        .max(1_000_000, "Enter 1,000,000 or fewer."),
    ),
    sourceType: z.enum(["church", "partner"], { message: "Choose where it comes from." }),
    sourceName: z.string().trim().max(160).optional().or(z.literal("")),
    areas: z.string().max(2000).optional().or(z.literal("")),
    validFrom: isoDate,
    validUntil: isoDate,
    manager: z.string().uuid().optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.sourceType === "partner" && !v.sourceName) {
      ctx.addIssue({ code: "custom", path: ["sourceName"], message: "Name the partner that provides it." });
    }
    if (v.validFrom && v.validUntil && v.validUntil < v.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "The end date is before the start date." });
    }
    if (v.areas && parseAreas(v.areas).length > 20) {
      ctx.addIssue({ code: "custom", path: ["areas"], message: "List 20 areas or fewer." });
    }
  });

export function resourceDbError(message: string | undefined): { field?: string; message: string } {
  const t = message ?? "";
  if (/total_below_committed_quantity/.test(t)) return { field: "total", message: "That is less than is already reserved or given out." };
  if (/partner_name_required/.test(t)) return { field: "sourceName", message: "Name the partner that provides it." };
  if (/invalid_dates/.test(t)) return { field: "validUntil", message: "The end date is before the start date." };
  if (/invalid_manager/.test(t)) return { field: "manager", message: "Choose a current member of staff." };
  if (/too_many_areas/.test(t)) return { field: "areas", message: "List 20 areas or fewer." };
  if (/invalid_category/.test(t)) return { field: "category", message: "Choose the kind of help it provides." };
  if (/invalid_quantity/.test(t)) return { field: "total", message: "Enter a number from 0 to 1,000,000." };
  if (/church_suspended/.test(t)) return { message: "This workspace is suspended, so resources cannot be changed." };
  if (/forbidden|permission denied/.test(t)) return { message: "You do not have permission to do that." };
  return { message: "The resource could not be saved. Please try again." };
}

export type Resource = {
  id: string;
  church_id: string;
  name: string;
  category_key: string;
  category_label: string;
  description: string | null;
  unit: string;
  total_quantity: number;
  reserved: number;
  distributed: number;
  available: number;
  source_type: "church" | "partner";
  source_name: string | null;
  coverage_areas: string[];
  valid_from: string | null;
  valid_until: string | null;
  manager_user_id: string | null;
  manager_email: string | null;
  status: "active" | "archived";
  expired: boolean;
  not_yet_valid: boolean;
  updated_at: string;
};

export type ResourceAllocation = {
  id: string;
  status: "reserved" | "fulfilled" | "released";
  quantity: number;
  request_id: string;
  reference: string;
  approved_at: string;
  fulfilled_at: string | null;
  released_at: string | null;
};

// One short label for the list: why a resource may not be offered.
export function resourceState(r: Pick<Resource, "status" | "expired" | "not_yet_valid" | "available">):
  { label: string; tone: "success" | "pending" | "danger" | "neutral" } {
  if (r.status === "archived") return { label: "Archived", tone: "neutral" };
  if (r.expired) return { label: "Past end date", tone: "danger" };
  if (r.not_yet_valid) return { label: "Not available yet", tone: "pending" };
  if (r.available === 0) return { label: "None left", tone: "danger" };
  return { label: "Available", tone: "success" };
}
