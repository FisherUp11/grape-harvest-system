export type Role = "user" | "grape_keeper" | "super_admin";

export type Profile = {
  id: string;
  org_id: string | null;
  role: Role;
  must_change_password?: boolean;
  onboarding_delivery_status?: "not_required" | "pending" | "sent" | "failed";
  display_name: string | null;
  email: string | null;
  monthly_fixed_consumption: number | null;
  grape_alert_threshold: number | null;
  created_at?: string;
  organizations?: { name: string; fixed_requires_approval?: boolean } | null;
};

export type Supporter = {
  id: string;
  org_id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  support_type: "one_time" | "recurring";
  cycle: Cycle | null;
  status: "active" | "paused" | "stopped";
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type Cycle = "monthly" | "quarterly" | "half_yearly" | "yearly";
export type CommitmentStatus = "active" | "completed" | "stopped" | "cancelled";
export type PeriodStatus =
  | "not_received"
  | "overdue"
  | "pending_confirmation"
  | "confirmed"
  | "stopped"
  | "cancelled";
export type ReceiptStatus = "draft" | "pending" | "returned" | "confirmed";
export type ConsumptionStatus = ReceiptStatus;

export type Commitment = {
  id: string;
  org_id: string;
  owner_id: string;
  supporter_id: string;
  commitment_type: "one_time" | "recurring";
  grape_amount: number;
  cycle: Cycle | null;
  start_date: string;
  end_date: string | null;
  total_periods: number;
  expected_day: number | null;
  total_grapes: number;
  status: CommitmentStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CommitmentPeriod = {
  id: string;
  org_id: string;
  owner_id: string;
  commitment_id: string;
  supporter_id: string;
  period_no: number;
  expected_date: string;
  expected_grapes: number;
  actual_receipt_id: string | null;
  actual_grapes: number | null;
  status: PeriodStatus;
  received_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  stopped_at: string | null;
  notes: string | null;
  created_at: string;
};

export type WorkflowFields = {
  deleted_at?: string | null;
  return_reason?: string | null;
  auto_confirmed?: boolean;
  revision_number?: number;
  is_correction?: boolean;
};

export type GrapeReceipt = WorkflowFields & {
  id: string;
  org_id: string;
  owner_id: string;
  supporter_id: string | null;
  commitment_id: string | null;
  commitment_period_id: string | null;
  received_date: string;
  grape_amount: number;
  receipt_method: "cash" | "wechat" | "alipay" | "bank" | "other";
  source_type: "one_time" | "commitment";
  status: ReceiptStatus;
  notes: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GrapeConsumption = WorkflowFields & {
  id: string;
  org_id: string;
  owner_id: string;
  consumption_date: string;
  grape_amount: number;
  consumption_type: "fixed" | "project" | "one_time";
  description: string;
  budget_category_id: string | null;
  status: ConsumptionStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  attachments_ready?: boolean;
  recurring_plan_id?: string | null;
  scheduled_for?: string | null;
};

export type ConsumptionAttachment = {
  id: string;
  org_id: string;
  consumption_id: string;
  owner_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  is_permanent?: boolean;
};

export type RecurringConsumptionPlan = {
  id: string;
  org_id: string;
  owner_id: string;
  description: string;
  grape_amount: number;
  start_date: string;
  end_date: string;
  day_of_month: number;
  budget_category_id: string | null;
  next_date: string | null;
  status: "active" | "stopped" | "completed";
  generated_count: number;
  last_generated_date: string | null;
  last_error: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
};

export type BudgetStatus =
  | "draft"
  | "pending_confirmation"
  | "confirmed"
  | "revision_requested"
  | "revision_unlocked"
  | "revision_pending_confirmation";

export type BudgetPlan = {
  id: string;
  org_id: string;
  owner_id: string;
  title: string;
  period_start: string;
  period_end: string;
  status: BudgetStatus;
  version: number;
  notes: string | null;
  submitted_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  unlocked_by: string | null;
  unlocked_at: string | null;
  created_at: string;
  updated_at: string;
  budget_categories?: BudgetCategory[];
  return_reason?: string | null;
  supersedes_id?: string | null;
};

export type BudgetCategory = WorkflowFields & {
  id: string;
  org_id: string;
  budget_plan_id: string;
  owner_id: string;
  name: string;
  budgeted_amount: number;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BudgetCategoryUsage = {
  category_id: string;
  budget_plan_id: string;
  owner_id: string;
  org_id: string;
  plan_status: BudgetStatus;
  period_start: string;
  period_end: string;
  category_name: string;
  budgeted_amount: number;
  sort_order: number;
  confirmed_consumed: number;
  pending_consumed: number;
};

export type AuditLog = {
  id: string;
  org_id: string;
  actor_id: string | null;
  action: string;
  entity_table: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
};

export type StorageUsageBucket = {
  bucket_id: string;
  object_count: number;
  total_bytes: number;
};

export type Dictionary<T> = Record<string, T>;

export type Farm = {
  id: string;
  name: string;
  fixed_requires_approval: boolean;
  created_at?: string;
};
export type RecordCorrection = WorkflowFields & {
  id: string;
  org_id: string;
  owner_id: string;
  target_table: "grape_receipts" | "grape_consumptions";
  target_id: string;
  previous_amount: number;
  replacement_amount: number;
  amount_delta: number;
  correction_date: string;
  reason: string;
  status: ReceiptStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
};
export type EstateCapacity = {
  database_bytes: number;
  audit_bytes: number;
  audit_count: number;
  storage_bytes: number;
  storage_count: number;
  measured_at: string;
  farms: {
    id: string;
    name: string;
    user_count: number;
    keeper_count: number;
    pending_count: number;
    storage_bytes: number;
  }[];
};
