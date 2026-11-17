import type { Metadata } from "next";
import { ActionForm, Field, SubmitButton, TextAreaField } from "@/components/action-form";
import { Alert, Card } from "@/components/ui";
import { canManageStaff, requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateChurchProfileAction } from "./actions";

export const metadata: Metadata = { title: "Church profile" };

type Profile = {
  name: string;
  area: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  emergency_guidance: string | null;
};

export default async function ChurchProfilePage() {
  const { membership } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("churches")
    .select("name, area, contact_phone, contact_email, emergency_guidance")
    .eq("id", membership.church.id)
    .single();
  const editable = canManageStaff(membership.role);

  if (error || !data) {
    return <Alert tone="error">The church details could not be loaded. Refresh the page to try again.</Alert>;
  }
  const profile = data as Profile;

  return (
    <Card>
      <h2 className="text-lg font-bold text-charcoal">Church profile</h2>
      <p className="mt-1 mb-5 text-sm text-muted">
        These details appear on your public request page. Only owners and administrators can change them.
      </p>
      <ActionForm action={updateChurchProfileAction} className="space-y-5">
        <fieldset disabled={!editable} className="space-y-5">
          <Field name="name" label="Church name" defaultValue={profile.name} maxLength={120} required />
          <Field name="area" label="Town or area" defaultValue={profile.area ?? ""} maxLength={120} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              name="contactPhone"
              label="Public phone number"
              hint="Shown on the request page."
              type="tel"
              defaultValue={profile.contact_phone ?? ""}
              maxLength={40}
            />
            <Field
              name="contactEmail"
              label="Contact email (not shown publicly)"
              type="email"
              defaultValue={profile.contact_email ?? ""}
              maxLength={254}
            />
          </div>
          <TextAreaField
            name="emergencyGuidance"
            label="Emergency guidance"
            hint="Shown at the top of your request page. Say who people should contact in an emergency, for example local emergency numbers or a pastor on call. If left empty, a general message is shown."
            defaultValue={profile.emergency_guidance ?? ""}
            maxLength={1000}
            rows={4}
          />
          {editable ? <SubmitButton pendingLabel="Saving…">Save details</SubmitButton> : null}
        </fieldset>
      </ActionForm>
    </Card>
  );
}
