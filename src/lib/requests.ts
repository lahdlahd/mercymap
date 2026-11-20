import rules from "./request-transitions.json";

export const REQUEST_STATUSES = [
  "submitted",
  "under_review",
  "awaiting_clarification",
  "awaiting_match",
  "approved",
  "in_progress",
  "fulfilled",
  "declined",
  "cancelled",
  "unable_to_fulfil",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: "New",
  under_review: "Under review",
  awaiting_clarification: "Awaiting clarification",
  awaiting_match: "Awaiting match",
  approved: "Approved",
  in_progress: "In progress",
  fulfilled: "Fulfilled",
  declined: "Declined",
  cancelled: "Cancelled",
  unable_to_fulfil: "Unable to fulfil",
};

export type BadgeTone = "success" | "pending" | "danger" | "neutral" | "info";
export const STATUS_TONE: Record<RequestStatus, BadgeTone> = {
  submitted: "info",
  under_review: "pending",
  awaiting_clarification: "pending",
  awaiting_match: "pending",
  approved: "success",
  in_progress: "info",
  fulfilled: "success",
  declined: "danger",
  cancelled: "neutral",
  unable_to_fulfil: "neutral",
};

// What each manual change is called on its button, and the help shown with it.
export const ACTION_LABEL: Partial<Record<RequestStatus, { label: string; help: string; notePrompt?: string }>> = {
  under_review: { label: "Start review", help: "Someone is looking at this request now." },
  awaiting_clarification: {
    label: "Ask for more information",
    help: "You need something from the person before you can decide.",
    notePrompt: "What do you need to find out?",
  },
  awaiting_match: { label: "Ready for a resource", help: "The need is understood; it now needs a suitable resource." },
  declined: { label: "Decline", help: "The church will not be helping with this request.", notePrompt: "Why is it being declined?" },
  cancelled: { label: "Cancel", help: "The request is no longer needed, or was withdrawn or duplicated.", notePrompt: "Why is it being cancelled?" },
  unable_to_fulfil: {
    label: "Unable to fulfil",
    help: "The church wanted to help but could not.",
    notePrompt: "What prevented it?",
  },
  in_progress: { label: "Start delivery", help: "Someone is arranging or delivering the help now." },
};

// The step back to review reads differently once a request has moved on.
export function actionLabel(from: RequestStatus, to: RequestStatus): { label: string; help: string } {
  if (to === "under_review" && from !== "submitted") {
    return { label: "Return to review", help: "Look at this request again before deciding." };
  }
  if (holdsStock(from) && to === "awaiting_match") {
    return { label: "Release and choose another resource", help: "Return the reserved stock and match this request again." };
  }
  if (holdsStock(from) && to !== "in_progress") {
    const a = ACTION_LABEL[to];
    return { label: a?.label ?? STATUS_LABEL[to], help: `${a?.help ?? ""} The reserved stock is returned.`.trim() };
  }
  const a = ACTION_LABEL[to];
  return { label: a?.label ?? STATUS_LABEL[to], help: a?.help ?? "" };
}

const transitions = rules.transitions as Partial<Record<RequestStatus, RequestStatus[]>>;
const noteRequired = new Set(rules.noteRequired as RequestStatus[]);
const allocated = new Set(rules.allocatedStatuses as RequestStatus[]);

export function nextStatuses(status: RequestStatus): RequestStatus[] {
  return transitions[status] ?? [];
}
// Mirrors private.request_change_needs_note: a note is needed for some
// outcomes, and whenever reserved stock is being returned.
export function needsNote(from: RequestStatus, to: RequestStatus): boolean {
  return noteRequired.has(to) || (allocated.has(from) && to !== "in_progress");
}
// Approved and In progress requests hold reserved stock.
export function holdsStock(status: RequestStatus): boolean {
  return allocated.has(status);
}
export function isClosed(status: RequestStatus): boolean {
  return status === "fulfilled" || status === "declined" || status === "cancelled" || status === "unable_to_fulfil";
}
export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value);
}

