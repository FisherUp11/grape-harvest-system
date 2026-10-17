import { test } from "node:test";
import assert from "node:assert/strict";
import { addCycle, monthRange, safeRedirectPath } from "../lib/utils";
import { monthlyTotals, sumGrapes } from "../lib/report";
import { readRows } from "../lib/data";
import type { GrapeReceipt, GrapeConsumption } from "../lib/types";

test("月报使用月末余额，排除未确认与未来月份；金额按分累计", () => {
  const receipts = [
    {
      owner_id: "u",
      status: "confirmed",
      received_date: "2026-09-01",
      grape_amount: 100,
    },
    {
      owner_id: "u",
      status: "confirmed",
      received_date: "2026-10-01",
      grape_amount: 0.1,
    },
    {
      owner_id: "u",
      status: "confirmed",
      received_date: "2026-10-02",
      grape_amount: 0.2,
    },
    {
      owner_id: "u",
      status: "pending",
      received_date: "2026-10-03",
      grape_amount: 999,
    },
    {
      owner_id: "u",
      status: "confirmed",
      received_date: "2026-11-01",
      grape_amount: 1000,
    },
    {
      owner_id: "other",
      status: "confirmed",
      received_date: "2026-10-01",
      grape_amount: 9999,
    },
  ] as GrapeReceipt[];
  const consumptions = [
    {
      owner_id: "u",
      status: "confirmed",
      consumption_date: "2026-10-17",
      grape_amount: 20,
    },
  ] as GrapeConsumption[];
  const result = monthlyTotals(
    receipts,
    consumptions,
    "u",
    "2026-10-01",
    "2026-10-31",
  );
  assert.equal(result.opening, 100);
  assert.equal(result.received, 0.3);
  assert.equal(result.closing, 80.3);
  assert.equal(result.current, 1080.3);
  assert.equal(sumGrapes([{ grape_amount: 0.1 }, { grape_amount: 0.2 }]), 0.3);
});
test("周期运算处理月末与闰年", () => {
  const jan = new Date(2026, 0, 31);
  const feb = addCycle(jan, "monthly", 1);
  assert.equal(feb.getMonth(), 1);
  assert.equal(feb.getDate(), 28);
  assert.equal(jan.getDate(), 31);
  assert.equal(addCycle(new Date(2024, 1, 29), "yearly", 1).getDate(), 28);
  assert.deepEqual(monthRange(2024, 2), {
    start: "2024-02-01",
    end: "2024-02-29",
  });
});
test("登录返回地址只允许本站路径", () => {
  for (const url of [
    "//evil.test",
    "/\\evil.test",
    "https://evil.test",
    "javascript:alert(1)",
    "",
  ])
    assert.equal(safeRedirectPath(url), "/dashboard");
  assert.equal(
    safeRedirectPath("/receipts?state=pending"),
    "/receipts?state=pending",
  );
});
test("超过默认返回上限的数据完整读取；失败不能伪装成空数据", async () => {
  const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const pages: number[] = [];
  const query = {
    range(from: number, to: number) {
      pages.push(from);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    },
  };
  assert.equal((await readRows(query as never, "测试")).length, 1201);
  assert.deepEqual(pages, [0, 500, 1000]);
  await assert.rejects(
    readRows(
      {
        range: () =>
          Promise.resolve({ data: null, error: { message: "连接失败" } }),
      } as never,
      "记录",
    ),
    /读取失败/,
  );
});
