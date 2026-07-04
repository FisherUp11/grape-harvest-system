import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLog, BudgetCategory, BudgetCategoryUsage, BudgetPlan, Commitment, CommitmentPeriod, ConsumptionAttachment, GrapeConsumption, GrapeReceipt, Profile, StorageUsageBucket, Supporter } from "./types";

export async function fetchProfiles(supabase: SupabaseClient, profile: Profile) {
  // RLS 已限定：普通用户只能读到自己 + 同组织葡萄管家；葡萄管家可读到全组织。
  const { data } = await supabase
    .from("profiles")
    .select("id, org_id, role, display_name, email, monthly_fixed_consumption, grape_alert_threshold, created_at")
    .eq("org_id", profile.org_id)
    .order("display_name", { ascending: true });
  return (data ?? []) as Profile[];
}

export async function fetchSupporters(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("supporters")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("updated_at", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as Supporter[];
}

export async function fetchCommitments(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("commitments")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as Commitment[];
}

export async function fetchCommitmentPeriods(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("commitment_periods")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("expected_date", { ascending: true });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as CommitmentPeriod[];
}

export async function fetchReceipts(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("grape_receipts")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("received_date", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as GrapeReceipt[];
}

export async function fetchConsumptions(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("grape_consumptions")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("consumption_date", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as GrapeConsumption[];
}

export async function fetchConsumptionAttachments(supabase: SupabaseClient, profile: Profile, consumptionIds?: string[]) {
  let query = supabase
    .from("grape_consumption_attachments")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: true });
  if (profile.role !== "grape_keeper") query = query.eq("owner_id", profile.id);
  if (consumptionIds && consumptionIds.length > 0) query = query.in("consumption_id", consumptionIds);
  const { data } = await query;
  return (data ?? []) as ConsumptionAttachment[];
}

export async function fetchBudgetPlans(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("budget_plans")
    .select("*, budget_categories(*)")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: false });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as BudgetPlan[];
}

export async function fetchAllBudgetCategories(supabase: SupabaseClient, profile: Profile) {
  // 用于在吃葡萄明细中展示科目名称：普通用户仅能读到自己的科目（RLS 限定），葡萄管家可读到全组织。
  const query = supabase
    .from("budget_categories")
    .select("*")
    .eq("org_id", profile.org_id);
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as BudgetCategory[];
}

export async function fetchBudgetCategoryUsage(supabase: SupabaseClient, profile: Profile) {
  const query = supabase
    .from("budget_category_usage")
    .select("*")
    .eq("org_id", profile.org_id)
    .order("sort_order", { ascending: true });
  if (profile.role !== "grape_keeper") query.eq("owner_id", profile.id);
  const { data } = await query;
  return (data ?? []) as BudgetCategoryUsage[];
}

export async function fetchBudgetPlanAuditLogs(supabase: SupabaseClient, planIds: string[]) {
  if (planIds.length === 0) return [] as AuditLog[];
  const { data } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_table", "budget_plans")
    .in("entity_id", planIds)
    .order("created_at", { ascending: false });
  return (data ?? []) as AuditLog[];
}

export async function fetchStorageUsage(supabase: SupabaseClient, profile: Profile) {
  // 仅葡萄管家需要看到图床用量；普通用户直接返回空数组，避免多余的 RPC 请求。
  // 数据库函数内部也会再次校验 is_grape_keeper()，双重保障。
  if (profile.role !== "grape_keeper") return [] as StorageUsageBucket[];
  const { data, error } = await supabase.rpc("get_storage_usage_summary");
  if (error) {
    console.error("fetchStorageUsage error:", error.message);
    return [] as StorageUsageBucket[];
  }
  return (data ?? []) as StorageUsageBucket[];
}
