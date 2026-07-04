import SettingsClient from "./SettingsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchProfiles, fetchStorageUsage } from "@/lib/data";

export default async function SettingsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, storageUsage] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchStorageUsage(supabase, profile),
  ]);
  return <SettingsClient profile={profile} profiles={profiles} storageUsage={storageUsage} />;
}
