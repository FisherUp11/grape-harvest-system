-- 收葡萄系统 · 迁移脚本 0002
-- 新增：吃葡萄预算表、预算修正审计、吃葡萄附件（图床）、期次/记录锁定加固、身份可见性收紧
-- 使用方式：在 Supabase SQL Editor 中新建 Query，完整粘贴执行一次。
-- 本脚本设计为可重复执行（幂等），重复运行不会报错。

-- =========================================================
-- 1. 新增枚举类型
-- =========================================================
do $$ begin
  create type public.budget_status as enum (
    'draft',                          -- 草稿，记录者编写中
    'pending_confirmation',           -- 已提交，等待葡萄管家确认
    'confirmed',                      -- 已确认生效
    'revision_requested',             -- 记录者已申请修正，等待管家解除锁定
    'revision_unlocked',              -- 管家已解除锁定，记录者可修改
    'revision_pending_confirmation'   -- 修正后重新提交，等待管家再次确认
  );
exception when duplicate_object then null;
end $$;

-- =========================================================
-- 2. 新增表：预算表 + 预算科目 + 吃葡萄附件
-- =========================================================
create table if not exists public.budget_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default '吃葡萄预算表',
  period_start date not null,
  period_end date not null,
  status public.budget_status not null default 'draft',
  version integer not null default 1,
  notes text,
  submitted_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  unlocked_by uuid references public.profiles(id),
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_plans_period_valid check (period_end >= period_start)
);

