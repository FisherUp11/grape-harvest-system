import { getAppContext } from "@/lib/supabase/server";
import { fetchProfiles } from "@/lib/data";
import AuditClient from "./AuditClient";
export default async function AuditPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const profiles = await fetchProfiles(supabase, profile);
  return <AuditClient profile={profile} profiles={profiles} />;
}
