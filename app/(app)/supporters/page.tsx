import SupportersClient from "./SupportersClient";
import { getAppContext } from "@/lib/supabase/server";
import {
  fetchCommitmentPeriods,
  fetchProfiles,
  fetchReceiptLedger,
  fetchSupporters,
} from "@/lib/data";

export default async function SupportersPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, supporters, receipts, periods] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchSupporters(supabase, profile),
    fetchReceiptLedger(supabase),
    fetchCommitmentPeriods(supabase, profile),
  ]);
  return (
    <SupportersClient
      profile={profile}
      profiles={profiles}
      supporters={supporters}
      receipts={receipts}
      periods={periods}
    />
  );
}
