import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { TASK_NEXT, TASK_STATUS_LABEL, whatsappLink, type Assignment } from "@/lib/volunteers";
import { assignVolunteerAction, updateTaskAction } from "./actions";
import { AssignVolunteerForm, CopyBriefButton, TaskStatusForm } from "./forms";

const TONE = { assigned: "info", in_progress: "pending", completed: "success", cancelled: "neutral" } as const;

// Volunteer tasks for one request. Tasks can be given once help is approved.
export function TasksPanel({
  requestId,
  status,
  assignments,
  volunteers,
  baseBrief,
  requesterPhone,
  suspended,
}: {
  requestId: string;
  status: string;
  assignments: Assignment[];
  volunteers: Array<{ id: string; name: string }>;
  baseBrief: string;
  requesterPhone: string | null;
  suspended: boolean;
}) {
  const canAssign = (status === "approved" || status === "in_progress") && !suspended;
  if (!canAssign && assignments.length === 0) return null;

  return (
    <Card aria-labelledby="tasks-heading" data-tasks-panel="">
      <h2 id="tasks-heading" className="text-lg font-bold text-charcoal">Volunteer tasks</h2>
      {assignments.length ? (
        <ul className="mt-4 space-y-4">
          {assignments.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-4" data-task={a.volunteer_name}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-charcoal">{a.volunteer_name}</p>
                <Badge tone={TONE[a.status]}>{TASK_STATUS_LABEL[a.status]}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">
                Given by {a.assigned_by_email ?? "a former staff member"} on {formatDateTime(a.created_at)}
                {a.completed_at ? ` · completed ${formatDateTime(a.completed_at)}` : ""}
              </p>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-lightgrey p-3 font-sans text-sm text-charcoal">{a.task_brief}</pre>
              {a.status === "assigned" || a.status === "in_progress" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyBriefButton text={a.task_brief} />
                  <a
                    href={whatsappLink(a.volunteer_phone, a.task_brief)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-forest hover:bg-lightgrey"
                  >
                    Send on WhatsApp
                  </a>
                  {suspended
                    ? null
                    : TASK_NEXT[a.status].map((n) => (
                        <TaskStatusForm
                          key={n.to}
                          action={updateTaskAction.bind(null, requestId, a.id, a.status, n.to)}
                          label={n.label}
                          confirm={n.to === "cancelled" ? "Cancel this volunteer task?" : undefined}
                        />
                      ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canAssign ? (
        <div className={assignments.length ? "mt-6 border-t border-line pt-5" : "mt-4"}>
          <h3 className="mb-3 font-semibold text-charcoal">Give this to a volunteer</h3>
          {volunteers.length === 0 ? (
            <p className="text-sm text-muted">
              No volunteers are available. Add one on the <Link href="/app/volunteers/new" className="font-semibold text-forest underline">Volunteers</Link> page.
            </p>
          ) : (
            <AssignVolunteerForm
              action={assignVolunteerAction.bind(null, requestId, status)}
              volunteers={volunteers}
              baseBrief={baseBrief}
              requesterPhone={requesterPhone}
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}
