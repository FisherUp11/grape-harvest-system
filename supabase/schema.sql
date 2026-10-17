-- 收葡萄系统 Supabase 初始化脚本
-- 在 Supabase SQL Editor 中完整执行一次。

create extension if not exists pgcrypto;

-- 1) 枚举类型
create type public.user_role as enum ('user', 'grape_keeper');
create type public.support_type as enum ('one_time', 'recurring');
create type public.support_cycle as enum ('monthly', 'quarterly', 'half_yearly', 'yearly');
create type public.supporter_status as enum ('active', 'paused', 'stopped');
create type public.commitment_status as enum ('active', 'completed', 'stopped', 'cancelled');
create type public.period_status as enum ('not_received', 'overdue', 'pending_confirmation', 'confirmed', 'stopped', 'cancelled');
create type public.receipt_method as enum ('cash', 'wechat', 'alipay', 'bank', 'other');
create type public.receipt_source_type as enum ('one_time', 'commitment');
create type public.confirmation_status as enum ('pending', 'confirmed');
create type public.consumption_type as enum ('fixed', 'project', 'one_time');
create type public.budget_status as enum (
  'draft',
  'pending_confirmation',
  'confirmed',
  'revision_requested',
  'revision_unlocked',
  'revision_pending_confirmation'
);

-- 2) 基础表
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  role public.user_role not null default 'user',
  display_name text,
  email text,
  monthly_fixed_consumption numeric(12,2) not null default 0,
  grape_alert_threshold numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.supporters (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  support_type public.support_type not null default 'one_time',
  cycle public.support_cycle,
  status public.supporter_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  supporter_id uuid not null references public.supporters(id) on delete restrict,
  commitment_type public.support_type not null,
  grape_amount numeric(12,2) not null check (grape_amount >= 0),
  cycle public.support_cycle,
  start_date date not null,
  end_date date,
  total_periods integer not null default 1 check (total_periods > 0),
  expected_day integer check (expected_day between 1 and 28),
  total_grapes numeric(12,2) not null default 0,
  status public.commitment_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.commitment_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  commitment_id uuid not null references public.commitments(id) on delete cascade,
  supporter_id uuid not null references public.supporters(id) on delete restrict,
  period_no integer not null check (period_no > 0),
  expected_date date not null,
  expected_grapes numeric(12,2) not null check (expected_grapes >= 0),
  actual_receipt_id uuid,
  actual_grapes numeric(12,2),
  status public.period_status not null default 'not_received',
  received_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  stopped_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (commitment_id, period_no)
);

create table public.grape_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  supporter_id uuid references public.supporters(id) on delete set null,
  commitment_id uuid references public.commitments(id) on delete set null,
  commitment_period_id uuid references public.commitment_periods(id) on delete set null,
  received_date date not null,
  grape_amount numeric(12,2) not null check (grape_amount >= 0),
  receipt_method public.receipt_method not null default 'other',
  source_type public.receipt_source_type not null default 'one_time',
  status public.confirmation_status not null default 'pending',
  notes text,
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.commitment_periods
  add constraint commitment_periods_actual_receipt_fk
  foreign key (actual_receipt_id) references public.grape_receipts(id) on delete set null;

