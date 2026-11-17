import Link from "next/link";
import { buttonClass, Wordmark } from "@/components/ui";

// Placeholder home page. The full landing page is built in a later milestone.
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ivory px-6 py-16 text-center">
      <Wordmark className="text-3xl text-forest" />
      <h1 className="mt-8 max-w-2xl text-3xl font-extrabold leading-tight text-charcoal sm:text-5xl">
        Turning Church Compassion Into Coordinated Community Impact.
      </h1>
      <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">
        MERCYMAP helps churches receive requests for help, match them to available resources and follow each one
        through to fulfilment.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link href="/sign-up" className={buttonClass("primary")}>
          Register your church
        </Link>
        <Link href="/sign-in" className={buttonClass("secondary")}>
          Staff sign in
        </Link>
      </div>
    </main>
  );
}
