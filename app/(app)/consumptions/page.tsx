import ConsumptionsClient from "./ConsumptionsClient";
import { getAppContext } from "@/lib/supabase/server";
import {
  fetchBudgetPlans,
  fetchAllBudgetCategories,
  fetchConsumptionAttachments,
  fetchConsumptions,
  fetchProfiles,
  readRows,
} from "@/lib/data";
import type { RecurringConsumptionPlan } from "@/lib/types";

export default async function ConsumptionsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, consumptions, categories, recurringPlans] =
    await Promise.all([
      fetchProfiles(supabase, profile),
      fetchConsumptions(supabase, profile),
      fetchAllBudgetCategories(supabase, profile),
      readRows<RecurringConsumptionPlan>(
        supabase
          .from("recurring_consumption_plans")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id"),
        "按月固定计划",
      ),
    ]);
  const [allPlans, attachments] = await Promise.all([
    fetchBudgetPlans(supabase, profile),
    fetchConsumptionAttachments(
      supabase,
      profile,
      consumptions.map((c) => c.id),
    ),
  ]);
  return (
    <ConsumptionsClient
      profile={profile}
      profiles={profiles}
      consumptions={consumptions}
      confirmedBudgetPlans={allPlans.filter(
        (p) => p.owner_id === profile.id && p.status === "confirmed",
      )}
      categories={categories}
      attachments={attachments}
      recurringPlans={recurringPlans}
    />
  );
}
