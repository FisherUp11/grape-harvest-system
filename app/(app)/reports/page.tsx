import ReportsClient from "./ReportsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchCommitmentPeriods, fetchConsumptions, fetchProfiles, fetchReceipts, fetchSupporters } from "@/lib/data";

export default async function ReportsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, supporters, periods, receipts, consumptions] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchSupporters(supabase, profile),
    fetchCommitmentPeriods(supabase, profile),
    fetchReceipts(supabase, profile),
    fetchConsumptions(supabase, profile),
  ]);
  return <ReportsClient profile={profile} profiles={profiles} supporters={supporters} periods={periods} receipts={receipts} consumptions={consumptions} />;
}
