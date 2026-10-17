"use client";
import Link from "next/link";
import type {
  BudgetPlan,
  CommitmentPeriod,
  GrapeConsumption,
  GrapeReceipt,
  Profile,
  Supporter,
} from "@/lib/types";
import {
  currentMonth,
  formatGrapes,
  monthRange,
  periodStatus,
  profileName,
  supporterName,
} from "@/lib/utils";
import { sumGrapes } from "@/lib/report";
import RecordTable from "@/app/components/RecordTable";
import StorageUsage from "@/app/components/StorageUsage";

type Props = {
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  periods: CommitmentPeriod[];
  receipts: GrapeReceipt[];
  consumptions: GrapeConsumption[];
  budgetPlans: BudgetPlan[];
};
export default function DashboardClient({
  profile,
  profiles,
  supporters,
  periods,
  receipts,
  consumptions,
  budgetPlans,
}: Props) {
  const keeper = profile.role === "grape_keeper";
  const { year, month } = currentMonth();
  const { start, end } = monthRange(year, month);
  const confirmedReceipts = receipts.filter((r) => r.status === "confirmed");
  const confirmedConsumptions = consumptions.filter(
    (c) => c.status === "confirmed",
  );
  const balance =
    Math.round(
      (sumGrapes(confirmedReceipts) - sumGrapes(confirmedConsumptions)) * 100,
    ) / 100;
  const monthReceived = sumGrapes(
    confirmedReceipts.filter(
      (r) => r.received_date >= start && r.received_date <= end,
    ),
  );
  const monthConsumed = sumGrapes(
    confirmedConsumptions.filter(
      (c) => c.consumption_date >= start && c.consumption_date <= end,
    ),
  );
  const pendingReceipts = receipts.filter((r) => r.status === "pending").length;
  const pendingConsumptions = consumptions.filter(
    (c) => c.status === "pending",
  ).length;
  const pendingBudgets = budgetPlans.filter((b) =>
    [
      "pending_confirmation",
      "revision_pending_confirmation",
      "revision_requested",
    ].includes(b.status),
  ).length;
  const overdue = periods.filter((p) => periodStatus(p) === "overdue");
  const supporterMap = Object.fromEntries(supporters.map((s) => [s.id, s]));
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const atRisk = profiles
    .filter((p) => keeper || p.id === profile.id)
    .map((p) => ({
      profile: p,
      balance:
        Math.round(
          (sumGrapes(confirmedReceipts.filter((r) => r.owner_id === p.id)) -
            sumGrapes(
              confirmedConsumptions.filter((c) => c.owner_id === p.id),
            )) *
            100,
        ) / 100,
    }))
    .filter(
      (row) =>
        Number(row.profile.grape_alert_threshold) > 0 &&
        row.balance < Number(row.profile.grape_alert_threshold),
    );
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">
            {keeper ? "ORGANIZATION OVERVIEW" : "MY GRAPE LEDGER"}
          </p>
          <h1>{keeper ? "机构总览" : "我的葡萄总览"}</h1>
          <p>
            {keeper
              ? "查看本机构全员收支、待确认事项与逐人存量提醒。"
              : "查看自己的收支与待办。只有已确认的记录才计入葡萄存量。"}
          </p>
        </div>
        <div className="btn-row">
          <Link className="btn btn-primary" href="/receipts">
            ＋ 记录收葡萄
          </Link>
          <Link className="btn btn-secondary" href="/consumptions">
            记录吃葡萄
          </Link>
        </div>
      </header>
      <section className="grid grid-4 dashboard-metrics">
        <div className="card metric">
          <div className="metric-label">
            {keeper ? "全员葡萄存量" : "我的葡萄存量"}
          </div>
          <div className="metric-value">{formatGrapes(balance)}</div>
          <div className="metric-note">累计已确认收 − 吃</div>
        </div>
        <div className="card metric">
          <div className="metric-label">本月已确认收葡萄</div>
          <div className="metric-value">{formatGrapes(monthReceived)}</div>
          <div className="metric-note">
            {year} 年 {month} 月
          </div>
        </div>
        <div className="card metric">
          <div className="metric-label">本月已确认吃葡萄</div>
          <div className="metric-value">{formatGrapes(monthConsumed)}</div>
          <div className="metric-note">固定与项目等合计</div>
        </div>
        <div className="card metric">
          <div className="metric-label">
            {keeper ? "待我处理" : "等待管家处理"}
          </div>
          <div className="metric-value">
            {pendingReceipts + pendingConsumptions + pendingBudgets}
          </div>
          <div className="metric-note">收支确认与预算审核</div>
        </div>
      </section>
      <section className="grid grid-2 section-space">
        <div className="card">
          <h2>{keeper ? "审核工作台" : "我的待办进度"}</h2>
          <div className="task-links">
            <Link href="/receipts?status=pending">
              待确认收葡萄 <strong>{pendingReceipts} 条 →</strong>
            </Link>
            <Link href="/consumptions?status=pending">
              待确认吃葡萄 <strong>{pendingConsumptions} 条 →</strong>
            </Link>
            <Link href="/budget">
              预算确认 / 解锁 <strong>{pendingBudgets} 份 →</strong>
            </Link>
            <Link href="/commitments?status=overdue">
              逾期承诺 <strong>{overdue.length} 期 →</strong>
            </Link>
          </div>
        </div>
        <StorageUsage isKeeper={keeper} />
      </section>
      {atRisk.length > 0 && (
        <section className="card section-space">
          <h2>存量提醒 · {atRisk.length} 位用户</h2>
          <p className="muted">每位用户按自己的余额与阈值判断。</p>
          <RecordTable
            headings={["用户", "当前存量", "提醒阈值", "操作"]}
            rows={atRisk.map((r) => ({
              id: r.profile.id,
              cells: [
                profileName(r.profile),
                <strong key="b" className="balance-warning">
                  {formatGrapes(r.balance)}
                </strong>,
                formatGrapes(r.profile.grape_alert_threshold),
                <Link
                  key="a"
                  className="btn btn-secondary"
                  href={`/reports?owner=${r.profile.id}`}
                >
                  查看月报
                </Link>,
              ],
            }))}
          />
        </section>
      )}
      <section className="card section-space">
        <div className="section-heading">
          <h2>逾期承诺</h2>
          <Link className="btn btn-secondary" href="/commitments">
            查看全部期次 →
          </Link>
        </div>
        <RecordTable
          headings={["预计日期", "用户", "支持者", "预计葡萄"]}
          rows={overdue.slice(0, 8).map((p) => ({
            id: p.id,
            cells: [
              p.expected_date,
              profileName(profileMap[p.owner_id]),
              supporterName(supporterMap[p.supporter_id]),
              formatGrapes(p.expected_grapes),
            ],
          }))}
          empty="暂无逾期承诺。"
        />
      </section>
    </>
  );
}
