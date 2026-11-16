"use client";

import { useState } from "react";
import { buttonClass } from "@/components/ui";

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className={buttonClass("secondary")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
        setTimeout(() => setStatus("idle"), 2500);
      }}
    >
      <span aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Select and copy the link manually" : label}
      </span>
    </button>
  );
}
