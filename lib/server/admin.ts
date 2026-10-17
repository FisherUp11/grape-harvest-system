import { createClient } from "@supabase/supabase-js";
import { getSessionContext } from "@/lib/supabase/server";
export async function requireEstateOwner() {
  const context = await getSessionContext();
  if (
    !context.profile ||
    context.profile.must_change_password ||
    context.profile.role !== "super_admin"
  )
    throw new Error("只有完成首次改密的葡萄总园主可以执行此操作");
  return context;
}
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error("尚未配置 SUPABASE_SERVICE_ROLE_KEY，不能创建或重发账号。");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
