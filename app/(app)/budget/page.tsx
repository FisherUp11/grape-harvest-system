import BudgetClient from "./BudgetClient";
import { getAppContext } from "@/lib/supabase/server";
import { fetchBudgetCategoryUsage, fetchBudgetPlanAuditLogs, fetchBudgetPlans, fetchProfiles } from "@/lib/data";

export default async function BudgetPage() {
  const { supabase, profile } = await getAppContext();
  if (!profile) return null;
  const [profiles, plans, usage] = await Promise.all([
    fetchProfiles(supabase, profile),
    fetchBudgetPlans(supabase, profile),
    fetchBudgetCategoryUsage(supabase, profile),
  ]);
  const auditLogs = await fetchBudgetPlanAuditLogs(supabase, plans.map((p) => p.id));
  return <BudgetClient profile={profile} profiles={profiles} plans={plans} usage={usage} auditLogs={auditLogs} />;
}