create table public.budget_plans (
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

create table public.budget_categories (
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

create table public.grape_consumptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  consumption_date date not null,
  grape_amount numeric(12,2) not null check (grape_amount >= 0),
  consumption_type public.consumption_type not null default 'fixed',
  description text not null,
  budget_category_id uuid references public.budget_categories(id),
  status public.confirmation_status not null default 'pending',
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grape_consumption_attachments (
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

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_table text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- 3) 通用函数与触发器
create or replace function public.current_profile_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_grape_keeper()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'grape_keeper' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger supporters_touch before update on public.supporters for each row execute function public.touch_updated_at();
create trigger commitments_touch before update on public.commitments for each row execute function public.touch_updated_at();
create trigger grape_receipts_touch before update on public.grape_receipts for each row execute function public.touch_updated_at();
create trigger grape_consumptions_touch before update on public.grape_consumptions for each row execute function public.touch_updated_at();
create trigger budget_plans_touch before update on public.budget_plans for each row execute function public.touch_updated_at();
create trigger budget_categories_touch before update on public.budget_categories for each row execute function public.touch_updated_at();

create or replace function public.prevent_profile_privilege_escalation()
returns trigger language plpgsql as $$
begin
  if public.is_grape_keeper() then
    return new;
  end if;
  if old.id <> auth.uid() then
    raise exception '只能修改自己的 profile';
  end if;
  if new.role <> old.role or new.org_id <> old.org_id then
    raise exception '普通用户不可修改角色或组织';
  end if;
  return new;
end;
$$;

create trigger profiles_privilege_guard before update on public.profiles for each row execute function public.prevent_profile_privilege_escalation();

create or replace function public.prevent_confirmed_receipt_change()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '已确认收到的收葡萄记录不可修改';
  end if;
  if new.status = 'confirmed' and public.is_grape_keeper() is not true then
    raise exception '只有葡萄管家可以确认收葡萄记录';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_confirmed_consumption_change()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '已确认的吃葡萄记录不可修改';
  end if;
  if new.status = 'confirmed' and public.is_grape_keeper() is not true then
    raise exception '只有葡萄管家可以确认吃葡萄记录';
  end if;
  return new;
end;
$$;

create trigger grape_receipts_lock before update on public.grape_receipts for each row execute function public.prevent_confirmed_receipt_change();
create trigger grape_consumptions_lock before update on public.grape_consumptions for each row execute function public.prevent_confirmed_consumption_change();

create or replace function public.prevent_confirmed_delete()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '已确认记录不可删除';
  end if;
  return old;
end;
$$;

create trigger grape_receipts_delete_lock before delete on public.grape_receipts for each row execute function public.prevent_confirmed_delete();
create trigger grape_consumptions_delete_lock before delete on public.grape_consumptions for each row execute function public.prevent_confirmed_delete();

create or replace function public.prevent_confirmed_period_change()
returns trigger language plpgsql as $$
begin
  if old.status = 'confirmed' then
    raise exception '已确认的期次记录不可修改';
  end if;
  return new;
end;
$$;

create trigger commitment_periods_lock before update on public.commitment_periods for each row execute function public.prevent_confirmed_period_change();

create or replace function public.enforce_budget_plan_transition()
returns trigger language plpgsql as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' and not public.is_grape_keeper() then
    raise exception '只有葡萄管家可以确认预算表';
  end if;

  if old.status = 'revision_requested' and new.status = 'revision_unlocked' and not public.is_grape_keeper() then
    raise exception '只有葡萄管家可以解除预算表锁定';
  end if;

  if old.status in ('pending_confirmation', 'confirmed', 'revision_requested', 'revision_pending_confirmation')
     and not public.is_grape_keeper()
     and (new.period_start <> old.period_start or new.period_end <> old.period_end or new.title <> old.title) then
    raise exception '当前预算表已锁定，不可修改，请先申请修正';
  end if;

  return new;
end;
$$;

create trigger budget_plans_transition_guard before update on public.budget_plans for each row execute function public.enforce_budget_plan_transition();

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

create trigger budget_categories_editable_guard before insert or update or delete on public.budget_categories for each row execute function public.enforce_budget_category_editable();

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

create trigger grape_consumptions_budget_guard before insert on public.grape_consumptions for each row execute function public.enforce_consumption_budget_category();

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

create trigger grape_consumption_attachments_limit before insert on public.grape_consumption_attachments for each row execute function public.enforce_attachment_limit();

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

create trigger grape_consumption_attachments_delete_lock before delete on public.grape_consumption_attachments for each row execute function public.prevent_confirmed_attachment_delete();

-- 4) 视图
create or replace view public.grape_user_balances
with (security_invoker = true) as
select
  p.org_id,
  p.id as owner_id,
  p.display_name,
  p.email,
  coalesce(r.total_received, 0) as confirmed_received,
  coalesce(c.total_consumed, 0) as confirmed_consumed,
  coalesce(r.total_received, 0) - coalesce(c.total_consumed, 0) as grape_balance,
  p.grape_alert_threshold,
  p.monthly_fixed_consumption
from public.profiles p
left join (
  select owner_id, sum(grape_amount) as total_received
  from public.grape_receipts where status = 'confirmed' group by owner_id
) r on r.owner_id = p.id
left join (
  select owner_id, sum(grape_amount) as total_consumed
  from public.grape_consumptions where status = 'confirmed' group by owner_id
) c on c.owner_id = p.id;

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

-- 5) 索引
create index supporters_owner_idx on public.supporters(owner_id);
create index commitments_owner_idx on public.commitments(owner_id);
create index commitment_periods_owner_date_idx on public.commitment_periods(owner_id, expected_date);
create index grape_receipts_owner_date_idx on public.grape_receipts(owner_id, received_date);
create index grape_receipts_status_idx on public.grape_receipts(status);
create index grape_consumptions_owner_date_idx on public.grape_consumptions(owner_id, consumption_date);
create index grape_consumptions_status_idx on public.grape_consumptions(status);
create index budget_plans_owner_idx on public.budget_plans(owner_id);
create index budget_plans_status_idx on public.budget_plans(status);
create index budget_categories_plan_idx on public.budget_categories(budget_plan_id);
create index grape_consumption_attachments_consumption_idx on public.grape_consumption_attachments(consumption_id);
create index grape_consumptions_budget_category_idx on public.grape_consumptions(budget_category_id);

