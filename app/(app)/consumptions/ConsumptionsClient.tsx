"use client";
import LedgerClient from "@/app/components/LedgerClient";
import type {
  BudgetPlan,
  ConsumptionAttachment,
  GrapeConsumption,
  Profile,
  BudgetCategory,
} from "@/lib/types";
export default function ConsumptionsClient({
  profile,
  profiles,
  consumptions,
  confirmedBudgetPlans,
  attachments,
}: {
  profile: Profile;
  profiles: Profile[];
  consumptions: GrapeConsumption[];
  confirmedBudgetPlans: BudgetPlan[];
  categories: BudgetCategory[];
  attachments: ConsumptionAttachment[];
}) {
  return (
    <LedgerClient
      kind="consumption"
      profile={profile}
      profiles={profiles}
      rows={consumptions}
      plans={confirmedBudgetPlans}
      attachments={attachments}
    />
  );
}
