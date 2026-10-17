import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { getAppContext } from "@/lib/supabase/server";
import {
  fetchBudgetPlans,
  fetchCommitmentPeriods,
  fetchConsumptionLedger,
  fetchProfiles,
  fetchReceiptLedger,
  fetchSupporters,
} from "@/lib/data";

export default async function DashboardPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  if (profile.role === "super_admin") redirect("/estate");

  const [profiles, supporters, periods, receipts, consumptions, budgetPlans] =
    await Promise.all([
      fetchProfiles(supabase, profile),
      fetchSupporters(supabase, profile),
      fetchCommitmentPeriods(supabase, profile),
      fetchReceiptLedger(supabase),
      fetchConsumptionLedger(supabase),
      fetchBudgetPlans(supabase, profile),
    ]);

  return (
    <DashboardClient
      budgetPlans={budgetPlans}
      profile={profile}
      profiles={profiles}
      supporters={supporters}
      periods={periods}
      receipts={receipts}
      consumptions={consumptions}
    />
  );
}
