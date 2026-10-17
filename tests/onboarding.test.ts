import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { processAccountRequest } from "../lib/server/onboarding";
test("账号创建、随机临时密码、首次改密和邮件失败重试（隔离网络）", async (t) => {
  const original = globalThis.fetch;
  const keys = ["RESEND_API_KEY", "MAIL_FROM", "NEXT_PUBLIC_SITE_URL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  t.after(() => {
    globalThis.fetch = original;
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  process.env.RESEND_API_KEY = "fixture-mail";
  process.env.MAIL_FROM = "fixture@example.invalid";
  process.env.NEXT_PUBLIC_SITE_URL = "https://grape.example.invalid";
  const id = "10000000-0000-0000-0000-000000000007",
    farm = "00000000-0000-0000-0000-000000000001";
  let assignFail = false,
    mailFail = false,
    changed = false;
  let created = 0,
    deleted = 0,
    sent = 0;
  let passwords: string[] = [],
    nonces: string[] = [],
    states: string[] = [],
    assigned: Record<string, unknown>[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.includes("/auth/v1/admin/users") && method === "POST") {
      created++;
      passwords.push(body.password);
      nonces.push(body.app_metadata.onboarding_nonce);
      assert.equal(body.email_confirm, true);
      return json({ id, email: body.email });
    }
    if (url.includes("/auth/v1/admin/users/") && method === "DELETE") {
      deleted++;
      return json({ id });
    }
    if (url.includes("/auth/v1/admin/users/") && method === "PUT") {
      passwords.push(body.password);
      nonces.push(body.app_metadata.onboarding_nonce);
      assert.equal(body.app_metadata.provider, "email");
      return json({ id, email: "new@example.invalid" });
    }
    if (url.includes("/auth/v1/admin/users/"))
      return json({
        id,
        email: "new@example.invalid",
        app_metadata: { provider: "email", onboarding_nonce: nonces[0] },
      });
    if (url.includes("/rpc/admin_assign_profile")) {
      assigned.push(body);
      return assignFail
        ? json({ message: "每个农场最多配置两位管家" }, 400)
        : json(null);
    }
    if (url.includes("/rest/v1/profiles") && method === "PATCH") {
      if (body.onboarding_delivery_status)
        states.push(body.onboarding_delivery_status);
      if (body.must_change_password !== undefined)
        assert.equal(body.must_change_password, true);
      return json(
        new Headers(init?.headers).get("accept")?.includes("object")
          ? { id }
          : [{ id }],
      );
    }
    if (url.includes("/rest/v1/profiles"))
      return json({
        email: "new@example.invalid",
        must_change_password: !changed,
      });
    if (url === "https://api.resend.com/emails") {
      sent++;
      assert.ok(body.html.includes(passwords.at(-1)));
      assert.ok(body.html.includes("https://grape.example.invalid/login"));
      return json({ id: "mail-fixture" }, mailFail ? 503 : 200);
    }
    throw new Error("Unexpected isolated request: " + url);
  };
  const client = createClient("https://example.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const req = (body: unknown) =>
    new Request("https://grape.example.invalid/api/admin/accounts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  await t.test(
    "创建只通过邮件交付随机密码，不返回或写入角色审计参数",
    async () => {
      const response = await processAccountRequest(
        req({
          action: "create",
          email: " NEW@example.invalid ",
          name: "测试",
          role: "user",
          farm,
        }),
        client,
        client,
      );
      assert.equal(response.status, 200);
      assert.equal(created, 1);
      assert.equal(sent, 1);
      assert.deepEqual(states, ["pending", "sent"]);
      assert.equal(assigned[0].p_require_change, true);
      assert.equal(assigned[0].p_email, "new@example.invalid");
      assert.equal(assigned[0].p_farm, farm);
      assert.ok(passwords[0].length >= 24);
      assert.match(passwords[0], /^G7!/);
      assert.ok(nonces[0]);
      const output = JSON.stringify(await response.json());
      assert.ok(!output.includes(passwords[0]));
      assert.ok(!JSON.stringify(assigned).includes(passwords[0]));
    },
  );
  await t.test("分配失败回滚新 Auth 账号，不发送临时密码", async () => {
    assignFail = true;
    const before = sent;
    const response = await processAccountRequest(
      req({
        action: "create",
        email: "new@example.invalid",
        role: "grape_keeper",
        farm,
      }),
      client,
      client,
    );
    assert.equal(response.status, 400);
    assert.equal(deleted, 1);
    assert.equal(sent, before);
    assignFail = false;
  });
  await t.test("发送失败保留账号并明确提示重发，响应不含密码", async () => {
    mailFail = true;
    const before = deleted;
    const response = await processAccountRequest(
      req({
        action: "create",
        email: "new@example.invalid",
        role: "user",
        farm,
      }),
      client,
      client,
    );
    assert.equal(response.status, 502);
    assert.equal(deleted, before);
    assert.equal(states.at(-1), "failed");
    const result = await response.json();
    assert.equal(result.userId, id);
    assert.ok(!JSON.stringify(result).includes(passwords.at(-1)!));
    mailFail = false;
  });
  await t.test(
    "重发轮换密码和服务器 nonce，保留其他 app metadata",
    async () => {
      const before = passwords.at(-1);
      const response = await processAccountRequest(
        req({ action: "resend", id }),
        client,
        client,
      );
      assert.equal(response.status, 200);
      assert.notEqual(passwords.at(-1), before);
      assert.notEqual(nonces.at(-1), nonces[0]);
    },
  );
  await t.test("已完成首次改密的账号不能重发临时密码", async () => {
    changed = true;
    const before = passwords.length;
    assert.equal(
      (
        await processAccountRequest(
          req({ action: "resend", id }),
          client,
          client,
        )
      ).status,
      409,
    );
    assert.equal(passwords.length, before);
  });
});
