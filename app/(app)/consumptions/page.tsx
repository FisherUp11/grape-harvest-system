import ConsumptionsClient from "./ConsumptionsClient";
import { getAppContext } from "@/lib/supabase/server";
import {
  fetchBudgetPlans,
  fetchAllBudgetCategories,
  fetchConsumptionAttachments,
  fetchConsumptions,
  fetchProfiles,
} from "@/lib/data";

export default async function ConsumptionsPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, consumptions, categories] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchConsumptions(supabase, profile),
    fetchAllBudgetCategories(supabase, profile),
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
    />
  );
}
