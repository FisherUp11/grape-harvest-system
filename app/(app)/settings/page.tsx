import { redirect } from "next/navigation";
import SettingsClient from "./SettingsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchProfiles } from "@/lib/data";

export default async function SettingsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  if (profile.role === "super_admin") redirect("/estate");
  const profiles = await fetchProfiles(supabase, profile);
  const email = Boolean(
    process.env.RESEND_API_KEY &&
      process.env.MAIL_FROM &&
      process.env.NEXT_PUBLIC_SITE_URL,
  );
  return (
    <SettingsClient
      profile={profile}
      profiles={profiles}
      jobs={{
        dailyJob: Boolean(
          process.env.CRON_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY,
        ),
        email,
        monthlyReports:
          email && process.env.ENABLE_MONTHLY_REPORT_EMAIL === "true",
      }}
    />
  );
}