-- 6) RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.supporters enable row level security;
alter table public.commitments enable row level security;
alter table public.commitment_periods enable row level security;
alter table public.grape_receipts enable row level security;
alter table public.grape_consumptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.budget_plans enable row level security;
alter table public.budget_categories enable row level security;
alter table public.grape_consumption_attachments enable row level security;

create policy "organizations visible to same org" on public.organizations for select using (id = public.current_profile_org_id());

create policy "profiles select self" on public.profiles for select using (id = auth.uid());
create policy "profiles select keeper same org" on public.profiles for select using (public.is_grape_keeper() and org_id = public.current_profile_org_id());
create policy "profiles select keepers for attribution" on public.profiles for select using (role = 'grape_keeper' and org_id = public.current_profile_org_id());
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "keepers update profiles in org" on public.profiles for update using (public.is_grape_keeper() and org_id = public.current_profile_org_id()) with check (public.is_grape_keeper() and org_id = public.current_profile_org_id());

create policy "supporters select own or keeper" on public.supporters for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "supporters insert own" on public.supporters for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id());
create policy "supporters update own" on public.supporters for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "supporters delete own" on public.supporters for delete using (owner_id = auth.uid());

create policy "commitments select own or keeper" on public.commitments for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "commitments insert own" on public.commitments for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id());
create policy "commitments update own" on public.commitments for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "periods select own or keeper" on public.commitment_periods for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "periods insert own" on public.commitment_periods for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id());
create policy "periods update own or keeper" on public.commitment_periods for update using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id())) with check (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));

