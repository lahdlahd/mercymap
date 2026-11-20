import { z } from "zod";

export type Volunteer = {
  id: string;
  full_name: string;
  phone: string | null;
  skills: string[];
  availability_notes: string | null;
  consent_given_at: string | null;
  status: "active" | "inactive";
  created_at: string;
  open_tasks: number;
  completed_tasks: number;
};

export type Assignment = {
  id: string;
  status: "assigned" | "in_progress" | "completed" | "cancelled";
  task_brief: string;
  volunteer_id: string;
  volunteer_name: string;
  volunteer_phone: string | null;
  assigned_by_email: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export const TASK_STATUS_LABEL: Record<Assignment["status"], string> = {
  assigned: "Assigned",
  in_progress: "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_NEXT: Record<Assignment["status"], Array<{ to: Assignment["status"]; label: string }>> = {
  assigned: [
    { to: "in_progress", label: "Mark as started" },
    { to: "completed", label: "Mark as completed" },
    { to: "cancelled", label: "Cancel task" },
  ],
  in_progress: [
    { to: "completed", label: "Mark as completed" },
    { to: "cancelled", label: "Cancel task" },
  ],
  completed: [],
  cancelled: [],
};

export function parseSkills(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

const PHONE = /^\+?[0-9(][0-9 ()-]{5,24}$/;

export const volunteerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter the volunteer's name.").max(120, "Use 120 characters or fewer."),
    phone: z.string().trim().max(40, "That phone number is too long.").optional().default(""),
    consent: z.boolean(),
    skills: z.string().optional().default(""),
    availability: z.string().trim().max(500, "Use 500 characters or fewer.").optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.phone) {
      const digits = v.phone.replace(/\D/g, "").length;
      if (!PHONE.test(v.phone) || digits < 7 || digits > 15) {
        ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a phone number such as 0803 555 0101." });
      } else if (!v.consent) {
        ctx.addIssue({ code: "custom", path: ["consent"], message: "Tick this to keep their phone number, or leave the number out." });
      }
    }
    const skills = parseSkills(v.skills ?? "");
    if (skills.length > 10) ctx.addIssue({ code: "custom", path: ["skills"], message: "List up to 10 skills." });
    else if (skills.some((s) => s.length > 40)) ctx.addIssue({ code: "custom", path: ["skills"], message: "Keep each skill to 40 characters or fewer." });
  });

export function volunteerDbError(message: string): { field?: string; message: string } {
  if (/consent_required/.test(message)) return { field: "consent", message: "Tick this to keep their phone number, or leave the number out." };
  if (/invalid_phone/.test(message)) return { field: "phone", message: "Enter a phone number such as 0803 555 0101." };
  if (/invalid_name/.test(message)) return { field: "fullName", message: "Enter the volunteer's name." };
  if (/invalid_skills/.test(message)) return { field: "skills", message: "List up to 10 skills of 40 characters or fewer." };
  if (/invalid_availability/.test(message)) return { field: "availability", message: "Use 500 characters or fewer." };
  if (/church_suspended/.test(message)) return { message: "This workspace is suspended, so volunteers cannot be changed." };
  if (/forbidden/.test(message)) return { message: "You do not have permission to do that." };
  return { message: "The volunteer could not be saved. Please try again." };
}

// The brief a volunteer receives. Only what they need to do the task: no name,
// no description. The phone number is added only when staff choose to.
export function defaultBrief(r: {
  reference: string;
  categoryLabel: string;
  quantity: number;
  unit?: string | null;
  area: string | null;
  churchName: string;
  collectionNote?: string | null;
}): string {
  const lines = [
    `${r.churchName}: volunteer task for ${r.reference}`,
    `Help: ${r.quantity} ${r.unit ?? ""}`.trimEnd() + ` (${r.categoryLabel})`,
    `Area: ${r.area ?? "not given"}`,
  ];
  if (r.collectionNote) lines.push(`Note: ${r.collectionNote}`);
  lines.push("Please confirm with the church office when it is done.");
  return lines.join("\n");
}

export function withPhone(brief: string, phone: string | null): string {
  if (!phone) return brief;
  const line = `Contact: ${phone}`;
  return brief.includes(line) ? brief : `${brief}\n${line}`;
}

// A wa.me link opens WhatsApp with the brief ready to send. Nigerian numbers
// written 0803… become 234803…; other numbers keep their digits.
export function whatsappLink(phone: string | null, text: string): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) digits = `234${digits.slice(1)}`;
  const base = digits.length >= 7 ? `https://wa.me/${digits}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}
