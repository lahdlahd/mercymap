"use client";

import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Cloudflare's bot check. It adds a hidden "cf-turnstile-response" field to
// the form; the server verifies it. resetSignal changes after each submission
// (a new form result), and every token can be used only once, so the widget
// fetches a fresh one.
export function Turnstile({ siteKey, resetSignal }: { siteKey: string; resetSignal: unknown }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          size: "flexible",
          theme: "light",
          callback: () => setStatus("ready"),
          "error-callback": () => setStatus("failed"),
          "expired-callback": () => setStatus("loading"),
        });
      })
      .catch(() => !cancelled && setStatus("failed"));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  const firstSignal = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal !== firstSignal.current && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  }, [resetSignal]);

  return (
    <div>
      <div ref={container} data-testid="turnstile" />
      {status === "failed" ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger-ink">
          The security check could not load. Check your internet connection, then reload this page.
        </p>
      ) : null}
    </div>
  );
}
