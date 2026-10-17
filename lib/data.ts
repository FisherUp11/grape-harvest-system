import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuditLog,
  BudgetCategory,
  BudgetCategoryUsage,
  BudgetPlan,
  Commitment,
  CommitmentPeriod,
  ConsumptionAttachment,
  GrapeConsumption,
  GrapeReceipt,
  Profile,
  Supporter,
} from "./types";

type RowsQuery = PromiseLike<{
  data: unknown[] | null;
  error: { message: string } | null;
}> & { range: (from: number, to: number) => RowsQuery };
// Supabase 默认返回行数有上限，分批取数避免余额与月报只统计前 1000 条。
export async function readRows<T>(
  query: RowsQuery,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw new Error(`${label}读取失败：${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 500) return rows;
  }
}

export async function fetchProfiles(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("profiles")
    .select(
      "id,org_id,role,display_name,email,monthly_fixed_consumption,grape_alert_threshold,must_change_password,onboarding_delivery_status,created_at",
    )
    .order("display_name")
    .order("id");
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  return readRows<Profile>(query, "用户资料");
}

export async function fetchSupporters(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("supporters")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<Supporter>(query.order("id"), "支持者");
}

export async function fetchCommitments(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("commitments")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<Commitment>(query.order("id"), "承诺");
}

export async function fetchCommitmentPeriods(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("commitment_periods")
    .select("*")
    .order("expected_date", { ascending: true });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  const periods = await readRows<CommitmentPeriod>(
    query.order("id"),
    "承诺期次",
  );
  const corrections = await readRows<import("./types").RecordCorrection>(
    supabase
      .from("record_corrections")
      .select("*")
      .eq("target_table", "grape_receipts")
      .eq("status", "confirmed")
      .order("id"),
    "承诺更正",
  );
  return periods.map((p) => ({
    ...p,
    actual_grapes:
      p.actual_grapes == null
        ? null
        : Math.round(
            (Number(p.actual_grapes) +
              corrections
                .filter((c) => c.target_id === p.actual_receipt_id)
                .reduce((sum, c) => sum + Number(c.amount_delta), 0)) *
              100,
          ) / 100,
  }));
}

export async function fetchReceipts(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("grape_receipts")
    .select("*")
    .is("deleted_at", null)
    .order("received_date", { ascending: false });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<GrapeReceipt>(query.order("id"), "收葡萄");
}

export async function fetchConsumptions(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("grape_consumptions")
    .select("*")
    .is("deleted_at", null)
    .order("consumption_date", { ascending: false });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<GrapeConsumption>(query.order("id"), "吃葡萄");
}

export async function fetchConsumptionAttachments(
  supabase: SupabaseClient,
  profile: Profile,
  consumptionIds?: string[],
) {
  let query = supabase
    .from("grape_consumption_attachments")
    .select("*")
    .order("created_at", { ascending: true });
  if (profile.role !== "super_admin")
    query = query.eq("org_id", profile.org_id);
  if (profile.role === "user") query = query.eq("owner_id", profile.id);
  if (consumptionIds?.length === 0) return [] as ConsumptionAttachment[];
  // 归属与机构由 RLS 和查询限定；避免把数千个 ID 拼进请求 URL。
  return readRows<ConsumptionAttachment>(query.order("id"), "凭证");
}

export async function fetchBudgetPlans(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("budget_plans")
    .select("*, budget_categories(*)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  const plans = await readRows<BudgetPlan>(query.order("id"), "预算");
  return plans.map((p) => ({
    ...p,
    budget_categories: p.budget_categories?.filter((c) => !c.deleted_at),
  }));
}

export async function fetchAllBudgetCategories(
  supabase: SupabaseClient,
  profile: Profile,
) {
  // 用于在吃葡萄明细中展示科目名称：普通用户仅能读到自己的科目（RLS 限定），葡萄管家可读到全组织。
  const query = supabase
    .from("budget_categories")
    .select("*")
    .is("deleted_at", null);
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<BudgetCategory>(query.order("id"), "预算科目");
}

export async function fetchBudgetCategoryUsage(
  supabase: SupabaseClient,
  profile: Profile,
) {
  const query = supabase
    .from("budget_category_usage")
    .select("*")
    .order("sort_order", { ascending: true });
  if (profile.role !== "super_admin") query.eq("org_id", profile.org_id);
  if (profile.role === "user") query.eq("owner_id", profile.id);
  return readRows<BudgetCategoryUsage>(query.order("category_id"), "预算执行");
}

export async function fetchBudgetPlanAuditLogs(
  supabase: SupabaseClient,
  planIds: string[],
) {
  if (planIds.length === 0) return [] as AuditLog[];
  const query = supabase
    .from("audit_logs")
    .select("*")
    .eq("entity_table", "budget_plans")
    .order("created_at", { ascending: false })
    .order("id")
    .limit(100);
  const { data, error } = await query;
  if (error) throw new Error(`预算历史读取失败：${error.message}`);
  return (data || []) as AuditLog[];
}

export async function fetchFarms(supabase: SupabaseClient) {
  return readRows<import("./types").Farm>(
    supabase.from("organizations").select("*").order("created_at").order("id"),
    "葡萄农场",
  );
}
export async function fetchCorrections(supabase: SupabaseClient) {
  return readRows<import("./types").RecordCorrection>(
    supabase
      .from("record_corrections")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id"),
    "更正单",
  );
}
export async function fetchReceiptLedger(supabase: SupabaseClient) {
  return readRows<GrapeReceipt>(
    supabase
      .from("ledger_receipts")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id"),
    "收葡萄台账",
  );
}
export async function fetchConsumptionLedger(supabase: SupabaseClient) {
  return readRows<GrapeConsumption>(
    supabase
      .from("ledger_consumptions")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id"),
    "吃葡萄台账",
  );
}
