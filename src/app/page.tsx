import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Wordmark } from "@/components/ui";

export const metadata: Metadata = {
  title: { absolute: "MERCYMAP · Church compassion, coordinated" },
  alternates: { canonical: "/" },
};

// Matthew 25:40, World English Bible (public domain).
const VERSE =
  "The King will answer them, ‘Most certainly I tell you, because you did it to one of the least of these my brothers, you did it to me.’";

const STEPS = [
  {
    title: "Someone asks for help",
    body: "Through the church's own link, or with a staff member's help. No account, no app, no password: just what they need, in their own words.",
  },
  {
    title: "The church reviews it",
    body: "Staff see every request in one place. AI suggests a summary, questions to ask and any safeguarding concern. People decide.",
  },
  {
    title: "Help is given and counted",
    body: "Stock is reserved the moment a request is approved, a volunteer gets a short brief, and the church sees what its care achieved.",
  },
];

const FEATURES = [
  ["Every request in one place", "Online and in-person requests in a single list, with a clear status and history for each."],
  ["Stock that cannot run out twice", "Approving a request reserves the food packs, vouchers or uniforms at the same moment, so two people are never promised the last one."],
  ["Volunteers without the admin", "Give a task to a volunteer with a short brief, then copy it or send it on WhatsApp. Volunteers need no login."],
  ["Nothing slips through", "Notifications for new requests, safeguarding concerns, stock running low and finished tasks."],
  ["Reports & Impact", "How many people were helped, what was given out and how quickly, with downloads for church leaders."],
  ["Many churches, kept apart", "Each church sees only its own people, stock and figures."],
];

const SAFETY = [
  ["People decide; AI only suggests", "The AI never approves, declines or reserves anything. Every decision is made and recorded by a named person."],
  ["Personal details stay out of the AI", "Names, phone numbers and emails are removed before a request is analysed."],
  ["Safeguarding comes first", "Words that suggest someone may be at risk raise a flag straight away, and only a person can clear it."],
  ["No public list of who asked", "There is no directory of churches or requests. People reach their church through the link it shares."],
];

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col bg-ivory">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" aria-label="MERCYMAP home" className="text-forest">
          <Wordmark className="text-xl" />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/sign-in" className={buttonClass("ghost")}>
            Staff sign in
          </Link>
          {/* On phones the hero has the same button right below. */}
          <span className="hidden sm:block">
            <Link href="/sign-up" className={buttonClass("primary")}>
              Register your church
            </Link>
          </span>
        </nav>
      </header>

      <main id="main" tabIndex={-1} className="flex-1">
        <section aria-labelledby="hero-heading" className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pt-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald">For churches that care for their communities</p>
          <h1 id="hero-heading" className="mt-4 max-w-3xl font-display text-4xl font-extrabold leading-tight text-charcoal sm:text-6xl">
            Turning Church Compassion Into Coordinated Community Impact.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            MERCYMAP helps churches receive requests for help, reserve what they can give, send volunteers and see their
            impact, while people asking for help never need an account.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-up" className={buttonClass("primary")}>
              Register your church
            </Link>
            <Link href="/sign-in" className={buttonClass("secondary")}>
              Staff sign in
            </Link>
          </div>
        </section>

        <section aria-label="Scripture" className="bg-forest text-ivory">
          <figure className="mx-auto max-w-4xl px-5 py-14 text-center sm:px-8 sm:py-20" data-verse="">
            <blockquote>
              <p className="font-display text-2xl font-semibold leading-snug sm:text-4xl">“{VERSE}”</p>
            </blockquote>
            <figcaption className="mt-6 text-base font-semibold text-gold-light">
              Matthew 25:40 <span className="font-normal text-sage">· World English Bible</span>
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 id="how-heading" className="font-display text-3xl font-bold text-charcoal">How it works</h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-xl border border-line bg-white p-6">
                <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-sage font-display text-lg font-bold text-forest">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-lg font-bold text-charcoal">{step.title}</h3>
                <p className="mt-2 text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="features-heading" className="border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 id="features-heading" className="font-display text-3xl font-bold text-charcoal">What your church gets</h2>
            <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(([title, body]) => (
                <li key={title}>
                  <h3 className="font-bold text-charcoal">{title}</h3>
                  <p className="mt-1 text-muted">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="safety-heading" className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <h2 id="safety-heading" className="font-display text-3xl font-bold text-charcoal">Safe, private and human</h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {SAFETY.map(([title, body]) => (
              <li key={title} className="rounded-xl border border-line bg-white p-6">
                <h3 className="font-bold text-charcoal">{title}</h3>
                <p className="mt-2 text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="seeking-heading" className="mx-auto max-w-6xl px-5 pb-16 sm:px-8">
          <div className="rounded-2xl bg-sage p-8 sm:p-10">
            <h2 id="seeking-heading" className="font-display text-2xl font-bold text-charcoal">Looking for help?</h2>
            <p className="mt-3 max-w-2xl text-charcoal">
              Ask your church for its MERCYMAP link. Each church has its own page where you can tell them what you need.
              You do not need an account, and only that church will see what you send.
            </p>
            <p className="mt-3 max-w-2xl text-sm text-muted">
              MERCYMAP is not an emergency service. If anyone is in danger, contact your local emergency services now.
            </p>
          </div>
        </section>

        <section aria-labelledby="start-heading" className="bg-forest text-ivory">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-14 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <h2 id="start-heading" className="font-display text-2xl font-bold">Bring your church&apos;s care into one place</h2>
              <p className="mt-2 text-sage">Register, invite your team, and share your link once you are verified.</p>
            </div>
            <Link href="/sign-up" className="inline-flex min-h-11 items-center rounded-lg bg-ivory px-5 font-semibold text-forest hover:bg-white">
              Register your church
            </Link>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-5 py-8 text-sm text-muted sm:px-8">
        <p>
          <Wordmark className="text-base text-forest" /> · Built for churches, African-first and ready for anywhere.
        </p>
      </footer>
    </div>
  );
}
