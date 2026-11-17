import "server-only";

// Server-only secrets. None of these has a NEXT_PUBLIC_ prefix, so Next.js
// never includes them in browser code. "server-only" makes any accidental
// import from a client component fail the build.

export type ServerConfig = {
  supabaseSecretKey: string;
  intakeHashSecret: string;
  turnstileSecretKey: string;
  turnstileVerifyUrl: string;
};

// Returns null when something is missing, so callers can fail closed with a
// friendly message instead of crashing. Missing names are logged (never values).
export function serverConfig(): ServerConfig | null {
  const values = {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    INTAKE_HASH_SECRET: process.env.INTAKE_HASH_SECRET,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };
  const missing = Object.entries(values)
    .filter(([name, value]) => !value || (name === "INTAKE_HASH_SECRET" && value.length < 16))
    .map(([name]) => name);
  if (missing.length) {
    console.error(`Server configuration incomplete: ${missing.join(", ")} missing or too short.`);
    return null;
  }
  return {
    supabaseSecretKey: values.SUPABASE_SECRET_KEY!,
    intakeHashSecret: values.INTAKE_HASH_SECRET!,
    turnstileSecretKey: values.TURNSTILE_SECRET_KEY!,
    turnstileVerifyUrl:
      process.env.TURNSTILE_VERIFY_URL || "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  };
}

export type AiConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  supabaseSecretKey: string;
};

// The AI is optional. Without a key (or without the Supabase secret key the
// runner needs) the app works as before and the request page says AI
// suggestions are not set up.
export function aiConfig(): AiConfig | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
  if (!apiKey || !supabaseSecretKey) return null;
  return {
    apiKey,
    supabaseSecretKey,
    model: process.env.AI_MODEL || "claude-haiku-5-5",
    baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, ""),
  };
}
