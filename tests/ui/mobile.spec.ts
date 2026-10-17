import { test, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";
function sessionFor(role = "user") {
  const user = {
    id:
      role === "super_admin"
        ? "10000000-0000-0000-0000-000000000004"
        : role === "grape_keeper"
          ? "10000000-0000-0000-0000-000000000003"
          : "10000000-0000-0000-0000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: "test@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        exp,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
  return {
    access_token: token,
    refresh_token: "test-refresh-token",
    expires_at: exp,
    expires_in: 86400,
    token_type: "bearer",
    user,
  };
}

test.beforeEach(async ({ context, request }) => {
  await request.get("http://127.0.0.1:54399/__reset");
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(JSON.stringify(sessionFor())).toString("base64url"),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
});
async function noOverflow(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBeTruthy();
}

test("手机导航、卡片明细、修改收款和支持者资料", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "我的葡萄总览" }),
  ).toBeVisible();
  await noOverflow(page);
  await page
    .getByRole("navigation", { name: "常用功能" })
    .getByRole("link", { name: "收葡萄", exact: true })
    .click();
  await page.waitForURL("**/receipts");
  await page.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByLabel("实际收到葡萄数").fill("1280.50");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "草稿已保存" }),
  ).toBeVisible();
  await expect(page.getByText("1,280.5 颗")).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "全部功能" }).click();
  await page
    .getByRole("navigation", { name: "全部功能" })
    .getByRole("link", { name: "支持者", exact: true })
    .click();
  await page.getByRole("button", { name: "修改资料" }).click();
  await page.getByLabel("备注（选填）").fill("手机上修改的备注");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("资料已更新");
  await expect(
    page.getByRole("cell", { name: "手机上修改的备注" }),
  ).toBeVisible();
  await noOverflow(page);
});

test("手机压缩预览、支出上传、空间更新与统计失败提示", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/consumptions");
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 3400;
    canvas.height = 4400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 3400, 4400);
    ctx.fillStyle = "#222";
    ctx.font = "50px sans-serif";
    for (let i = 0; i < 55; i++)
      ctx.fillText(
        `凭证 RECEIPT ${i}  日期 2026-10-17  葡萄数 1280.50`,
        100,
        120 + i * 72,
      );
    return canvas.toDataURL("image/jpeg", 1).split(",")[1];
  });
  await page.locator("input[type=file]").setInputFiles({
    name: "票据.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByRole("link", { name: "放大核对文字" })).toBeVisible();
  await expect(page.getByText(/上传 .*2560/)).toBeVisible();
  await page.getByLabel("葡萄数", { exact: true }).fill("1280.50");
  await page
    .getByLabel("预算科目（必选）")
    .selectOption({ label: "项目交通 · 1,000 颗" });
  await page.getByLabel("用途说明").fill("手机上传凭证回归测试");
  await page.getByRole("button", { name: "核对并提交", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "提交成功" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "手机上传凭证回归测试" }),
  ).toBeVisible();
  await noOverflow(page);
  await expect(page.getByText("2 个文件", { exact: false })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/mobile-consumptions.png" });
  await request.get("http://127.0.0.1:54399/__storage_failure?fail=true");
  await page.getByRole("button", { name: "刷新空间用量" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "用量暂时无法读取" }),
  ).toContainText("用量暂时无法读取");
  await expect(
    page.getByRole("alert").filter({ hasText: "用量暂时无法读取" }),
  ).toContainText("上次成功读取");
  await page.screenshot({
    path: "test-results/mobile-storage-error.png",
    fullPage: true,
  });
});

test("窄屏预算、月报、设置可操作且无整页横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of ["/budget", "/commitments", "/reports", "/settings"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await noOverflow(page);
  }
});

test("电脑管家全员预警、空间占用和审批入口", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(JSON.stringify(sessionFor("grape_keeper"))).toString(
          "base64url",
        ),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "机构总览" })).toBeVisible();
  await expect(page.getByText("机构附件空间")).toBeVisible();
  await expect(page.getByText("900.0 MB")).toBeVisible();
  await expect(page.getByText("附件空间已用超过 80%")).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: "test-results/desktop-dashboard.png",
    fullPage: true,
  });
  await page.goto("/consumptions");
  await expect(
    page.getByRole("button", { name: "确认", exact: true }),
  ).toBeVisible();
});

test("总园主手机容量、业务只读与管理接口鉴权", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value:
        "base64-" +
        Buffer.from(JSON.stringify(sessionFor("super_admin"))).toString(
          "base64url",
        ),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await page.waitForURL("**/estate");
  await expect(
    page.getByRole("heading", { name: "葡萄总园主", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("42.0 MB", { exact: false })).toBeVisible();
  await expect(page.getByText("120 条", { exact: false })).toBeVisible();
  await noOverflow(page);
  const response = await page.request.post("/api/admin/accounts", {
    data: {
      action: "create",
      email: "new@example.invalid",
      role: "user",
      farm: "00000000-0000-0000-0000-000000000001",
    },
  });
  expect(response.status()).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("password");
  await page.screenshot({
    path: "test-results/mobile-estate.png",
    fullPage: true,
  });
  const backup = await page.request.get("/api/admin/export?kind=backup");
  expect(backup.status()).toBe(200);
  const exported = JSON.parse(gunzipSync(await backup.body()).toString());
  expect(exported.tables.profiles).toHaveLength(3);
  expect(Object.keys(exported.tables)).not.toContain("users");
  await page.goto("/receipts");
  await expect(
    page.getByText("总园主可查看所有农场的记录", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /^(修改|作废|确认|退回修改|核对并提交)$/,
    }),
  ).toHaveCount(0);
  await page.goto("/audit");
  await noOverflow(page);
});

test("首次改密拦截和普通用户不能管理账号", async ({ page, request }) => {
  await request.get("http://127.0.0.1:54399/__first_login");
  await page.goto("/receipts");
  await page.waitForURL("**/reset-password?required=1");
  await expect(page.getByLabel("确认新密码")).toBeVisible();
  expect(
    (
      await page.request.post("/api/admin/accounts", {
        data: { action: "create" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await page.request.get("/api/admin/export?kind=backup")).status(),
  ).toBe(403);
});

test("手机退回须原因、重新提交锁定和管家确认弹窗", async ({
  page,
  context,
}) => {
  const login = async (role: string) =>
    context.addCookies([
      {
        name: "sb-127-auth-token",
        value:
          "base64-" +
          Buffer.from(JSON.stringify(sessionFor(role))).toString("base64url"),
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await login("grape_keeper");
  await page.goto("/consumptions");
  await page.getByRole("button", { name: "退回修改", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("请填写原因");
  await page
    .getByRole("dialog")
    .getByLabel("原因（必填）")
    .fill("请核对交通金额");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已退回" }),
  ).toBeVisible();
  await login("user");
  await page.goto("/consumptions");
  await page.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByLabel("葡萄数", { exact: true }).fill("150");
  await page.getByRole("button", { name: "核对并提交", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "提交成功" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "修改", exact: true }),
  ).toHaveCount(0);
  await login("grape_keeper");
  await page.goto("/consumptions");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("不能修改原单");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "退回修改", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "操作已完成" }),
  ).toBeVisible();
  await noOverflow(page);
  await expect(
    page.getByRole("button", { name: "退回修改", exact: true }),
  ).toHaveCount(0);
});
