"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { monthlyTotals } from "@/lib/report";
import RecordTable from "@/app/components/RecordTable";
import type {
  CommitmentPeriod,
  GrapeConsumption,
  GrapeReceipt,
  Profile,
  Supporter,
} from "@/lib/types";
import {
  consumptionTypeLabel,
  currentMonth,
  downloadCsv,
  formatGrapes,
  formatDateTime,
  monthRange,
  profileName,
  receiptMethodLabel,
  supporterName,
} from "@/lib/utils";

type Props = {
  generatedAt: string;
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  periods: CommitmentPeriod[];
  receipts: GrapeReceipt[];
  consumptions: GrapeConsumption[];
};

export default function ReportsClient({
  generatedAt,
  profile,
  profiles,
  supporters,
  periods,
  receipts,
  consumptions,
}: Props) {
  const now = currentMonth();
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState(
    `${now.year}-${String(now.month).padStart(2, "0")}`,
  );
  const [year, month] = period.split("-");
  const requestedOwner = searchParams.get("owner");
  const [ownerId, setOwnerId] = useState(
    profile.role !== "user"
      ? profiles.find((p) => p.id === requestedOwner)?.id ||
          profiles[0]?.id ||
          profile.id
      : profile.id,
  );
  const selectedProfile = profiles.find((p) => p.id === ownerId) || profile;
  const { start, end } = monthRange(Number(year), Number(month));
  const supporterMap = useMemo(
    () => Object.fromEntries(supporters.map((s) => [s.id, s])),
    [supporters],
  );
  const {
    monthReceipts,
    monthConsumptions,
    received: receivedTotal,
    consumed: consumedTotal,
    opening,
    closing,
    current: balance,
  } = monthlyTotals(receipts, consumptions, ownerId, start, end);
  const expected = periods.filter(
    (p) =>
      p.owner_id === ownerId &&
      p.expected_date >= start &&
      p.expected_date <= end,
  );
  const expectedTotal = expected.reduce(
    (s, p) => s + Number(p.expected_grapes),
    0,
  );
  const missedTotal = expected
    .filter((p) => ["not_received", "overdue"].includes(p.status))
    .reduce((s, p) => s + Number(p.expected_grapes), 0);

  const exportCsv = () => {
    downloadCsv(
      `月度葡萄报告_${profileName(selectedProfile)}_${year}-${month.padStart(2, "0")}.csv`,
      [
        ["报告月份", `${year}-${month.padStart(2, "0")}`],
        ["用户", profileName(selectedProfile)],
        ["本月收葡萄", String(receivedTotal)],
        ["本月吃葡萄", String(consumedTotal)],
        ["月初葡萄存量", String(opening)],
        ["月末葡萄存量", String(closing)],
        ["当前葡萄存量", String(balance)],
        [],
        ["收葡萄日期", "支持者", "方式", "葡萄数", "备注"],
        ...monthReceipts.map((r) => [
          r.received_date,
          supporterName(r.supporter_id ? supporterMap[r.supporter_id] : null),
          receiptMethodLabel(r.receipt_method),
          String(r.grape_amount),
          r.notes || "",
        ]),
        [],
        ["吃葡萄日期", "类型", "葡萄数", "说明"],
        ...monthConsumptions.map((c) => [
          c.consumption_date,
          consumptionTypeLabel(c.consumption_type),
          String(c.grape_amount),
          c.description,
        ]),
      ],
    );
  };

  return (
    <>
      <header className="page-header no-print">
        <div className="page-title">
          <p className="eyebrow">MONTHLY SCROLL</p>
          <h1>月度葡萄报告</h1>
          <p>
            生成单用户月度报告。点击“打印 / 保存
            PDF”后，在浏览器打印面板选择“保存为 PDF”。
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={exportCsv}>
            导出 CSV
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            打印 / 保存 PDF
          </button>
        </div>
      </header>
      <section className="card no-print" style={{ marginBottom: 18 }}>
        <div className="form-grid">
          <label className="field">
            <span>报告月份</span>
            <input
              className="input"
              type="month"
              min="2000-01"
              max="2100-12"
              value={period}
              onChange={(e) => {
                if (
                  /^\d{4}-\d{2}$/.test(e.target.value) &&
                  e.target.value >= "2000-01" &&
                  e.target.value <= "2100-12"
                )
                  setPeriod(e.target.value);
              }}
            />
          </label>
          {profile.role !== "user" && (
            <label className="field">
              <span>用户</span>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {profileName(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>
      <section className="card">
        <div className="print-only">
          <h1>收葡萄系统 · 月度葡萄报告</h1>
        </div>
        <div className="page-title">
          <p className="eyebrow">
            {year} 年 {month} 月
          </p>
          <h2>{profileName(selectedProfile)} 的葡萄报告</h2>
          <p>生成时间：{formatDateTime(generatedAt)}</p>
        </div>
        <div className="grid grid-4" style={{ margin: "22px 0" }}>
          <div className="card metric">
            <div className="metric-label">本月已确认收葡萄</div>
            <div className="metric-value">{formatGrapes(receivedTotal)}</div>
          </div>
          <div className="card metric">
            <div className="metric-label">本月已确认吃葡萄</div>
            <div className="metric-value">{formatGrapes(consumedTotal)}</div>
          </div>
          <div className="card metric">
            <div className="metric-label">月末葡萄存量</div>
            <div className="metric-value">{formatGrapes(closing)}</div>
            <div className="metric-note">月初 {formatGrapes(opening)}</div>
          </div>
          <div className="card metric">
            <div className="metric-label">承诺未收到</div>
            <div className="metric-value">{formatGrapes(missedTotal)}</div>
            <div className="metric-note">
              预计 {formatGrapes(expectedTotal)}
            </div>
          </div>
        </div>
        <p className="muted">
          月末存量按所选月份截止日计算；当前存量为 {formatGrapes(balance)}
          。报告只计算已确认收支。
        </p>
        <h2>收葡萄明细</h2>
        <RecordTable
          headings={["日期", "支持者", "方式", "葡萄数", "备注"]}
          rows={monthReceipts.map((r) => ({
            id: r.id,
            cells: [
              r.received_date,
              supporterName(
                r.supporter_id ? supporterMap[r.supporter_id] : null,
              ),
              receiptMethodLabel(r.receipt_method),
              formatGrapes(r.grape_amount),
              r.notes || "—",
            ],
          }))}
          empty="本月暂无已确认收葡萄。"
        />
        <h2 style={{ marginTop: 24 }}>吃葡萄明细</h2>
        <RecordTable
          headings={["日期", "类型", "葡萄数", "说明"]}
          rows={monthConsumptions.map((c) => ({
            id: c.id,
            cells: [
              c.consumption_date,
              consumptionTypeLabel(c.consumption_type),
              formatGrapes(c.grape_amount),
              c.description,
            ],
          }))}
          empty="本月暂无已确认吃葡萄。"
        />
      </section>
    </>
  );
}
