import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authDestination,
  passwordErrorMessage,
  updatePasswordForAccount,
} from "../lib/passwordFlow";
test("重置成功目标绑定已验证账号，不接受站外跳转", () => {
  assert.equal(
    authDestination("/reset-password", "new-account"),
    "/reset-password?flow=recovery&account=new-account",
  );
  assert.equal(
    authDestination("/dashboard", "new-account", true),
    "/reset-password?flow=recovery&account=new-account",
  );
  assert.equal(authDestination("//evil.invalid", "new-account"), "/dashboard");
});
test("写入前重新核验身份，阻止旧会话或账号切换导致改错密码", async () => {
  let updates = 0;
  const auth = {
    getUser: async () => ({ data: { user: { id: "other" } }, error: null }),
    updateUser: async () => {
      updates++;
      return { data: { user: { id: "other" } }, error: null };
    },
  };
  await assert.rejects(
    updatePasswordForAccount(auth as never, "intended", "fixture-new-password"),
    (e: { code?: string }) => e.code === "account_changed",
  );
  assert.equal(updates, 0);
  auth.getUser = async () => ({
    data: { user: { id: "intended" } },
    error: null,
  });
  auth.updateUser = async () => {
    updates++;
    return { data: { user: { id: "intended" } }, error: null };
  };
  await updatePasswordForAccount(
    auth as never,
    "intended",
    "fixture-new-password",
  );
  assert.equal(updates, 1);
});
test("Auth拒绝或网络异常不得当作成功；错误提示不回显密码或供应商原始正文", async () => {
  const secret = "fixture-only-do-not-echo";
  const auth = {
    getUser: async () => ({ data: { user: { id: "u" } }, error: null }),
    updateUser: async () => ({
      data: { user: null },
      error: { code: "weak_password", message: secret },
    }),
  };
  await assert.rejects(updatePasswordForAccount(auth as never, "u", secret));
  assert.match(
    passwordErrorMessage({ code: "weak_password", message: secret }),
    /安全规则/,
  );
  assert.ok(!passwordErrorMessage(new Error(secret)).includes(secret));
  assert.match(
    passwordErrorMessage({ code: "same_password" }),
    /不能与当前密码相同/,
  );
  assert.match(
    passwordErrorMessage({ code: "reauthentication_needed" }),
    /重新验证/,
  );
});