export const CHANNEL_LABEL = { public: "Online form", staff: "Recorded by staff" } as const;
export const CONTACT_LABEL: Record<string, string> = {
  phone_call: "Phone call",
  sms: "SMS",
  in_person: "In person at the church",
  none: "No phone; will visit the church",
};

export const EVENT_LABEL: Record<string, string> = {
  submitted: "Request received",
  status_changed: "Status changed",
  note_added: "Note added",
  attention_flagged: "Safeguarding concern raised",
  attention_acknowledged: "Safeguarding concern reviewed",
  category_changed: "Kind of help changed",
  volunteer_assigned: "Volunteer given the task",
  volunteer_task_updated: "Volunteer task updated",
};

// Tabs on the Requests page. "attention" is a filter, not a status.
export const LIST_TABS = [
  { key: "open", label: "Open" },
  { key: "attention", label: "Needs attention" },
  { key: "submitted", label: "New" },
  { key: "under_review", label: "Under review" },
  { key: "awaiting_clarification", label: "Awaiting clarification" },
  { key: "awaiting_match", label: "Awaiting match" },
  { key: "approved", label: "Approved" },
  { key: "in_progress", label: "In progress" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;
export type ListTab = (typeof LIST_TABS)[number]["key"];
export function isListTab(value: unknown): value is ListTab {
  return typeof value === "string" && LIST_TABS.some((t) => t.key === value);
}

export function requestDbError(message: string | undefined): string {
  const text = message ?? "";
  if (/status_changed/.test(text)) return "Someone else changed this request a moment ago. The page has been refreshed; check its status and try again.";
  if (/reason_required|note_required/.test(text)) return "Please add a short note explaining this.";
  if (/invalid_transition/.test(text)) return "That change is not possible from the request's current status.";
  if (/requires_allocation/.test(text)) return "A request is approved only when a resource is reserved for it.";
  if (/already_flagged/.test(text)) return "A safeguarding concern is already open on this request.";
  if (/not_flagged/.test(text)) return "There is no open safeguarding concern to review.";
  if (/church_suspended/.test(text)) return "This workspace is suspended, so requests cannot be changed.";
  if (/volunteer_not_found/.test(text)) return "That volunteer could not be found.";
  if (/volunteer_inactive/.test(text)) return "That volunteer is marked as not available.";
  if (/already_assigned/.test(text)) return "That volunteer already has an open task for this request.";
  if (/not_approved/.test(text)) return "Volunteers can only be given approved requests.";
  if (/invalid_brief/.test(text)) return "Write a short brief of 2,000 characters or fewer.";
  if (/ai_limit_reached/.test(text)) return "This request has been analysed as many times as allowed.";
  if (/ai_running/.test(text)) return "An analysis is already running. Refresh in a moment.";
  if (/category_changed|suggestion_changed/.test(text)) return "The kind of help or the suggestion changed a moment ago. The page has been refreshed.";
  if (/category_locked/.test(text)) return "The kind of help cannot change once stock is reserved or the request is closed.";
  if (/no_suggestion/.test(text)) return "There is no different kind of help suggested.";
  if (/resource_not_suitable: not_enough|insufficient_available_quantity/.test(text)) return "That resource no longer has enough available. The list has been refreshed.";
  if (/resource_not_suitable: (expired|not_yet_valid)|resource_outside_validity/.test(text)) return "That resource is not within its available dates. The list has been refreshed.";
  if (/resource_not_suitable: area_not_covered/.test(text)) return "That resource does not cover this person's area.";
  if (/resource_not_suitable|resource_not_active|resource_not_found/.test(text)) return "That resource cannot be used for this request. The list has been refreshed.";
  if (/no_reservation/.test(text)) return "There is no reserved stock to record as delivered.";
  if (/forbidden|permission denied/.test(text)) return "You do not have permission to do that.";
  return "Something went wrong. Please try again.";
}
