import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

// Only the home page is for search engines. Church request pages are reached
// through the link each church shares, so they are never listed anywhere: no
// public directory of churches, and nothing that points at people asking for help.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/$", disallow: ["/request/", "/app/", "/platform", "/invite/", "/onboarding", "/auth/"] }],
    host: siteUrl(),
  };
}
