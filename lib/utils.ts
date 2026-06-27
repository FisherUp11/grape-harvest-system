import type { Cycle, Profile, Supporter } from "./types";

export function formatGrapes(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} 颗`;
}

export function toDateInput(date = new Date()) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

export function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: toDateInput(start), end: toDateInput(end) };
}

export function currentMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function roleLabel(role: string | null | undefined) {
  return role === "grape_keeper" ? "葡萄管家" : "记录者";
}

export function profileName(profile?: Pick<Profile, "display_name" | "email"> | null) {
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
    pending: "待葡萄管家确认",
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

export function addCycle(date: Date, cycle: Cycle | null, count: number) {
  const next = new Date(date);
  if (!cycle || cycle === "monthly") next.setMonth(next.getMonth() + count);
  if (cycle === "quarterly") next.setMonth(next.getMonth() + count * 3);
  if (cycle === "half_yearly") next.setMonth(next.getMonth() + count * 6);
  if (cycle === "yearly") next.setFullYear(next.getFullYear() + count);
  return next;
}

export function downloadCsv(filename: string, rows: string[][]) {
  const escape = (value: string) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = rows.map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
