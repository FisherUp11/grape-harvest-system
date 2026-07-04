import ConsumptionsClient from "./ConsumptionsClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchAllBudgetCategories, fetchConsumptionAttachments, fetchConsumptions, fetchProfiles } from "@/lib/data";
import type { BudgetPlan } from "@/lib/types";

export default async function ConsumptionsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, consumptions, categories] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchConsumptions(supabase, profile),
    fetchAllBudgetCategories(supabase, profile),
  ]);
  const [{ data: myBudgetPlans }, attachments] = await Promise.all([
    supabase.from("budget_plans").select("*, budget_categories(*)").eq("owner_id", profile.id).eq("status", "confirmed"),
    fetchConsumptionAttachments(supabase, profile, consumptions.map((c) => c.id)),
  ]);
  return (
    <ConsumptionsClient
      profile={profile}
      profiles={profiles}
      consumptions={consumptions}
      confirmedBudgetPlans={(myBudgetPlans ?? []) as BudgetPlan[]}
      categories={categories}
      attachments={attachments}
    />
  );
}
