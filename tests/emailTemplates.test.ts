import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountWelcomeEmail,
  passwordRecoveryEmail,
} from "../lib/server/emailTemplates";
import { isSameOriginRequest } from "../lib/server/requestOrigin";
import { authDestination } from "../lib/passwordFlow";

test("账号邮件使用配置的域名，安全转义邮箱和密码，并提供纯文本版本", () => {
  const mail = accountWelcomeEmail({
    email: "new+<tag>@example.invalid",
    password: 'A<&"secret',
    loginUrl: "https://gr.fisherai6.top/login",
  });
  assert.ok(mail.html.includes('href="https://gr.fisherai6.top/login"'));
  assert.ok(mail.html.includes("new+&lt;tag&gt;@example.invalid"));
  assert.ok(mail.html.includes("A&lt;&amp;&quot;secret"));
  assert.ok(!mail.html.includes("<tag>"));
  assert.ok(mail.text.includes('A<&"secret'));
  assert.ok(mail.text.includes("首次登录必须修改密码"));
  assert.throws(() =>
    accountWelcomeEmail({
      email: "a@example.invalid",
      password: "test",
      loginUrl: "javascript:alert(1)",
    }),
  );
});

test("可粘贴的 Supabase 模板与生成器一致，链接指向现有 recovery 回调且绑定正确账号", () => {
  const html = readFileSync(
    new URL("../supabase/templates/recovery.html", import.meta.url),
    "utf8",
  );
  assert.equal(html, passwordRecoveryEmail());
  const populated = html
    .replaceAll("{{ .SiteURL }}", "https://gr.fisherai6.top")
    .replaceAll("{{ .TokenHash }}", "fixture-token-hash")
    .replaceAll("{{ .Email }}", "new@example.invalid");
  const link = populated
    .match(/href="([^"]*token_hash=[^"]*)"/)![1]
    .replaceAll("&amp;", "&");
  const url = new URL(link);
  assert.equal(url.pathname, "/auth/callback");
  assert.equal(url.searchParams.get("token_hash"), "fixture-token-hash");
  assert.equal(url.searchParams.get("type"), "recovery");
  assert.equal(
    authDestination(url.searchParams.get("next"), "verified-user", true),
    "/reset-password?flow=recovery&account=verified-user",
  );
  assert.ok(!populated.includes("le.fisherai6.top"));
});

test("自定义域名经过代理时允许同源账号请求，拒绝外站、不同协议和无效来源", () => {
  const request = (origin: string) =>
    new Request("http://internal:3000/api/admin/accounts", {
      headers: {
        origin,
        "x-forwarded-host": "gr.fisherai6.top",
        "x-forwarded-proto": "https",
      },
    });
  assert.equal(isSameOriginRequest(request("https://gr.fisherai6.top")), true);
  for (const origin of [
    "https://evil.invalid",
    "https://gr.fisherai6.top.evil.invalid",
    "http://gr.fisherai6.top",
    "null",
    "not-a-url",
  ])
    assert.equal(isSameOriginRequest(request(origin)), false);
  assert.equal(
    isSameOriginRequest(
      new Request("https://gr.fisherai6.top/api/admin/accounts", {
        headers: { origin: "https://gr.fisherai6.top" },
      }),
    ),
    true,
  );
});
