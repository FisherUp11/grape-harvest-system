import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { readRows } from "@/lib/data";
import { monthlyTotals } from "@/lib/report";
import { formatGrapes, monthRange, profileName } from "@/lib/utils";
import type { GrapeConsumption, GrapeReceipt, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Balance = {
  owner_id: string;
  grape_balance: number;
  grape_alert_threshold: number;
};
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  const actual = Buffer.from(request.headers.get("authorization") || "");
  if (
    !secret ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "任务尚未配置数据库服务端密钥" },
      { status: 503 },
    );
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const profiles = await readRows<Profile>(
      supabase.from("profiles").select("*").order("id"),
      "任务用户",
    );
    const balances = await readRows<Balance>(
      supabase.from("grape_user_balances").select("*").order("owner_id"),
      "存量汇总",
    );
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
    }).format(new Date());
    const low = balances.filter(
      (b) =>
        Number(b.grape_alert_threshold) > 0 &&
        Number(b.grape_balance) < Number(b.grape_alert_threshold),
    );
    const emailEnabled = Boolean(
      process.env.RESEND_API_KEY &&
        process.env.MAIL_FROM &&
        process.env.NEXT_PUBLIC_SITE_URL,
    );
    if (!emailEnabled)
      return NextResponse.json({
        checked: profiles.length,
        lowBalanceUsers: low.length,
        email: "not_configured",
        sent: 0,
      });
    const base = new URL(process.env.NEXT_PUBLIC_SITE_URL!);
    if (!["https:", "http:"].includes(base.protocol))
      throw new Error("站点 URL 配置无效");
    const reportUrl = new URL("/reports", base).href;
    const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
    type Mail = {
      owner: Profile;
      kind: "low_balance" | "monthly_report";
      period: string;
      subject: string;
      html: string;
      cc?: string[];
    };
    const mails: Mail[] = [];
    for (const b of low) {
      const owner = byId[b.owner_id];
      if (!owner?.email || owner.role === "super_admin") continue;
      const cc = profiles
        .filter(
          (p) =>
            p.org_id === owner.org_id &&
            p.role === "grape_keeper" &&
            p.email &&
            p.email !== owner.email,
        )
        .map((p) => p.email!);
      mails.push({
        owner,
        kind: "low_balance",
        period: today,
        subject: "葡萄存量提醒",
        cc,
        html: `<p>${escapeHtml(profileName(owner))}，你的葡萄存量为 ${formatGrapes(b.grape_balance)}，低于提醒阈值 ${formatGrapes(b.grape_alert_threshold)}。</p><p><a href="${escapeHtml(reportUrl)}">登录查看葡萄报告</a></p>`,
      });
    }
    // 每日调度会补发当月尚未成功发送的上月摘要，无须依赖某一天刚好运行成功。
    if (process.env.ENABLE_MONTHLY_REPORT_EMAIL === "true") {
      const [year, month] = today.split("-").map(Number);
      const previous =
        month === 1
          ? { year: year - 1, month: 12 }
          : { year, month: month - 1 };
      const range = monthRange(previous.year, previous.month);
      const period = `${previous.year}-${String(previous.month).padStart(2, "0")}`;
      const [receipts, consumptions] = await Promise.all([
        readRows<GrapeReceipt>(
          supabase
            .from("ledger_receipts")
            .select("*")
            .eq("status", "confirmed")
            .lte("received_date", range.end)
            .order("id"),
          "月报收入",
        ),
        readRows<GrapeConsumption>(
          supabase
            .from("ledger_consumptions")
            .select("*")
            .eq("status", "confirmed")
            .lte("consumption_date", range.end)
            .order("id"),
          "月报支出",
        ),
      ]);
      for (const owner of profiles) {
        if (!owner.email || owner.role === "super_admin") continue;
        const totals = monthlyTotals(
          receipts,
          consumptions,
          owner.id,
          range.start,
          range.end,
        );
        mails.push({
          owner,
          kind: "monthly_report",
          period,
          subject: `${period} 月度葡萄摘要`,
          html: `<p>${escapeHtml(profileName(owner))}，${period} 的葡萄摘要：</p><ul><li>月初存量：${formatGrapes(totals.opening)}</li><li>本月收到：${formatGrapes(totals.received)}</li><li>本月吃葡萄：${formatGrapes(totals.consumed)}</li><li>月末存量：${formatGrapes(totals.closing)}</li></ul><p><a href="${escapeHtml(reportUrl)}">登录查看明细、打印或保存 PDF</a></p>`,
        });
      }
    }
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const send = async (mail: Mail) => {
      const deliveryKey = `${mail.kind}:${mail.owner.id}:${mail.period}`;
      const { data, error } = await supabase
        .from("notification_deliveries")
        .select("sent_at")
        .eq("delivery_key", deliveryKey)
        .maybeSingle();
      if (error) throw error;
      if (data?.sent_at) {
        skipped++;
        return;
      }
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": createHash("sha256")
            .update(deliveryKey)
            .digest("hex"),
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [mail.owner.email],
          ...(mail.cc?.length ? { cc: Array.from(new Set(mail.cc)) } : {}),
          subject: mail.subject,
          html: mail.html,
        }),
      });
      if (!response.ok) throw new Error(`邮件服务返回 ${response.status}`);
      const provider = (await response.json()) as { id: string };
      const { error: saveError } = await supabase
        .from("notification_deliveries")
        .upsert({
          delivery_key: deliveryKey,
          owner_id: mail.owner.id,
          kind: mail.kind,
          sent_at: new Date().toISOString(),
          provider_id: provider.id,
        });
      if (saveError) throw saveError;
      sent++;
    };
    // 限速串行发送，每秒最多 2 封；约 100 人的每日任务可在函数时限内完成。
    for (const mail of mails) {
      try {
        await send(mail);
      } catch (error) {
        failed++;
        console.error(
          "Daily mail failed",
          mail.kind,
          error instanceof Error ? error.message : "delivery error",
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
    return NextResponse.json(
      {
        checked: profiles.length,
        lowBalanceUsers: low.length,
        sent,
        skipped,
        failed,
      },
      { status: failed ? 502 : 200 },
    );
  } catch (error) {
    console.error(
      "Daily check failed",
      error instanceof Error ? error.message : "database error",
    );
    return NextResponse.json(
      { error: "每日检查失败，请检查部署日志和数据库迁移。" },
      { status: 500 },
    );
  }
}
