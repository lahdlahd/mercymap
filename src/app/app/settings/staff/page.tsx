import type { Metadata } from "next";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { INVITATION_DAYS, isPast } from "@/lib/invitations";
import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/validation";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "./actions";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Staff" };

type Member = { membership_id: string; user_id: string; email: string; role: StaffRole; status: string; joined_at: string };
type Invitation = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; expired: boolean };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Administrator", coordinator: "Coordinator" };
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

export default async function StaffPage() {
  const { user, membership } = await requireMembership();
  const supabase = await createClient();
  const isOwner = membership.role === "owner";
  const manages = canManageStaff(membership.role);

  const membersResult = await supabase.rpc("list_church_members", { p_church_id: membership.church.id });
  const members = (membersResult.data ?? []) as Member[];

  let invitations: Invitation[] = [];
  let invitationsFailed = false;
  if (manages) {
    const result = await supabase
      .from("invitations")
      .select("id, email, role, expires_at, accepted_at")
      .eq("church_id", membership.church.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });
    invitationsFailed = Boolean(result.error);
    invitations = (result.data ?? []).map((row) => ({ ...row, expired: isPast(row.expires_at) })) as Invitation[];
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Staff</h1>
        <p className="mt-1 text-sm text-muted">
          Owners manage roles. Administrators can invite and remove coordinators. Coordinators review and coordinate
          requests.
        </p>
      </div>

      <Card>
        <h2 className="text-lg font-bold text-charcoal">Members</h2>
        {membersResult.error ? (
          <div className="mt-4">
            <Alert tone="error">The staff list could not be loaded. Refresh the page to try again.</Alert>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {members.map((m) => {
              const isSelf = m.user_id === user.id;
              const canRemove = !isSelf && (isOwner || (membership.role === "admin" && m.role === "coordinator"));
              return (
                <li key={m.membership_id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-all font-medium text-charcoal">
                      {m.email} {isSelf ? <span className="text-muted">(you)</span> : null}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <Badge tone={m.role === "owner" ? "success" : "neutral"}>{ROLE_LABEL[m.role]}</Badge>
                      Joined {formatDate(m.joined_at)}
                    </p>
                  </div>
                  {(isOwner && !isSelf) || canRemove ? (
                    <div className="flex flex-wrap items-end gap-2">
                      {isOwner && !isSelf ? (
                        <ActionForm action={changeRoleAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="membershipId" value={m.membership_id} />
                          <label className="sr-only" htmlFor={`role-${m.membership_id}`}>
                            Role for {m.email}
                          </label>
                          <select
                            id={`role-${m.membership_id}`}
                            name="role"
                            defaultValue={m.role}
                            className="min-h-11 rounded-lg border border-line bg-white px-3 text-sm"
                          >
                            <option value="coordinator">Coordinator</option>
                            <option value="admin">Administrator</option>
                            <option value="owner">Owner</option>
                          </select>
                          <SubmitButton variant="secondary" pendingLabel="Saving…">
                            Save role
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {canRemove ? (
                        <ActionForm
                          action={removeMemberAction}
                          confirm={`Remove ${m.email} from ${membership.church.name}? They will lose access immediately.`}
                        >
                          <input type="hidden" name="membershipId" value={m.membership_id} />
                          <SubmitButton variant="danger" pendingLabel="Removing…">
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {manages ? (
        <>
          <Card>
            <h2 className="text-lg font-bold text-charcoal">Invite someone</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              You will get a private link to send them yourself, by email or message. They sign in or create an account
              with the same email address, then accept.
            </p>
            <InviteForm canInviteAdmin={isOwner} expiryDays={INVITATION_DAYS} />
          </Card>

          <Card>
            <h2 className="text-lg font-bold text-charcoal">Open invitations</h2>
            {invitationsFailed ? (
              <div className="mt-4">
                <Alert tone="error">Invitations could not be loaded. Refresh the page to try again.</Alert>
              </div>
            ) : invitations.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No invitations are waiting to be accepted.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {invitations.map((inv) => {
                  const expired = inv.expired;
                  return (
                    <li key={inv.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="break-all font-medium text-charcoal">{inv.email}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                          <Badge>{ROLE_LABEL[inv.role]}</Badge>
                          {expired ? (
                            <Badge tone="danger">Expired</Badge>
                          ) : (
                            <>Expires {formatDate(inv.expires_at)}</>
                          )}
                        </p>
                      </div>
                      <ActionForm action={revokeInvitationAction} confirm={`Revoke the invitation for ${inv.email}?`}>
                        <input type="hidden" name="invitationId" value={inv.id} />
                        <SubmitButton variant="secondary" pendingLabel="Revoking…">
                          {expired ? "Clear" : "Revoke"}
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
