import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountWelcomeEmail } from "./emailTemplates";
// 服务端入口完成身份与配置检查后调用；保持流程可用隔离 HTTP 测试验证。
export async function processAccountRequest(
  request: Request,
  supabase: SupabaseClient,
  service: SupabaseClient,
) {
  let createdId: string | undefined;
  try {
    const body = await request.json();
    if (!["create", "resend"].includes(body.action))
      return NextResponse.json({ error: "动作无效" }, { status: 400 });
    const site = new URL("/login", process.env.NEXT_PUBLIC_SITE_URL!);
    if (!["http:", "https:"].includes(site.protocol))
      throw new Error("站点地址无效");
    const password = `G7!${randomBytes(18).toString("base64url")}`;
    let id: string, email: string;
    if (body.action === "create") {
      email = String(body.email || "")
        .trim()
        .toLowerCase();
      const role = String(body.role),
        farm = role === "super_admin" ? null : body.farm;
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        !["user", "grape_keeper", "super_admin"].includes(role) ||
        String(body.name || "").length > 100
      )
        return NextResponse.json(
          { error: "请检查邮箱、名称与角色" },
          { status: 400 },
        );
      if (role !== "super_admin" && !/^[0-9a-f-]{36}$/i.test(farm || ""))
        return NextResponse.json({ error: "请选择所属农场" }, { status: 400 });
      const result = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { onboarding_nonce: randomUUID() },
      });
      if (result.error) throw result.error;
      id = result.data.user.id;
      createdId = id;
      const assign = await supabase.rpc("admin_assign_profile", {
        p_user: id,
        p_farm: farm,
        p_role: role,
        p_name: String(body.name || ""),
        p_email: email,
        p_require_change: true,
      });
      if (assign.error) {
        await service.auth.admin.deleteUser(id);
        createdId = undefined;
        throw assign.error;
      }
    } else {
      id = String(body.id || "");
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("email,must_change_password")
        .eq("id", id)
        .single();
      if (error || !profile?.email) throw new Error("账号不存在");
      if (!profile.must_change_password)
        return NextResponse.json(
          { error: "账号已完成首次改密，请使用登录页的密码重置流程。" },
          { status: 409 },
        );
      email = profile.email;
      const current = await service.auth.admin.getUserById(id);
      if (current.error) throw current.error;
      const rotated = await service.auth.admin.updateUserById(id, {
        password,
        app_metadata: {
          ...current.data.user.app_metadata,
          onboarding_nonce: randomUUID(),
        },
      });
      if (rotated.error) throw rotated.error;
    }
    const marked = await service
      .from("profiles")
      .update({
        must_change_password: true,
        onboarding_delivery_status: "pending",
      })
      .eq("id", id)
      .select("id")
      .single();
    if (marked.error) throw marked.error;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [email],
          ...accountWelcomeEmail({ email, password, loginUrl: site.href }),
        }),
      });
      if (!response.ok) throw new Error("发送失败");
      const saved = await service
        .from("profiles")
        .update({ onboarding_delivery_status: "sent" })
        .eq("id", id);
      if (saved.error) throw saved.error;
    } catch {
      await service
        .from("profiles")
        .update({ onboarding_delivery_status: "failed" })
        .eq("id", id);
      return NextResponse.json(
        {
          error:
            "账号已保留，但邮件发送未确认成功。请在账号列表重发临时密码；请勿重复创建账号。",
          userId: id,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      userId: id,
      message: "账号邮件已发送，首次登录须修改密码。",
    });
  } catch (error) {
    // 不回传密码、密钥、供应商响应或请求正文。
    const message =
      error instanceof Error ? error.message : "账号操作失败，请核对后重试";
    return NextResponse.json(
      { error: message, ...(createdId ? { userId: createdId } : {}) },
      { status: 400 },
    );
  }
}
