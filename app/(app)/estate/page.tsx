import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/supabase/server";
import { fetchFarms, fetchProfiles } from "@/lib/data";
import EstateClient from "./EstateClient";
export default async function EstatePage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  if (profile.role !== "super_admin") redirect("/dashboard");
  const [farms, profiles] = await Promise.all([
    fetchFarms(supabase),
    fetchProfiles(supabase, profile),
  ]);
  return (
    <EstateClient
      farms={farms}
      profiles={profiles}
      accountServiceReady={Boolean(
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
          process.env.RESEND_API_KEY &&
          process.env.MAIL_FROM &&
          process.env.NEXT_PUBLIC_SITE_URL,
      )}
    />
  );
}
