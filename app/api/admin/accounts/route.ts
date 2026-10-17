import { NextResponse } from "next/server";
import { processAccountRequest } from "@/lib/server/onboarding";
import { requireEstateOwner, createServiceClient } from "@/lib/server/admin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  let context;
  try {
    context = await requireEstateOwner();
  } catch {
    return NextResponse.json({ error: "无权管理账号" }, { status: 403 });
  }
  if (
    request.headers.get("origin") &&
    new URL(request.url).origin !== request.headers.get("origin")
  )
    return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 });
  if (
    !process.env.RESEND_API_KEY ||
    !process.env.MAIL_FROM ||
    !process.env.NEXT_PUBLIC_SITE_URL
  )
    return NextResponse.json(
      {
        error: "请先配置发件服务、MAIL_FROM 和站点地址；本次未创建或重置账号。",
      },
      { status: 503 },
    );
  let service;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "缺少账号管理服务端密钥；本次未创建或重置账号。" },
      { status: 503 },
    );
  }
  return processAccountRequest(request, context.supabase, service);
}
