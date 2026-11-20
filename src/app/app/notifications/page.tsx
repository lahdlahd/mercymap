import type { Metadata } from "next";
import { Alert, Badge, Card } from "@/components/ui";
import { requireMembership } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { markAllReadAction, openNotificationAction } from "./actions";
import { MarkAllReadForm, OpenNotificationForm } from "./forms";

export const metadata: Metadata = { title: "Notifications" };

type Item = {
  id: string;
  type: string;
  request_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

const TONE: Record<string, "danger" | "pending" | "info" | "success" | "neutral"> = {
  needs_attention: "danger",
  low_stock: "pending",
  new_request: "info",
  task_completed: "success",
};
const TYPE_LABEL: Record<string, string> = {
  needs_attention: "Needs attention",
  low_stock: "Stock",
  new_request: "New request",
  task_completed: "Volunteer task",
};

export default async function NotificationsPage() {
  const { membership } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_notifications", { p_church_id: membership.church.id, p_limit: 100 });
  const list = (data ?? { unread: 0, items: [] }) as { unread: number; items: Item[] };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Notifications</h1>
          <p className="mt-1 text-sm text-muted">
            {list.unread === 0 ? "You are all caught up." : `${list.unread} unread.`} Notifications never include names or personal details.
          </p>
        </div>
        {list.unread > 0 ? <MarkAllReadForm action={markAllReadAction} /> : null}
      </div>
      {error ? (
        <Alert tone="error">Notifications could not be loaded. Refresh the page to try again.</Alert>
      ) : list.items.length === 0 ? (
        <Card><p className="text-charcoal">No notifications yet.</p></Card>
      ) : (
        <ul className="space-y-3">
          {list.items.map((n) => (
            <li key={n.id} data-notification={n.type} data-unread={n.read_at ? undefined : ""}>
              <Card className={n.read_at ? "opacity-80" : "border-forest/40"}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TONE[n.type] ?? "neutral"}>{TYPE_LABEL[n.type] ?? "Update"}</Badge>
                      {n.read_at ? null : <span className="text-xs font-semibold text-forest">Unread</span>}
                    </div>
                    <p className="mt-2 font-semibold text-charcoal">{n.title}</p>
                    {n.body ? <p className="mt-1 text-sm text-muted">{n.body}</p> : null}
                    <p className="mt-1 text-xs text-muted">{formatDateTime(n.created_at)}</p>
                  </div>
                  {n.request_id || !n.read_at ? (
                    <OpenNotificationForm
                      action={openNotificationAction.bind(null, n.id, n.request_id)}
                      label={n.request_id ? "Open request" : "Mark as read"}
                    />
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
