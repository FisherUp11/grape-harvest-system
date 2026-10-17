import type { GrapeConsumption, GrapeReceipt } from "./types";

// 所有汇总先转为整数分，避免小数相加产生浮点误差。
export function sumGrapes(rows: { grape_amount: number }[]) {
  return (
    rows.reduce(
      (sum, row) => sum + Math.round(Number(row.grape_amount) * 100),
      0,
    ) / 100
  );
}
export function monthlyTotals(
  receipts: GrapeReceipt[],
  consumptions: GrapeConsumption[],
  owner: string,
  start: string,
  end: string,
) {
  const incoming = receipts.filter(
    (r) => r.owner_id === owner && r.status === "confirmed",
  );
  const outgoing = consumptions.filter(
    (c) => c.owner_id === owner && c.status === "confirmed",
  );
  const monthReceipts = incoming.filter(
    (r) => r.received_date >= start && r.received_date <= end,
  );
  const monthConsumptions = outgoing.filter(
    (c) => c.consumption_date >= start && c.consumption_date <= end,
  );
  const opening =
    sumGrapes(incoming.filter((r) => r.received_date < start)) -
    sumGrapes(outgoing.filter((c) => c.consumption_date < start));
  const received = sumGrapes(monthReceipts);
  const consumed = sumGrapes(monthConsumptions);
  return {
    monthReceipts,
    monthConsumptions,
    opening: Math.round(opening * 100) / 100,
    received,
    consumed,
    closing: Math.round((opening + received - consumed) * 100) / 100,
    current:
      Math.round((sumGrapes(incoming) - sumGrapes(outgoing)) * 100) / 100,
  };
}