create table if not exists public.budget_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  budget_plan_id uuid not null references public.budget_plans(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  budgeted_amount numeric(12,2) not null default 0 check (budgeted_amount >= 0),
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.grape_consumption_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  consumption_id uuid not null references public.grape_consumptions(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size integer not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- 3. 已有表增加字段
-- =========================================================
alter table public.grape_consumptions add column if not exists budget_category_id uuid references public.budget_categories(id);
alter table public.commitment_periods add column if not exists confirmed_by uuid references public.profiles(id);

-- =========================================================
-- 4. 触发器：更新时间戳
-- =========================================================
create or replace trigger budget_plans_touch before update on public.budget_plans for each row execute function public.touch_updated_at();
create or replace trigger budget_categories_touch before update on public.budget_categories for each row execute function public.touch_updated_at();

-- =========================================================
-- 5. 触发器：期次记录确认后锁定（补齐 commitment_periods 的锁定，之前只有 receipts / consumptions 有）
-- =========================================================
create or replace function public.prevent_confirmed_period_change()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '已确认的期次记录不可修改';
  end if;
  return new;
end;
$$;

create or replace trigger commitment_periods_lock before update on public.commitment_periods for each row execute function public.prevent_confirmed_period_change();

-- =========================================================
-- 6. 触发器：预算表状态流转守卫
-- =========================================================
create or replace function public.enforce_budget_plan_transition()
returns trigger language plpgsql as $$
begin
  -- 仅葡萄管家可以将状态推进为「已确认」
  if new.status = 'confirmed' and old.status <> 'confirmed' and not public.is_grape_keeper() then
    raise exception '只有葡萄管家可以确认预算表';
  end if;

  -- 仅葡萄管家可以解除锁定（revision_requested -> revision_unlocked）
  if old.status = 'revision_requested' and new.status = 'revision_unlocked' and not public.is_grape_keeper() then
    raise exception '只有葡萄管家可以解除预算表锁定';
  end if;

  -- 记录者在「已提交/已确认/已申请修正/修正待确认」状态下，不可修改覆盖时间段与标题
  if old.status in ('pending_confirmation', 'confirmed', 'revision_requested', 'revision_pending_confirmation')
     and not public.is_grape_keeper()
     and (new.period_start <> old.period_start or new.period_end <> old.period_end or new.title <> old.title) then
    raise exception '当前预算表已锁定，不可修改，请先申请修正';
  end if;

  return new;
end;
$$;

create or replace trigger budget_plans_transition_guard before update on public.budget_plans for each row execute function public.enforce_budget_plan_transition();

-- =========================================================
-- 7. 触发器：预算科目仅在草稿 / 已解除锁定状态下可编辑
-- =========================================================
create or replace function public.enforce_budget_category_editable()
returns trigger language plpgsql as $$
declare
  plan_status public.budget_status;
  plan_owner uuid;
begin
  select status, owner_id into plan_status, plan_owner
  from public.budget_plans where id = coalesce(new.budget_plan_id, old.budget_plan_id);

  if plan_status not in ('draft', 'revision_unlocked') then
    raise exception '预算表当前不可编辑科目，请先申请修正并等待葡萄管家解除锁定';
  end if;

  if plan_owner <> auth.uid() then
    raise exception '只能编辑自己的预算科目';
  end if;

  return coalesce(new, old);
end;
$$;

create or replace trigger budget_categories_editable_guard before insert or update or delete on public.budget_categories for each row execute function public.enforce_budget_category_editable();

-- =========================================================
-- 8. 触发器：吃葡萄记录若命中已确认预算表覆盖时间段，必须选择科目
-- =========================================================
create or replace function public.enforce_consumption_budget_category()
returns trigger language plpgsql as $$
declare
  has_confirmed_budget boolean;
begin
  select exists (
    select 1 from public.budget_plans bp
    where bp.owner_id = new.owner_id
      and bp.status = 'confirmed'
      and new.consumption_date between bp.period_start and bp.period_end
  ) into has_confirmed_budget;

  if has_confirmed_budget and new.budget_category_id is null then
    raise exception '存在已确认的预算表，请选择对应科目后再提交吃葡萄记录';
  end if;

  if new.budget_category_id is not null then
    if not exists (
      select 1 from public.budget_categories bc
      join public.budget_plans bp on bp.id = bc.budget_plan_id
      where bc.id = new.budget_category_id and bp.owner_id = new.owner_id and bp.status = 'confirmed'
    ) then
      raise exception '所选科目不属于当前已确认的预算表';
    end if;
  end if;

  return new;
end;
$$;

create or replace trigger grape_consumptions_budget_guard before insert on public.grape_consumptions for each row execute function public.enforce_consumption_budget_category();

-- =========================================================
-- 9. 触发器：吃葡萄附件每条记录最多 5 个，且仅待确认记录可增删
-- =========================================================
create or replace function public.enforce_attachment_limit()
returns trigger language plpgsql as $$
declare
  cnt integer;
  consumption_status public.confirmation_status;
begin
  select status into consumption_status from public.grape_consumptions where id = new.consumption_id;
  if consumption_status = 'confirmed' then
    raise exception '已确认的吃葡萄记录不可再添加附件';
  end if;

  select count(*) into cnt from public.grape_consumption_attachments where consumption_id = new.consumption_id;
  if cnt >= 5 then
    raise exception '每条吃葡萄记录最多上传 5 个附件';
  end if;
  return new;
end;
$$;

create or replace trigger grape_consumption_attachments_limit before insert on public.grape_consumption_attachments for each row execute function public.enforce_attachment_limit();

create or replace function public.prevent_confirmed_attachment_delete()
returns trigger language plpgsql as $$
declare
  consumption_status public.confirmation_status;
begin
  select status into consumption_status from public.grape_consumptions where id = old.consumption_id;
  if consumption_status = 'confirmed' then
    raise exception '已确认的吃葡萄记录附件不可删除';
  end if;
  return old;
end;
$$;

create or replace trigger grape_consumption_attachments_delete_lock before delete on public.grape_consumption_attachments for each row execute function public.prevent_confirmed_attachment_delete();

-- =========================================================
-- 10. 视图：预算科目执行情况（已确认 / 待确认吃葡萄汇总）
-- =========================================================
create or replace view public.budget_category_usage
with (security_invoker = true) as
select
  bc.id as category_id,
  bc.budget_plan_id,
  bp.owner_id,
  bp.org_id,
  bp.status as plan_status,
  bp.period_start,
  bp.period_end,
  bc.name as category_name,
  bc.budgeted_amount,
  bc.sort_order,
  coalesce(sum(gc.grape_amount) filter (where gc.status = 'confirmed'), 0) as confirmed_consumed,
  coalesce(sum(gc.grape_amount) filter (where gc.status = 'pending'), 0) as pending_consumed
from public.budget_categories bc
join public.budget_plans bp on bp.id = bc.budget_plan_id
left join public.grape_consumptions gc on gc.budget_category_id = bc.id
group by bc.id, bc.budget_plan_id, bp.owner_id, bp.org_id, bp.status, bp.period_start, bp.period_end, bc.name, bc.budgeted_amount, bc.sort_order;

-- =========================================================
-- 11. 索引
-- =========================================================
create index if not exists budget_plans_owner_idx on public.budget_plans(owner_id);
create index if not exists budget_plans_status_idx on public.budget_plans(status);
create index if not exists budget_categories_plan_idx on public.budget_categories(budget_plan_id);
create index if not exists grape_consumption_attachments_consumption_idx on public.grape_consumption_attachments(consumption_id);
create index if not exists grape_consumptions_budget_category_idx on public.grape_consumptions(budget_category_id);

-- =========================================================
-- 12. RLS 开启
-- =========================================================
alter table public.budget_plans enable row level security;
alter table public.budget_categories enable row level security;
alter table public.grape_consumption_attachments enable row level security;

-- =========================================================
-- 13. RLS 策略：budget_plans
-- =========================================================
drop policy if exists "budget_plans select own or keeper" on public.budget_plans;
create policy "budget_plans select own or keeper" on public.budget_plans for select
  using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));

drop policy if exists "budget_plans insert own draft" on public.budget_plans;
create policy "budget_plans insert own draft" on public.budget_plans for insert
  with check (owner_id = auth.uid() and org_id = public.current_profile_org_id() and status = 'draft');

