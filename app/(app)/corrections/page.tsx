import { getAppContext } from "@/lib/supabase/server";
import {
  fetchCorrections,
  fetchProfiles,
  fetchReceipts,
  fetchConsumptions,
} from "@/lib/data";
import CorrectionsClient from "./CorrectionsClient";
export default async function CorrectionsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [corrections, profiles, receipts, consumptions] = await Promise.all([
    fetchCorrections(supabase),
    fetchProfiles(supabase, profile),
    fetchReceipts(supabase, profile),
    fetchConsumptions(supabase, profile),
  ]);
  return (
    <CorrectionsClient
      profile={profile}
      profiles={profiles}
      corrections={corrections}
      receipts={receipts}
      consumptions={consumptions}
    />
  );
}
