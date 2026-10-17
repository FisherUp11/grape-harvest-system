import ReportsClient from "./ReportsClient";
import { getAppContext } from "@/lib/supabase/server";
import {
  fetchCommitmentPeriods,
  fetchConsumptionLedger,
  fetchProfiles,
  fetchReceiptLedger,
  fetchSupporters,
} from "@/lib/data";

export default async function ReportsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, supporters, periods, receipts, consumptions] =
    await Promise.all([
      fetchProfiles(supabase, profile),
      fetchSupporters(supabase, profile),
      fetchCommitmentPeriods(supabase, profile),
      fetchReceiptLedger(supabase),
      fetchConsumptionLedger(supabase),
    ]);
  return (
    <ReportsClient
      generatedAt={new Date().toISOString()}
      profile={profile}
      profiles={profiles}
      supporters={supporters}
      periods={periods}
      receipts={receipts}
      consumptions={consumptions}
    />
  );
}
