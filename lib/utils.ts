import type { BudgetStatus, Cycle, Profile, Supporter } from "./types";

export function formatGrapes(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 颗`;
}

export function toDateInput(date?: Date) {
  if (!date)
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
    }).format(new Date());
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: toDateInput(start), end: toDateInput(end) };
}

export function currentMonth() {
  const [year, month] = toDateInput().split("-").map(Number);
  return { year, month };
}

export function roleLabel(role: string | null | undefined) {
  return role === "super_admin"
    ? "葡萄总园主"
    : role === "grape_keeper"
      ? "农场管家"
      : "记录者";
}

export function profileName(
  profile?: Pick<Profile, "display_name" | "email"> | null,
) {
  return profile?.display_name || profile?.email || "未命名用户";
}

export function supporterName(supporter?: Pick<Supporter, "name"> | null) {
  return supporter?.name || "未关联支持者";
}

export function cycleLabel(cycle?: Cycle | null) {
  const map: Record<Cycle, string> = {
    monthly: "每月",
    quarterly: "每季度",
    half_yearly: "每半年",
    yearly: "每年",
  };
  return cycle ? map[cycle] : "一次性";
}

export function receiptMethodLabel(method: string) {
  const map: Record<string, string> = {
    cash: "现金",
    wechat: "微信",
    alipay: "支付宝",
    bank: "银行卡",
    other: "其他",
  };
  return map[method] ?? method;
}

export function consumptionTypeLabel(type: string) {
  const map: Record<string, string> = {
    fixed: "固定吃葡萄",
    project: "项目吃葡萄",
    one_time: "一次性吃葡萄",
  };
  return map[type] ?? type;
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: "草稿",
    returned: "已退回，可修改",
    pending: "待农场管家确认",
    confirmed: "已确认",
    active: "进行中",
    completed: "已完成",
    stopped: "已停止",
    cancelled: "已取消",
    not_received: "未收到",
    overdue: "已逾期",
    pending_confirmation: "待葡萄管家确认",
  };
  return map[status] ?? status;
}

export function budgetStatusLabel(status: BudgetStatus | string) {
  const map: Record<string, string> = {
    draft: "草稿编写中",
    pending_confirmation: "待葡萄管家确认",
    confirmed: "已确认生效",
    revision_requested: "已申请修正，待解除锁定",
    revision_unlocked: "已退回，可修改",
    revision_pending_confirmation: "修正待重新确认",
  };
  return map[status] ?? status;
}

export function budgetStatusBadgeClass(status: BudgetStatus | string) {
  if (status === "confirmed") return "ok";
  if (status === "draft" || status === "revision_unlocked") return "warn";
  return "";
}

export function budgetHealth(usedPct: number): "ok" | "warn" | "danger" {
  if (usedPct >= 100) return "danger";
  if (usedPct >= 80) return "warn";
  return "ok";
}

export function formatPercent(value: number) {
  if (!isFinite(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

export function addCycle(date: Date, cycle: Cycle | null, count: number) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  const months =
    cycle === "quarterly"
      ? 3
      : cycle === "half_yearly"
        ? 6
        : cycle === "yearly"
          ? 12
          : 1;
  next.setMonth(next.getMonth() + count * months);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

export function errorMessage(error: unknown, fallback = "操作失败，请重试。") {
  return error && typeof error === "object" && "message" in error
    ? String(error.message)
    : fallback;
}

export function periodStatus(period: {
  status: string;
  expected_date: string;
}) {
  return period.status === "not_received" &&
    period.expected_date < toDateInput()
    ? "overdue"
    : period.status;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const escape = (value: string) => {
    const raw = String(value ?? "");
    // 用户输入以公式字符开头时，避免电子表格执行为公式；负数金额仍按数值导出。
    const safe = /^[\s]*[=+@\t\r]|^[\s]*-(?!\d+(?:\.\d+)?$)/.test(raw)
      ? `'${raw}`
      : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function safeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard",
) {
  if (!value?.startsWith("/")) return fallback;
  const url = new URL(value, "https://local.invalid");
  return url.origin === "https://local.invalid"
    ? url.pathname + url.search + url.hash
    : fallback;
}

export function auditActionLabel(action: string) {
  const [table, operation] = action.split(":");
  const entity: Record<string, string> = {
    budget_plans: "预算表",
    budget_categories: "预算科目",
    grape_receipts: "收葡萄",
    grape_consumptions: "吃葡萄",
    commitments: "承诺",
    supporters: "支持者",
    record_corrections: "更正单",
    organizations: "农场",
    account: "账号",
  };
  const verb: Record<string, string> = {
    insert: "新增",
    update: "更新",
    delete: "删除",
    archived: "作废",
    assigned: "分配",
    bootstrap_super_admin: "初始化总园主",
  };
  return entity[table] && verb[operation]
    ? verb[operation] + entity[table]
    : action;
}
