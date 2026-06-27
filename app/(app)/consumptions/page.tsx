import ConsumptionsClient from "./ConsumptionsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchConsumptions, fetchProfiles } from "@/lib/data";

export default async function ConsumptionsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, consumptions] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchConsumptions(supabase, profile),
  ]);
  return <ConsumptionsClient profile={profile} profiles={profiles} consumptions={consumptions} />;
}
