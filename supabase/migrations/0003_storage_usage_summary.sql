-- 收葡萄系统 · 迁移脚本 0003
-- 新增：Supabase Storage 图床用量统计函数（供葡萄管家在设置页查看容量占用百分比）
-- 使用方式：在 Supabase SQL Editor 中新建 Query，完整粘贴执行一次。
-- 本脚本设计为可重复执行（幂等），重复运行不会报错。

-- =========================================================
-- 1. 图床用量统计函数
-- =========================================================
-- security definer：以函数所有者（执行本脚本的角色，通常是 postgres）权限运行，
-- 绕过 storage.objects 的 RLS/授权依赖；函数内部显式校验 is_grape_keeper()，
-- 确保只有葡萄管家角色调用时才能拿到非空结果，普通用户调用会得到空结果集。
create or replace function public.get_storage_usage_summary()
returns table(bucket_id text, object_count bigint, total_bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, count(*)::bigint as object_count, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes
  from storage.objects o
  where public.is_grape_keeper()
  group by o.bucket_id
$$;

grant execute on function public.get_storage_usage_summary() to authenticated;

-- =========================================================
-- 完成。用葡萄管家账号登录网页后，在“设置”页即可看到图床用量卡片。
-- 若想在 SQL Editor 里手工验证，请注意：直接以超级用户身份执行
--   select * from public.get_storage_usage_summary();
-- 会因为此时 auth.uid() 为空、is_grape_keeper() 判定为 false 而返回 0 行，这是预期行为，
-- 并不代表函数有误，只有通过应用内已登录的葡萄管家账号发起请求才会返回真实统计。
-- =========================================================
