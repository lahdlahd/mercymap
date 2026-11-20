import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  // Browsers only ever reach the deployed site over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // A narrow policy that cannot break scripts, Turnstile or Supabase: no
  // plugins, no <base> hijacking, forms post only to this site, no framing.
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" },
];

// Cache Components is deliberately left off. Every signed-in page reads the
// session and church-scoped data at request time; the classic dynamic
// rendering model keeps that simple and avoids any cross-user caching risk.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Invitation links carry a secret token in the path: never send it as a referrer.
      { source: "/invite/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
};

export default nextConfig;