create policy "receipts select own or keeper" on public.grape_receipts for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "receipts insert own pending" on public.grape_receipts for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id() and status = 'pending');
create policy "receipts update own pending or keeper confirm" on public.grape_receipts for update using ((owner_id = auth.uid() and status = 'pending') or (public.is_grape_keeper() and org_id = public.current_profile_org_id())) with check ((owner_id = auth.uid()) or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "receipts delete own pending" on public.grape_receipts for delete using (owner_id = auth.uid() and status = 'pending');

create policy "consumptions select own or keeper" on public.grape_consumptions for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "consumptions insert own pending" on public.grape_consumptions for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id() and status = 'pending');
create policy "consumptions update own pending or keeper confirm" on public.grape_consumptions for update using ((owner_id = auth.uid() and status = 'pending') or (public.is_grape_keeper() and org_id = public.current_profile_org_id())) with check ((owner_id = auth.uid()) or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "consumptions delete own pending" on public.grape_consumptions for delete using (owner_id = auth.uid() and status = 'pending');

create policy "budget_plans select own or keeper" on public.budget_plans for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "budget_plans insert own draft" on public.budget_plans for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id() and status = 'draft');
create policy "budget_plans update own or keeper" on public.budget_plans for update using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id())) with check (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "budget_plans delete own draft" on public.budget_plans for delete using (owner_id = auth.uid() and status = 'draft');

create policy "budget_categories select own or keeper" on public.budget_categories for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "budget_categories insert own" on public.budget_categories for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id());
create policy "budget_categories update own" on public.budget_categories for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "budget_categories delete own" on public.budget_categories for delete using (owner_id = auth.uid());

create policy "attachments select own or keeper" on public.grape_consumption_attachments for select using (owner_id = auth.uid() or (public.is_grape_keeper() and org_id = public.current_profile_org_id()));
create policy "attachments insert own pending" on public.grape_consumption_attachments for insert with check (owner_id = auth.uid() and org_id = public.current_profile_org_id() and exists (select 1 from public.grape_consumptions gc where gc.id = consumption_id and gc.owner_id = auth.uid() and gc.status = 'pending'));
create policy "attachments delete own pending" on public.grape_consumption_attachments for delete using (owner_id = auth.uid() and exists (select 1 from public.grape_consumptions gc where gc.id = consumption_id and gc.owner_id = auth.uid() and gc.status = 'pending'));

create policy "audit insert self actions" on public.audit_logs for insert with check (actor_id = auth.uid() and org_id = public.current_profile_org_id());
create policy "audit select keeper" on public.audit_logs for select using (public.is_grape_keeper() and org_id = public.current_profile_org_id());
create policy "audit select own budget plan" on public.audit_logs for select using (entity_table = 'budget_plans' and exists (select 1 from public.budget_plans bp where bp.id = audit_logs.entity_id and bp.owner_id = auth.uid()));

-- 6.1) Storage：吃葡萄附件图床（私有桶，按 owner_id 目录隔离）
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

create policy "consumption attachments insert own folder" on storage.objects for insert with check (bucket_id = 'consumption-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "consumption attachments select own or keeper" on storage.objects for select using (bucket_id = 'consumption-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_grape_keeper()));
create policy "consumption attachments delete own" on storage.objects for delete using (bucket_id = 'consumption-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- 6.2) 图床用量统计：security definer 函数以函数所有者权限运行，绕过 storage.objects 的 RLS/授权依赖；
-- 函数内部显式校验 is_grape_keeper()，确保仅葡萄管家能获得非空结果，供设置页展示容量占用百分比。
create or replace function public.get_storage_usage_summary()
returns table(bucket_id text, object_count bigint, total_bytes bigint)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id, count(*)::bigint as object_count, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint as total_bytes
  from storage.objects o
  where public.is_grape_keeper()
  group by o.bucket_id
$$;

grant execute on function public.get_storage_usage_summary() to authenticated;

-- 7) 初始化组织示例（可按需修改名称）
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', '收葡萄庄园')
on conflict (id) do nothing;

-- 8) 创建用户 profile 示例：先在 Supabase Auth 创建用户，再将 USER_UUID 替换为 Auth User ID 后执行。
-- insert into public.profiles (id, org_id, role, display_name, email)
-- values ('USER_UUID', '00000000-0000-0000-0000-000000000001', 'grape_keeper', '葡萄管家', 'keeper@example.com');
