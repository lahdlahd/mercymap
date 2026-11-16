// Only ever redirect to a path inside this app. Anything else (absolute URLs,
// protocol-relative URLs, backslash tricks) falls back to the default.
export function safeNextPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const parsed = new URL(value, "http://internal.invalid");
    if (parsed.origin !== "http://internal.invalid") return fallback;
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
