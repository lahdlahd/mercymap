// Turns database and auth error text into something a person can act on.
// Unknown errors get a generic message; details go to the server log without
// any personal data.

const DB_MESSAGES: Array<[RegExp, string]> = [
  [/pending_church_exists/, "You already have a church registration awaiting verification."],
  [/email_not_confirmed/, "Confirm your email address first. Check your inbox for the confirmation link."],
  [/churches_slug_key|duplicate key.*slug/, "That link name is already taken. Try another."],
  [/invitations_one_pending_per_email/, "There is already an open invitation for that email address. Revoke it first to send a new one."],
  [/invitation_invalid_or_expired/, "This invitation is no longer valid. Ask the person who invited you to send a new one."],
  [/invitation_email_mismatch/, "This invitation was sent to a different email address."],
  [/already_member/, "You are already a member of this church."],
  [/cannot_change_own_role/, "You cannot change your own role."],
  [/cannot_remove_self/, "You cannot remove yourself."],
  [/last_owner_required/, "A church must always have at least one owner."],
  [/church_not_found/, "That church could not be found."],
  [/forbidden|row-level security|permission denied/, "You do not have permission to do that."],
  [/not_authenticated/, "Your session has ended. Sign in again."],
];

export function friendlyDbError(message: string | undefined | null): string {
  const text = message ?? "";
  for (const [pattern, friendly] of DB_MESSAGES) {
    if (pattern.test(text)) return friendly;
  }
  return "Something went wrong. Please try again.";
}

export function friendlyAuthError(code: string | undefined, message: string | undefined): string {
  const key = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (key.includes("email_not_confirmed") || key.includes("email not confirmed")) {
    return "Confirm your email address before signing in. Check your inbox for the confirmation link.";
  }
  if (key.includes("invalid_credentials") || key.includes("invalid login")) {
    return "That email and password do not match.";
  }
  if (key.includes("over_email_send_rate_limit") || key.includes("rate limit") || key.includes("over_request_rate_limit")) {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (key.includes("weak_password")) {
    return "That password is too easy to guess. Choose a stronger one.";
  }
  if (key.includes("same_password")) {
    return "Choose a password you have not used before.";
  }
  return "Something went wrong. Please try again.";
}
