import SettingsClient from "./SettingsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchProfiles } from "@/lib/data";

export default async function SettingsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const profiles = await fetchProfiles(supabase, profile);
  return <SettingsClient profile={profile} profiles={profiles} />;
}
