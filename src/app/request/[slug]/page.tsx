import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RequestForm } from "@/components/intake/request-form";
import { Wordmark } from "@/components/ui";
import { turnstileSiteKey } from "@/lib/env";
import { serverConfig } from "@/lib/server-env";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitPublicRequestAction } from "./actions";

type Intake = {
  church: { name: string; slug: string; area: string | null; contact_phone: string | null; emergency_guidance: string | null };
  categories: Array<{ key: string; label: string }>;
};

async function loadIntake(slug: string): Promise<Intake | null> {
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return null;
  const config = serverConfig();
  if (!config) return null;
  const { data, error } = await createAdminClient(config.supabaseSecretKey).rpc("get_public_intake", { p_slug: slug });
  if (error) {
    console.error("get_public_intake failed:", error.code ?? "unknown");
    return null;
  }
  return (data as Intake | null) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const intake = await loadIntake((await params).slug);
  return {
    title: intake ? `Ask ${intake.church.name} for help` : "Request help",
    // Churches share this link directly; keeping it out of search results
    // makes it harder for automated spam to find.
    robots: { index: false, follow: false },
  };
}

const DEFAULT_EMERGENCY =
  "If anyone is in immediate danger or needs urgent medical help, contact your local emergency services now.";

export default async function PublicRequestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const intake = await loadIntake(slug);
  if (!intake) notFound();
  const { church, categories } = intake;

  return (
    <main className="flex-1 bg-ivory">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald">Request help</p>
          <h1 className="mt-1 text-3xl font-extrabold text-charcoal sm:text-4xl">{church.name}</h1>
          {church.area ? <p className="mt-1 text-muted">{church.area}</p> : null}
          <p className="mt-4 text-base text-charcoal">
            Tell {church.name} what you need. You do not need an account, and you only need to share what you are
            comfortable sharing.
          </p>
        </header>

        <section
          aria-labelledby="emergency-heading"
          className="mt-6 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger-ink"
        >
          <h2 id="emergency-heading" className="font-bold">
            This is not an emergency service
          </h2>
          <p className="mt-1 whitespace-pre-line">{church.emergency_guidance || DEFAULT_EMERGENCY}</p>
          {church.contact_phone ? (
            <p className="mt-2">
              Church phone:{" "}
              <a href={`tel:${church.contact_phone.replace(/[^+0-9]/g, "")}`} className="font-semibold underline">
                {church.contact_phone}
              </a>
            </p>
          ) : null}
        </section>

        <div className="mt-6 rounded-xl border border-line bg-white p-5 shadow-sm sm:p-7">
          <RequestForm
            mode="public"
            action={submitPublicRequestAction.bind(null, church.slug)}
            categories={categories}
            churchName={church.name}
            siteKey={turnstileSiteKey()}
          />
        </div>

        <footer className="mt-8 flex items-center justify-center gap-2 text-sm text-muted">
          <span>Powered by</span>
          <Wordmark className="text-base text-forest" />
        </footer>
      </div>
    </main>
  );
}
