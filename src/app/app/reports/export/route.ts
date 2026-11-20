import { getMembership } from "@/lib/auth";
import { exportFileName, isExportKind, parsePeriod, toCsv } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

// POST, because every download is written to the audit log. The database
// decides who may export (owners and admins of this church) and what goes in
// the file (no names, phone numbers or descriptions).
export async function POST(request: Request) {
  // Only forms on this site may ask for an export.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return new Response("Forbidden", { status: 403 });
  }
  const membership = await getMembership();
  if (!membership) return new Response("Sign in to download reports.", { status: 401 });

  const form = await request.formData();
  const kind = form.get("kind");
  if (!isExportKind(kind)) return new Response("Unknown export.", { status: 400 });
  const days = parsePeriod(form.get("days"));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_report", {
    p_church_id: membership.church.id,
    p_kind: kind,
    p_days: days,
  });
  if (error) {
    console.error("export failed:", error.code ?? "unknown");
    return /forbidden/.test(error.message)
      ? new Response("Only owners and administrators can download exports.", { status: 403 })
      : new Response("The export could not be created. Please try again.", { status: 500 });
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  return new Response(toCsv(kind, (data ?? []) as Array<Record<string, unknown>>), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(kind, days, today)}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
