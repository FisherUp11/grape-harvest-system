import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/cron/daily/route";

test("每日任务鉴权、未配置邮件、发送与去重（网络全部模拟，不发送邮件）", async (t) => {
  const original = globalThis.fetch;
  const names = [
    "CRON_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "NEXT_PUBLIC_SITE_URL",
    "ENABLE_MONTHLY_REPORT_EMAIL",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  t.after(() => {
    globalThis.fetch = original;
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  process.env.CRON_SECRET = "test-secret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  delete process.env.RESEND_API_KEY;
  delete process.env.MAIL_FROM;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.ENABLE_MONTHLY_REPORT_EMAIL;
  let sent = 0;
  let delivered = false;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    const url = String(input);
    if (url.includes("api.resend.com")) {
      sent++;
      assert.ok(new Headers(init?.headers).get("Idempotency-Key"));
      return new Response(JSON.stringify({ id: "mail-1" }), { status: 200 });
    }
    if (url.includes("/profiles"))
      return new Response(
        JSON.stringify([
          {
            id: "u",
            org_id: "o",
            display_name: "测试用户",
            email: "test@example.invalid",
          },
        ]),
      );
    if (url.includes("/grape_user_balances"))
      return new Response(
        JSON.stringify([
          { owner_id: "u", grape_balance: 10, grape_alert_threshold: 20 },
        ]),
      );
    if (url.includes("/notification_deliveries") && init?.method === "POST") {
      delivered = true;
      return new Response(null, { status: 201 });
    }
    if (url.includes("/notification_deliveries"))
      return new Response(
        JSON.stringify(delivered ? [{ sent_at: "2026-10-17" }] : []),
      );
    throw new Error(`Unexpected request: ${url}`);
  };
  const unauthorized = await GET(
    new Request("http://localhost/api/cron/daily"),
  );
  assert.equal(unauthorized.status, 401);
  assert.equal(calls, 0);
  const request = () =>
    new Request("http://localhost/api/cron/daily", {
      headers: { authorization: "Bearer test-secret" },
    });
  const checkOnly = await GET(request());
  assert.equal(checkOnly.status, 200);
  assert.equal((await checkOnly.json()).email, "not_configured");
  assert.equal(sent, 0);
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.MAIL_FROM = "test@example.invalid";
  process.env.NEXT_PUBLIC_SITE_URL = "https://example.invalid";
  const mail = await GET(request());
  assert.equal(mail.status, 200);
  assert.equal((await mail.json()).sent, 1);
  assert.equal(sent, 1);
  const retry = await GET(request());
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).skipped, 1);
  assert.equal(sent, 1);
});
