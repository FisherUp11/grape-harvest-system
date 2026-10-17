import { test, expect, type BrowserContext } from "@playwright/test";
import { sessionFor } from "./session";
const mock = "http://127.0.0.1:54399";
async function loginAs(context: BrowserContext, role = "user") {
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(JSON.stringify(sessionFor(role))).toString("base64url"),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}
async function verifier(context: BrowserContext) {
  await context.addCookies([
    {
      name: "sb-127-auth-token-code-verifier",
      value:
        "base64-" +
        Buffer.from(JSON.stringify("fixture-verifier/recovery")).toString(
          "base64url",
        ),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}
test.beforeEach(async ({ context, request }) => {
  await request.get(mock + "/__reset");
  await loginAs(context);
});
test("失效链接与缺失PKCE验证器不能沿用旧账号改密", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/auth/callback?next=/reset-password&code=fixture-expired");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("邮件链接已失效");
  await expect(page.getByLabel("新密码", { exact: true })).toHaveCount(0);
  await verifier(context);
  await page.goto("/auth/callback?next=/reset-password&code=fixture-expired");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("邮件链接已失效");
  expect(
    await (await request.get(mock + "/__password_updates")).json(),
  ).toEqual([]);
  await page.getByRole("link", { name: "返回登录页重新申请" }).click();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
});
test("旧邮件implicit凭证覆盖旧账号，正确账号改密后新密码可登录、旧密码被拒绝", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const session = sessionFor("grape_keeper");
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    type: "recovery",
    expires_in: "86400",
    token_type: "bearer",
  }).toString();
  await page.goto("/auth/callback?next=/reset-password#" + hash);
  await expect(
    page.getByText("keeper@example.invalid", { exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain("access_token");
  await page.getByLabel("新密码", { exact: true }).fill("New-demo-pass-2!");
  await page.getByLabel("确认新密码").fill("New-demo-pass-2!");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "密码已更新" })).toBeVisible();
  expect(
    await (await request.get(mock + "/__password_updates")).json(),
  ).toEqual([{ id: session.user.id }]);
  await page.getByRole("link", { name: "使用这个邮箱重新登录" }).click();
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(
    "keeper@example.invalid",
  );
  await page.getByLabel("密码", { exact: true }).fill("Keeper-demo-pass-1!");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page.getByRole("status")).toContainText("邮箱或密码不正确");
  await page.getByLabel("密码", { exact: true }).fill("New-demo-pass-2!");
  await page.getByRole("button", { name: "进入系统" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "机构总览" })).toBeVisible();
});
test("PKCE和token_hash回调验证后绑定正确账号", async ({ page, context }) => {
  await verifier(context);
  await page.goto(
    "/auth/callback?next=/reset-password&code=fixture-valid-code",
  );
  await expect(
    page.getByText("keeper@example.invalid", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("account")).toBe(
    sessionFor("grape_keeper").user.id,
  );
  await loginAs(context);
  await page.goto("/auth/callback?token_hash=fixture-valid-hash&type=recovery");
  await expect(
    page.getByText("keeper@example.invalid", { exact: true }),
  ).toBeVisible();
});
test("错误fragment、账号不匹配和未登录均禁止改密", async ({
  page,
  context,
  request,
}) => {
  await page.goto("/reset-password#error=access_denied&error_code=otp_expired");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("邮件链接已失效");
  await expect(page.getByRole("button", { name: "保存新密码" })).toHaveCount(0);
  await page.goto(
    "/reset-password?flow=recovery&account=" +
      sessionFor("grape_keeper").user.id,
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("账号已变化");
  await expect(page.getByRole("button", { name: "保存新密码" })).toHaveCount(0);
  await context.clearCookies();
  await page.goto("/reset-password");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("没有有效");
  expect(
    await (await request.get(mock + "/__password_updates")).json(),
  ).toEqual([]);
});
test("指向首页的旧邮件也能正确恢复，错误凭证不回退旧会话", async ({ page }) => {
  const session = sessionFor("grape_keeper");
  await page.goto(
    "/dashboard#" +
      new URLSearchParams({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        type: "recovery",
      }),
  );
  await expect(
    page.getByText("keeper@example.invalid", { exact: true }),
  ).toBeVisible();
  await page.goto(
    "/auth/callback?next=/reset-password#access_token=invalid&refresh_token=invalid&type=recovery",
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("邮件链接已失效");
  await expect(page.getByRole("button", { name: "保存新密码" })).toHaveCount(0);
});
test("密码规则拒绝、两次输入不同均明确提示，失败不会显示成功", async ({
  page,
  request,
}) => {
  await page.goto("/reset-password?required=1");
  await expect(
    page.getByText("lin@example.invalid", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill("Fixture-password-2!");
  await page.getByLabel("确认新密码").fill("Fixture-password-3!");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("不一致");
  await page.getByLabel("确认新密码").fill("Fixture-password-2!");
  await request.get(mock + "/__auth_failure?code=weak_password");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /邮件链接|账号已变化|没有有效|不一致|安全规则/ }),
  ).toContainText("安全规则");
  await expect(page.getByRole("button", { name: "保存新密码" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "密码已更新" })).toHaveCount(
    0,
  );
  expect(
    await (await request.get(mock + "/__password_updates")).json(),
  ).toEqual([]);
  await request.get(mock + "/__auth_failure?code=");
  await page.getByRole("button", { name: "保存新密码" }).click();
  await expect(page.getByRole("heading", { name: "密码已更新" })).toBeVisible();
});

test("改密API拒绝账号不匹配、跨站请求及未登录，禁止直接绕过页面", async ({
  page,
  context,
  request,
}) => {
  const body = {
    account: sessionFor("grape_keeper").user.id,
    password: "Fixture-only-new-password-9!",
  };
  const mismatch = await page.request.post("/api/auth/password", {
    data: body,
  });
  expect(mismatch.status()).toBe(401);
  expect((await mismatch.json()).error).toBe("account_changed");
  expect(
    (
      await page.request.post("/api/auth/password", {
        headers: { origin: "https://other.invalid" },
        data: body,
      })
    ).status(),
  ).toBe(403);
  await context.clearCookies();
  expect(
    (await page.request.post("/api/auth/password", { data: body })).status(),
  ).toBe(401);
  expect(
    await (await request.get(mock + "/__password_updates")).json(),
  ).toEqual([]);
});