drop policy if exists "budget_plans update own or keeper" on public.budget_plans;
create policy "budget_plans update own or keeper" on public.budget_plans for update
  using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()))
  with check (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));

drop policy if exists "budget_plans delete own draft" on public.budget_plans;
create policy "budget_plans delete own draft" on public.budget_plans for delete
  using (owner_id = auth.uid() and status = 'draft');

-- =========================================================
-- 14. RLS 策略：budget_categories
-- =========================================================
drop policy if exists "budget_categories select own or keeper" on public.budget_categories;
create policy "budget_categories select own or keeper" on public.budget_categories for select
  using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));

drop policy if exists "budget_categories insert own" on public.budget_categories;
create policy "budget_categories insert own" on public.budget_categories for insert
  with check (owner_id = auth.uid() and org_id = public.current_profile_org_id());

drop policy if exists "budget_categories update own" on public.budget_categories;
create policy "budget_categories update own" on public.budget_categories for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "budget_categories delete own" on public.budget_categories;
create policy "budget_categories delete own" on public.budget_categories for delete
  using (owner_id = auth.uid());

-- =========================================================
-- 15. RLS 策略：grape_consumption_attachments
-- =========================================================
drop policy if exists "attachments select own or keeper" on public.grape_consumption_attachments;
create policy "attachments select own or keeper" on public.grape_consumption_attachments for select
  using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));

drop policy if exists "attachments insert own pending" on public.grape_consumption_attachments;
create policy "attachments insert own pending" on public.grape_consumption_attachments for insert
  with check (
    owner_id = auth.uid() and org_id = public.current_profile_org_id()
    and exists (select 1 from public.grape_consumptions gc where gc.id = consumption_id and gc.owner_id = auth.uid() and gc.status = 'pending')
  );

drop policy if exists "attachments delete own pending" on public.grape_consumption_attachments;
create policy "attachments delete own pending" on public.grape_consumption_attachments for delete
  using (
    owner_id = auth.uid()
    and exists (select 1 from public.grape_consumptions gc where gc.id = consumption_id and gc.owner_id = auth.uid() and gc.status = 'pending')
  );

-- =========================================================
-- 16. 收紧 profiles 可见范围：本人 + 同组织葡萄管家（用于「确认人」姓名展示），
--     普通用户之间不再互相可见（此前策略允许同组织任意 profile 被读取）。
-- =========================================================
drop policy if exists "profiles visible to same org" on public.profiles;
drop policy if exists "profiles select self" on public.profiles;
drop policy if exists "profiles select keeper same org" on public.profiles;
drop policy if exists "profiles select keepers for attribution" on public.profiles;

create policy "profiles select self" on public.profiles for select
  using (id = auth.uid());
create policy "profiles select keeper same org" on public.profiles for select
  using (public.is_grape_keeper() and org_id = public.current_profile_org_id());
create policy "profiles select keepers for attribution" on public.profiles for select
  using (role = 'grape_keeper' and org_id = public.current_profile_org_id());

-- =========================================================
-- 17. audit_logs：补充 INSERT 策略 + 本人预算表相关日志可见
-- =========================================================
drop policy if exists "audit insert self actions" on public.audit_logs;
create policy "audit insert self actions" on public.audit_logs for insert
  with check (actor_id = auth.uid() and org_id = public.current_profile_org_id());

drop policy if exists "audit select keeper" on public.audit_logs;
drop policy if exists "audit select keeper org" on public.audit_logs;
create policy "audit select keeper" on public.audit_logs for select
  using (public.is_grape_keeper() and org_id = public.current_profile_org_id());

drop policy if exists "audit select own budget plan" on public.audit_logs;
create policy "audit select own budget plan" on public.audit_logs for select
  using (
    entity_table = 'budget_plans'
    and exists (select 1 from public.budget_plans bp where bp.id = audit_logs.entity_id and bp.owner_id = auth.uid())
  );

-- =========================================================
-- 18. Storage：吃葡萄附件图床（私有桶，按 owner_id 目录隔离）
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consumption-attachments',
  'consumption-attachments',
  false,
  8388608,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "consumption attachments insert own folder" on storage.objects;
create policy "consumption attachments insert own folder" on storage.objects for insert
  with check (
    bucket_id = 'consumption-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "consumption attachments select own or keeper" on storage.objects;
create policy "consumption attachments select own or keeper" on storage.objects for select
  using (
    bucket_id = 'consumption-attachments'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_grape_keeper())
  );

drop policy if exists "consumption attachments delete own" on storage.objects;
create policy "consumption attachments delete own" on storage.objects for delete
  using (
    bucket_id = 'consumption-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================
-- 完成。可在 SQL Editor 中执行：
--   select * from public.budget_plans limit 1;
-- 确认无报错即表示迁移成功。
-- =========================================================
