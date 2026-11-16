"use client";

import { useState } from "react";
import { Field } from "@/components/action-form";
import { slugify } from "@/lib/validation";

// Suggests the public link name from the church name until the person edits it.
export function ChurchFields({ siteHost }: { siteHost: string }) {
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  return (
    <>
      <Field
        name="name"
        label="Church name"
        autoComplete="organization"
        maxLength={120}
        required
        onChange={(e) => {
          if (!slugEdited) setSlug(slugify(e.target.value));
        }}
      />
      <Field
        name="slug"
        label="Public link name"
        value={slug}
        maxLength={60}
        autoCapitalize="none"
        spellCheck={false}
        required
        hint={`People will ask for help at ${siteHost}/request/${slug || "your-church"}. This cannot be changed later without contacting us.`}
        onChange={(e) => {
          setSlugEdited(true);
          setSlug(e.target.value.toLowerCase());
        }}
      />
      <Field name="area" label="Town or area (optional)" maxLength={120} autoComplete="address-level2" />
    </>
  );
}
