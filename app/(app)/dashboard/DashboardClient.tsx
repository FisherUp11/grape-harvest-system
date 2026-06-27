"use client";

import Link from "next/link";
import type { CommitmentPeriod, GrapeConsumption, GrapeReceipt, Profile, Supporter } from "@/lib/types";
import { currentMonth, formatGrapes, monthRange, profileName, statusLabel, supporterName } from "@/lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  periods: CommitmentPeriod[];
  receipts: GrapeReceipt[];
  consumptions: GrapeConsumption[];
};

export default function DashboardClient({ profile, profiles, supporters, periods, receipts, consumptions }: Props) {
  const { year, month } = currentMonth();
  const { start, end } = monthRange(year, month);
  const confirmedReceipts = receipts.filter((r) => r.status === "confirmed");
  const confirmedConsumptions = consumptions.filter((c) => c.status === "confirmed");
  const balance = confirmedReceipts.reduce((sum, r) => sum + Number(r.grape_amount), 0) - confirmedConsumptions.reduce((sum, c) => sum + Number(c.grape_amount), 0);
  const monthReceived = confirmedReceipts.filter((r) => r.received_date >= start && r.received_date <= end).reduce((sum, r) => sum + Number(r.grape_amount), 0);
  const monthConsumed = confirmedConsumptions.filter((c) => c.consumption_date >= start && c.consumption_date <= end).reduce((sum, c) => sum + Number(c.grape_amount), 0);
  const pendingCount = receipts.filter((r) => r.status === "pending").length + consumptions.filter((c) => c.status === "pending").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = periods.filter((p) => ["not_received", "overdue"].includes(p.status) && p.expected_date < today);
  const supporterMap = Object.fromEntries(supporters.map((s) => [s.id, s]));
  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
  const threshold = Number(profile.grape_alert_threshold ?? 0);
  const isLow = threshold > 0 && balance < threshold;

  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">GRAPE COMMAND CENTER</p>
          <h1>庄园仪表盘</h1>
          <p>用一个页面查看葡萄存量、本月收葡萄、吃葡萄、待确认事项和逾期承诺。</p>
        </div>
        <div className="btn-row no-print">
          <Link className="btn btn-secondary" href="/commitments">新增承诺</Link>
          <Link className="btn btn-primary" href="/receipts">记录收葡萄</Link>
        </div>
      </header>

      {isLow && <div className="notice" style={{ marginBottom: 18 }}>葡萄存量低于提醒阈值：当前 {formatGrapes(balance)}，阈值 {formatGrapes(threshold)}。</div>}

      <section className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="card metric"><div className="metric-label">当前葡萄存量</div><div className="metric-value">{formatGrapes(balance)}</div><div className="metric-note">仅计算已确认记录</div></div>
        <div className="card metric"><div className="metric-label">本月已确认收葡萄</div><div className="metric-value">{formatGrapes(monthReceived)}</div><div className="metric-note">{year} 年 {month} 月</div></div>
        <div className="card metric"><div className="metric-label">本月已确认吃葡萄</div><div className="metric-value">{formatGrapes(monthConsumed)}</div><div className="metric-note">固定与临时合计</div></div>
        <div className="card metric"><div className="metric-label">待葡萄管家确认</div><div className="metric-value">{pendingCount}</div><div className="metric-note">收葡萄 + 吃葡萄</div></div>
      </section>

      <section className="grid grid-2">
        <div className="card">
          <h2>逾期 / 未收到期次</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>预计日期</th><th>用户</th><th>支持者</th><th>预计葡萄</th><th>状态</th></tr></thead>
              <tbody>
                {overdue.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>{p.expected_date}</td>
                    <td>{profileName(profileMap[p.owner_id])}</td>
                    <td>{supporterName(supporterMap[p.supporter_id])}</td>
                    <td>{formatGrapes(p.expected_grapes)}</td>
                    <td><span className="badge danger">{statusLabel(p.status)}</span></td>
                  </tr>
                ))}
                {overdue.length === 0 && <tr><td colSpan={5} className="empty">暂时没有逾期承诺。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>最近已确认收葡萄</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>用户</th><th>支持者</th><th>葡萄数</th></tr></thead>
              <tbody>
                {confirmedReceipts.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td>{r.received_date}</td>
                    <td>{profileName(profileMap[r.owner_id])}</td>
                    <td>{supporterName(r.supporter_id ? supporterMap[r.supporter_id] : null)}</td>
                    <td>{formatGrapes(r.grape_amount)}</td>
                  </tr>
                ))}
                {confirmedReceipts.length === 0 && <tr><td colSpan={4} className="empty">还没有已确认的收葡萄记录。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
