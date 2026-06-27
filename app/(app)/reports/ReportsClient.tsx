"use client";

import { useMemo, useState } from "react";
import type { CommitmentPeriod, GrapeConsumption, GrapeReceipt, Profile, Supporter } from "@/lib/types";
import { consumptionTypeLabel, currentMonth, downloadCsv, formatGrapes, monthRange, profileName, receiptMethodLabel, supporterName } from "@/lib/utils";

type Props = { profile: Profile; profiles: Profile[]; supporters: Supporter[]; periods: CommitmentPeriod[]; receipts: GrapeReceipt[]; consumptions: GrapeConsumption[] };

export default function ReportsClient({ profile, profiles, supporters, periods, receipts, consumptions }: Props) {
  const now = currentMonth();
  const [year, setYear] = useState(String(now.year));
  const [month, setMonth] = useState(String(now.month));
  const [ownerId, setOwnerId] = useState(profile.role === "grape_keeper" ? profiles[0]?.id || profile.id : profile.id);
  const selectedProfile = profiles.find((p) => p.id === ownerId) || profile;
  const { start, end } = monthRange(Number(year), Number(month));
  const supporterMap = useMemo(() => Object.fromEntries(supporters.map((s) => [s.id, s])), [supporters]);
  const monthReceipts = receipts.filter((r) => r.owner_id === ownerId && r.status === "confirmed" && r.received_date >= start && r.received_date <= end);
  const monthConsumptions = consumptions.filter((c) => c.owner_id === ownerId && c.status === "confirmed" && c.consumption_date >= start && c.consumption_date <= end);
  const allConfirmedReceipts = receipts.filter((r) => r.owner_id === ownerId && r.status === "confirmed");
  const allConfirmedConsumptions = consumptions.filter((c) => c.owner_id === ownerId && c.status === "confirmed");
  const balance = allConfirmedReceipts.reduce((s, r) => s + Number(r.grape_amount), 0) - allConfirmedConsumptions.reduce((s, c) => s + Number(c.grape_amount), 0);
  const receivedTotal = monthReceipts.reduce((s, r) => s + Number(r.grape_amount), 0);
  const consumedTotal = monthConsumptions.reduce((s, c) => s + Number(c.grape_amount), 0);
  const expected = periods.filter((p) => p.owner_id === ownerId && p.expected_date >= start && p.expected_date <= end);
  const expectedTotal = expected.reduce((s, p) => s + Number(p.expected_grapes), 0);
  const missedTotal = expected.filter((p) => ["not_received", "overdue"].includes(p.status)).reduce((s, p) => s + Number(p.expected_grapes), 0);

  const exportCsv = () => {
    downloadCsv(`月度葡萄报告_${profileName(selectedProfile)}_${year}-${month.padStart(2, "0")}.csv`, [
      ["报告月份", `${year}-${month.padStart(2, "0")}`],
      ["用户", profileName(selectedProfile)],
      ["本月收葡萄", String(receivedTotal)],
      ["本月吃葡萄", String(consumedTotal)],
      ["当前葡萄存量", String(balance)],
      [],
      ["收葡萄日期", "支持者", "方式", "葡萄数", "备注"],
      ...monthReceipts.map((r) => [r.received_date, supporterName(r.supporter_id ? supporterMap[r.supporter_id] : null), receiptMethodLabel(r.receipt_method), String(r.grape_amount), r.notes || ""]),
      [],
      ["吃葡萄日期", "类型", "葡萄数", "说明"],
      ...monthConsumptions.map((c) => [c.consumption_date, consumptionTypeLabel(c.consumption_type), String(c.grape_amount), c.description]),
    ]);
  };

  return (
    <>
      <header className="page-header no-print"><div className="page-title"><p className="eyebrow">MONTHLY SCROLL</p><h1>月度葡萄报告</h1><p>生成单用户月度报告。点击“打印 / 保存 PDF”后，在浏览器打印面板选择“保存为 PDF”。</p></div><div className="btn-row"><button className="btn btn-secondary" onClick={exportCsv}>导出 CSV</button><button className="btn btn-primary" onClick={() => window.print()}>打印 / 保存 PDF</button></div></header>
      <section className="card no-print" style={{ marginBottom: 18 }}><div className="form-grid"><div className="field"><label>年份</label><input className="input" type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div><div className="field"><label>月份</label><input className="input" type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} /></div>{profile.role === "grape_keeper" && <div className="field"><label>用户</label><select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{profileName(p)}</option>)}</select></div>}</div></section>
      <section className="card">
        <div className="print-only"><h1>收葡萄系统 · 月度葡萄报告</h1></div>
        <div className="page-title"><p className="eyebrow">{year} 年 {month} 月</p><h1>{profileName(selectedProfile)} 的葡萄报告</h1><p>生成时间：{new Date().toLocaleString("zh-CN")}</p></div>
        <div className="grid grid-4" style={{ margin: "22px 0" }}><div className="card metric"><div className="metric-label">本月已确认收葡萄</div><div className="metric-value">{formatGrapes(receivedTotal)}</div></div><div className="card metric"><div className="metric-label">本月已确认吃葡萄</div><div className="metric-value">{formatGrapes(consumedTotal)}</div></div><div className="card metric"><div className="metric-label">当前葡萄存量</div><div className="metric-value">{formatGrapes(balance)}</div></div><div className="card metric"><div className="metric-label">承诺未收到</div><div className="metric-value">{formatGrapes(missedTotal)}</div><div className="metric-note">预计 {formatGrapes(expectedTotal)}</div></div></div>
        <h2>收葡萄明细</h2><div className="table-wrap"><table><thead><tr><th>日期</th><th>支持者</th><th>方式</th><th>葡萄数</th><th>备注</th></tr></thead><tbody>{monthReceipts.map((r) => <tr key={r.id}><td>{r.received_date}</td><td>{supporterName(r.supporter_id ? supporterMap[r.supporter_id] : null)}</td><td>{receiptMethodLabel(r.receipt_method)}</td><td>{formatGrapes(r.grape_amount)}</td><td>{r.notes}</td></tr>)}{monthReceipts.length === 0 && <tr><td colSpan={5} className="empty">本月暂无已确认收葡萄。</td></tr>}</tbody></table></div>
        <h2 style={{ marginTop: 24 }}>吃葡萄明细</h2><div className="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>葡萄数</th><th>说明</th></tr></thead><tbody>{monthConsumptions.map((c) => <tr key={c.id}><td>{c.consumption_date}</td><td>{consumptionTypeLabel(c.consumption_type)}</td><td>{formatGrapes(c.grape_amount)}</td><td>{c.description}</td></tr>)}{monthConsumptions.length === 0 && <tr><td colSpan={4} className="empty">本月暂无已确认吃葡萄。</td></tr>}</tbody></table></div>
      </section>
    </>
  );
}
