import { Badge, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { AnalysisOutput } from "@/lib/ai/analysis";
import { rerunAiAction, applySuggestedCategoryAction } from "./actions";
import { AiAutoRefresh, RerunAiForm, UseCategoryForm } from "./forms";

export type AiDetail = {
  status: "pending" | "processing" | "done" | "failed" | "skipped";
  can_rerun: boolean;
  latest: {
    id: string;
    output: AnalysisOutput;
    model: string;
    created_at: string;
    suggested_category_label: string | null;
    resource_name: string | null;
  } | null;
};

const URGENCY = {
  low: { label: "Low urgency", tone: "neutral" },
  medium: { label: "Medium urgency", tone: "pending" },
  high: { label: "High urgency", tone: "danger" },
} as const;

const CATEGORY_OPEN = new Set(["submitted", "under_review", "awaiting_clarification", "awaiting_match"]);

// Suggestions only. Nothing here changes the request unless a person clicks,
// and even then only the kind of help, through a recorded action.
export function AiPanel({
  ai,
  configured,
  requestId,
  status,
  categoryKey,
  suspended,
  createdAt,
  claimedAt,
}: {
  ai: AiDetail;
  configured: boolean;
  requestId: string;
  status: string;
  categoryKey: string;
  suspended: boolean;
  createdAt: string;
  claimedAt: string | null;
}) {
  const latest = ai.latest;
  const out = latest?.output;
  // "Working" only while a run is really expected: just submitted, or claimed
  // in the last two minutes. Older pending requests simply offer "Analyse now".
  // eslint-disable-next-line react-hooks/purity -- server component, rendered per request
  const now = Date.now();
  const recent = (iso: string | null) => Boolean(iso) && now - new Date(iso as string).getTime() < 120_000;
  const working = configured && ((ai.status === "pending" && recent(createdAt)) || (ai.status === "processing" && recent(claimedAt)));
  const canRerun = configured && ai.can_rerun && !suspended && !working;

  return (
    <Card aria-labelledby="ai-heading" data-ai-panel="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="ai-heading" className="text-lg font-bold text-charcoal">AI suggestions</h2>
        {out ? <Badge tone={URGENCY[out.urgency].tone}>{URGENCY[out.urgency].label}</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted">Check before acting. The AI suggests; people decide.</p>

      {working ? (
        <>
          <AiAutoRefresh />
          <p className="mt-4 text-sm text-muted" role="status">Analysing this request… the suggestions will appear here shortly.</p>
        </>
      ) : null}

      {!out && !working ? (
        <p className="mt-4 text-sm text-muted">
          {!configured
            ? "AI suggestions are not set up for this workspace. Everything else works as normal."
            : ai.status === "failed"
              ? "AI suggestions are unavailable right now. Everything else works as normal."
              : "No suggestions yet."}
        </p>
      ) : null}

      {out ? (
        <div className="mt-4 space-y-4 text-sm text-charcoal">
          <p className="text-base" data-ai="summary">{out.summary}</p>
          {out.key_facts.length ? (
            <div>
              <h3 className="font-semibold">Key facts</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5" data-ai="facts">
                {out.key_facts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          ) : null}
          {out.missing_info.length ? (
            <div>
              <h3 className="font-semibold">You may want to ask</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5" data-ai="missing">
                {out.missing_info.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          ) : null}
          {out.safeguarding.concern ? (
            <p className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-danger-ink" data-ai="safeguarding">
              <strong>Possible safeguarding concern:</strong> {out.safeguarding.reason ?? "A person should review this request."}
            </p>
          ) : null}
          {out.suggested_category && latest.suggested_category_label && out.suggested_category !== categoryKey ? (
            <div className="rounded-lg border border-line bg-lightgrey p-3" data-ai="category">
              <p>
                Suggested kind of help: <strong>{latest.suggested_category_label}</strong>
              </p>
              {CATEGORY_OPEN.has(status) && !suspended ? (
                <div className="mt-2">
                  <UseCategoryForm
                    action={applySuggestedCategoryAction.bind(null, requestId, categoryKey, latest.id)}
                    label={latest.suggested_category_label}
                  />
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">The kind of help cannot change at this stage.</p>
              )}
            </div>
          ) : null}
          {out.suggested_category && latest.suggested_category_label && out.suggested_category === categoryKey ? (
            <p className="rounded-lg border border-success/30 bg-sage p-3" data-ai="category-accepted" role="status">
              Suggestion accepted: the kind of help is now <strong>{latest.suggested_category_label}</strong>.
            </p>
          ) : null}
          {out.resource && latest.resource_name && status === "awaiting_match" ? (
            <p className="rounded-lg border border-line bg-lightgrey p-3" data-ai="resource">
              Suggested resource: <strong>{latest.resource_name}</strong>. {out.resource.explanation} You still choose and approve below.
            </p>
          ) : null}
          <p className="text-xs text-muted">Analysed {formatDateTime(latest.created_at)}.</p>
        </div>
      ) : null}

      {canRerun ? (
        <div className="mt-4">
          <RerunAiForm action={rerunAiAction.bind(null, requestId)} label={out ? "Run again" : "Analyse now"} />
        </div>
      ) : null}
    </Card>
  );
}
