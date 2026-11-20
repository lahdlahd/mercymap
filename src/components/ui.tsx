import type { ComponentProps, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const buttonVariants = {
  primary: "bg-forest text-white hover:bg-forest-dark",
  secondary: "border border-line bg-white text-charcoal hover:bg-lightgrey",
  danger: "border border-danger/40 bg-white text-danger-ink hover:bg-danger-soft",
  ghost: "text-forest hover:bg-sage",
} as const;
export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "primary", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], extra);
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-line bg-white p-6 shadow-sm", className)} {...props} />;
}

const alertTones = {
  error: "border-danger/30 bg-danger-soft text-danger-ink",
  success: "border-success/30 bg-sage text-success-ink",
  warning: "border-pending/40 bg-pending-soft text-pending-ink",
  info: "border-line bg-sage text-charcoal",
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof alertTones;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("rounded-lg border px-4 py-3 text-sm", alertTones[tone])}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

const badgeTones = {
  success: "bg-sage text-success-ink",
  pending: "bg-pending-soft text-pending-ink",
  danger: "bg-danger-soft text-danger-ink",
  neutral: "bg-lightgrey text-charcoal",
  info: "bg-[#e8f0f8] text-[#245a8c]",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", badgeTones[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: "pending" | "verified" | "suspended" }) {
  if (status === "verified") return <Badge tone="success">✓ Verified</Badge>;
  if (status === "suspended") return <Badge tone="danger">✕ Suspended</Badge>;
  return <Badge tone="pending">… Awaiting verification</Badge>;
}

// The MERCYMAP wordmark. "MAP" uses a gold that keeps 4.5:1 contrast: darker
// on light backgrounds, lighter on the forest-green sidebar and banners.
export function Wordmark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <span className={cx("font-display text-lg font-extrabold tracking-wide", className)}>
      MERCY<span className={onDark ? "text-gold-light" : "text-gold-ink"}>MAP</span>
    </span>
  );
}
