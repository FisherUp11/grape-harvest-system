"use client";
import LedgerClient from "@/app/components/LedgerClient";
import RecurringConsumptionPanel from "@/app/components/RecurringConsumptionPanel";
import type {
  BudgetPlan,
  ConsumptionAttachment,
  GrapeConsumption,
  Profile,
  BudgetCategory,
  RecurringConsumptionPlan,
} from "@/lib/types";
export default function ConsumptionsClient({
  profile,
  profiles,
  consumptions,
  confirmedBudgetPlans,
  attachments,
  recurringPlans,
}: {
  profile: Profile;
  profiles: Profile[];
  consumptions: GrapeConsumption[];
  confirmedBudgetPlans: BudgetPlan[];
  categories: BudgetCategory[];
  attachments: ConsumptionAttachment[];
  recurringPlans: RecurringConsumptionPlan[];
}) {
  return (
    <LedgerClient
      kind="consumption"
      profile={profile}
      profiles={profiles}
      rows={consumptions}
      plans={confirmedBudgetPlans}
      attachments={attachments}
      beforeForm={
        <RecurringConsumptionPanel
          profile={profile}
          profiles={profiles}
          plans={recurringPlans}
          categories={confirmedBudgetPlans.flatMap(
            (p) => p.budget_categories || [],
          )}
        />
      }
    />
  );
}
