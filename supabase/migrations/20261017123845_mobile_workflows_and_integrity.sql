-- 移动端工作流、关联记录一致性、预算锁定、空间统计与邮件任务去重。
-- 已有项目只执行本迁移；全新项目先执行 schema.sql，再执行本迁移。
begin;

alter table public.grape_consumptions add column if not exists attachments_ready boolean not null default true;

-- 待确认记录只允许所属人改业务字段，管家对他人的记录只可执行确认。
create or replace function public.prevent_confirmed_receipt_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'confirmed' then raise exception '已确认收葡萄不可修改'; end if;
  if new.owner_id <> old.owner_id or new.org_id <> old.org_id or new.id <> old.id
     or new.commitment_period_id is distinct from old.commitment_period_id
     or new.commitment_id is distinct from old.commitment_id then
    raise exception '记录归属与关联承诺不可修改';
  end if;
  if auth.uid() is distinct from old.owner_id and
     (not public.is_grape_keeper() or
       (to_jsonb(new) - array['status','confirmed_by','confirmed_at','updated_at']) is distinct from
       (to_jsonb(old) - array['status','confirmed_by','confirmed_at','updated_at'])) then
    raise exception '只能修改自己的待确认记录；管家仅负责确认';
  end if;
  if new.status = 'confirmed' then
    if not public.is_grape_keeper() then raise exception '只有葡萄管家可以确认'; end if;
    new.confirmed_by := auth.uid(); new.confirmed_at := now();
  else new.confirmed_by := null; new.confirmed_at := null;
  end if;
  return new;
end $$;

create or replace function public.prevent_confirmed_consumption_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'confirmed' then raise exception '已确认吃葡萄不可修改'; end if;
  if new.owner_id <> old.owner_id or new.org_id <> old.org_id or new.id <> old.id then raise exception '记录归属不可修改'; end if;
  if auth.uid() is distinct from old.owner_id and
    (not public.is_grape_keeper() or
      (to_jsonb(new) - array['status','confirmed_by','confirmed_at','updated_at']) is distinct from
      (to_jsonb(old) - array['status','confirmed_by','confirmed_at','updated_at'])) then
    raise exception '只能修改自己的待确认记录；管家仅负责确认';
  end if;
  if new.status = 'confirmed' then
    if not public.is_grape_keeper() then raise exception '只有葡萄管家可以确认'; end if;
    if not old.attachments_ready then raise exception '凭证上传尚未完成，请等待记录者保存完成'; end if;
    if not exists (select 1 from public.grape_consumption_attachments where consumption_id = old.id) then
      raise exception '请先上传至少一个凭证，再确认吃葡萄';
    end if;
    new.confirmed_by := auth.uid(); new.confirmed_at := now();
  else new.confirmed_by := null; new.confirmed_at := null;
  end if;
  return new;
end $$;

-- 凭证元数据写入时锁住父记录，避免上传期间被并发确认及超过 5 个附件。
create or replace function public.enforce_attachment_limit()
returns trigger language plpgsql set search_path = public as $$
declare parent public.grape_consumptions;
begin
  select * into parent from public.grape_consumptions where id = new.consumption_id for update;
  if not found or parent.owner_id <> auth.uid() or new.owner_id <> parent.owner_id or new.org_id <> parent.org_id then
    raise exception '凭证所属记录不匹配';
  end if;
  if parent.status = 'confirmed' then raise exception '已确认记录不可添加附件'; end if;
  if (select count(*) from public.grape_consumption_attachments where consumption_id = new.consumption_id) >= 5 then
    raise exception '每条记录最多上传 5 个附件';
  end if;
  if split_part(new.file_path, '/', 1) <> new.owner_id::text or split_part(new.file_path, '/', 2) <> new.consumption_id::text then
    raise exception '凭证路径与所属记录不匹配';
  end if;
  if new.file_size <= 0 or new.file_size > 8388608 then raise exception '凭证文件大小须在 8 MB 以内'; end if;
  return new;
end $$;

create or replace function public.validate_receipt_links()
returns trigger language plpgsql set search_path = public as $$
declare period public.commitment_periods;
begin
  if new.grape_amount <= 0 then raise exception '葡萄数必须大于 0'; end if;
  if new.supporter_id is not null and not exists (select 1 from public.supporters where id = new.supporter_id and owner_id = new.owner_id and org_id = new.org_id) then
    raise exception '支持者不属于该记录者';
  end if;
  if new.commitment_period_id is not null then
    select * into period from public.commitment_periods where id = new.commitment_period_id for update;
    if not found or period.owner_id <> new.owner_id or period.org_id <> new.org_id or period.commitment_id is distinct from new.commitment_id or period.supporter_id is distinct from new.supporter_id then
      raise exception '承诺期次与收葡萄归属不匹配';
    end if;
    if tg_op = 'INSERT' and period.status not in ('not_received','overdue') then raise exception '该期次已收到或已停止，请勿重复登记'; end if;
    if exists (select 1 from public.grape_receipts where commitment_period_id = new.commitment_period_id and id <> new.id) then
      raise exception '该期次已有收葡萄记录，请在收葡萄页修改';
    end if;
  elsif new.commitment_id is not null or new.source_type = 'commitment' then raise exception '来自承诺的收葡萄必须关联期次';
  end if;
  return new;
end $$;
create trigger receipt_links_guard before insert or update on public.grape_receipts for each row execute function public.validate_receipt_links();

-- 与收葡萄变动在同一数据库事务中同步：任何一步失败则一起回滚。
create or replace function public.sync_receipt_period()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.commitment_period_id is not null then
      update public.commitment_periods set status = case when expected_date < (now() at time zone 'Asia/Shanghai')::date then 'overdue'::public.period_status else 'not_received'::public.period_status end,
        actual_receipt_id = null, actual_grapes = null, received_at = null, confirmed_by = null, confirmed_at = null
      where id = old.commitment_period_id;
    end if;
    return old;
  end if;
  if new.commitment_period_id is not null then
    update public.commitment_periods set status = case when new.status = 'confirmed' then 'confirmed'::public.period_status else 'pending_confirmation'::public.period_status end,
      actual_receipt_id = new.id, actual_grapes = new.grape_amount, received_at = new.received_date::timestamptz,
      confirmed_by = new.confirmed_by, confirmed_at = new.confirmed_at
    where id = new.commitment_period_id;
  end if;
  return new;
end $$;
create trigger receipt_period_sync after insert or update or delete on public.grape_receipts for each row execute function public.sync_receipt_period();

create or replace function public.enforce_consumption_budget_category()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.grape_amount <= 0 then raise exception '葡萄数必须大于 0'; end if;
  if tg_op = 'UPDATE' and new.consumption_date = old.consumption_date and new.budget_category_id is not distinct from old.budget_category_id then return new; end if;
  if new.grape_amount <= 0 then raise exception '葡萄数必须大于 0'; end if;
  if new.budget_category_id is not null and not exists (
    select 1 from public.budget_categories bc join public.budget_plans bp on bp.id = bc.budget_plan_id
    where bc.id = new.budget_category_id and bp.owner_id = new.owner_id and bp.org_id = new.org_id
      and bp.status = 'confirmed' and new.consumption_date between bp.period_start and bp.period_end
  ) then raise exception '所选科目不属于该日期的生效预算'; end if;
  if new.budget_category_id is null and exists (
    select 1 from public.budget_plans where owner_id = new.owner_id and status = 'confirmed'
      and new.consumption_date between period_start and period_end
  ) then raise exception '该日期已有生效预算，请选择科目'; end if;
  return new;
end $$;
drop trigger if exists grape_consumptions_budget_guard on public.grape_consumptions;
create trigger grape_consumptions_budget_guard before insert or update on public.grape_consumptions for each row execute function public.enforce_consumption_budget_category();

create or replace function public.enforce_budget_plan_transition()
returns trigger language plpgsql set search_path = public as $$
declare owner_action boolean; keeper_action boolean;
begin
  if new.owner_id <> old.owner_id or new.org_id <> old.org_id or new.id <> old.id then raise exception '预算归属不可修改'; end if;
  owner_action := auth.uid() = old.owner_id;
  keeper_action := public.is_grape_keeper() and old.org_id = public.current_profile_org_id();
  if new.status is distinct from old.status then
    if not (
      (owner_action and ((old.status = 'draft' and new.status = 'pending_confirmation') or
        (old.status = 'confirmed' and new.status = 'revision_requested') or
        (old.status = 'revision_unlocked' and new.status = 'revision_pending_confirmation') or
        (old.status = 'pending_confirmation' and new.status = 'draft') or
        (old.status = 'revision_pending_confirmation' and new.status = 'revision_unlocked')))
      or (keeper_action and ((old.status in ('pending_confirmation','revision_pending_confirmation') and new.status = 'confirmed') or
        (old.status = 'revision_requested' and new.status = 'revision_unlocked')))
    ) then raise exception '预算状态流转不允许，请按提交、确认、申请修正、解锁的顺序操作'; end if;
    if new.status in ('pending_confirmation','revision_pending_confirmation') and not exists (select 1 from public.budget_categories where budget_plan_id = old.id) then raise exception '请至少添加一个预算科目后提交'; end if;
    if new.status = 'confirmed' then
      -- 同一用户确认预算时串行化，防止两个重叠预算同时生效。
      perform 1 from public.profiles where id = old.owner_id for update;
      if exists (select 1 from public.budget_plans where owner_id = old.owner_id and id <> old.id and status in ('confirmed','revision_requested','revision_unlocked','revision_pending_confirmation') and period_start <= new.period_end and period_end >= new.period_start) then
        raise exception '该期间与另一份已提交预算重叠，请调整预算期间';
      end if;
      new.confirmed_by := auth.uid(); new.confirmed_at := now();
    elsif new.status = 'revision_unlocked' and old.status = 'revision_requested' then
      new.unlocked_by := auth.uid(); new.unlocked_at := now(); new.version := old.version + 1;
    elsif new.status in ('pending_confirmation','revision_pending_confirmation') then new.submitted_at := now();
    end if;
  elsif (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    if not owner_action or old.status not in ('draft','revision_unlocked') then raise exception '预算已锁定，请先申请修正'; end if;
  end if;
  if new.status is distinct from old.status and (new.title <> old.title or new.period_start <> old.period_start or new.period_end <> old.period_end) then raise exception '状态操作不可同时更改预算内容'; end if;
  return new;
end $$;

-- 使用显式入参和 invoker 权限，创建承诺与全部期次一起提交。
create or replace function public.create_commitment_with_periods(p_supporter_id uuid, p_new_supporter text, p_type public.support_type,
  p_amount numeric, p_cycle public.support_cycle, p_start date, p_count integer, p_expected_day integer, p_notes text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare cid uuid; sid uuid := p_supporter_id; oid uuid := public.current_profile_org_id(); months integer; first_date date; due date; n integer;
begin
  if auth.uid() is null or oid is null then raise exception '请先登录'; end if;
  if p_amount is null or p_amount <= 0 or p_count is null or p_count not between 1 and 120 or p_start is null then raise exception '请检查葡萄数、开始日期及期数（1–120）'; end if;
  if p_type = 'recurring' and (p_cycle is null or p_expected_day is null or p_expected_day not between 1 and 28) then raise exception '请填写周期和预计收到日（1–28）'; end if;
  if p_type = 'one_time' and p_count <> 1 then raise exception '一次性承诺只能有一期'; end if;
  if coalesce(trim(p_new_supporter), '') <> '' then
    insert into public.supporters(org_id, owner_id, name, support_type, cycle) values (oid, auth.uid(), trim(p_new_supporter), p_type, case when p_type = 'recurring' then p_cycle else null end) returning id into sid;
  end if;
  if not exists (select 1 from public.supporters where id = sid and owner_id = auth.uid() and org_id = oid) then raise exception '请选择自己的支持者'; end if;
  months := case p_cycle when 'quarterly' then 3 when 'half_yearly' then 6 when 'yearly' then 12 else 1 end;
  first_date := p_start;
  if p_type = 'recurring' then
    first_date := date_trunc('month', p_start)::date + (p_expected_day - 1);
    if first_date < p_start then first_date := (first_date + make_interval(months => months))::date; end if;
  end if;
  insert into public.commitments(org_id, owner_id, supporter_id, commitment_type, grape_amount, cycle, start_date, end_date, total_periods, expected_day, total_grapes, notes)
  values (oid, auth.uid(), sid, p_type, p_amount, case when p_type = 'recurring' then p_cycle else null end, p_start,
    (first_date + make_interval(months => months * (p_count - 1)))::date, p_count, case when p_type = 'recurring' then p_expected_day else null end, p_amount * p_count, p_notes) returning id into cid;
  for n in 1..p_count loop
    due := (first_date + make_interval(months => months * (n - 1)))::date;
    insert into public.commitment_periods(org_id, owner_id, commitment_id, supporter_id, period_no, expected_date, expected_grapes)
    values (oid, auth.uid(), cid, sid, n, due, p_amount);
  end loop;
  return cid;
end $$;
revoke all on function public.create_commitment_with_periods(uuid,text,public.support_type,numeric,public.support_cycle,date,integer,integer,text) from public, anon;
grant execute on function public.create_commitment_with_periods(uuid,text,public.support_type,numeric,public.support_cycle,date,integer,integer,text) to authenticated;

create or replace function public.stop_commitment(p_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.commitments where id = p_id and owner_id = auth.uid() and status = 'active' for update;
  if not found then raise exception '承诺不存在、已停止或不属于你'; end if;
  update public.commitments set status = 'stopped' where id = p_id;
  update public.commitment_periods set status = 'stopped', stopped_at = now() where commitment_id = p_id and status in ('not_received','overdue');
end $$;
revoke all on function public.stop_commitment(uuid) from public, anon;
grant execute on function public.stop_commitment(uuid) to authenticated;

-- 容量只汇总当前机构凭证桶；普通用户可查询自己的用量。读取失败由 UI 明确报告。
create or replace function public.get_storage_usage_summary()
returns table(bucket_id text, object_count bigint, total_bytes bigint)
language sql stable security definer set search_path = '' as $$
  select o.bucket_id, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o join public.profiles p on p.id::text = split_part(o.name, '/', 1)
  where auth.uid() is not null and o.bucket_id = 'consumption-attachments'
    and p.org_id = public.current_profile_org_id() and (p.id = auth.uid() or public.is_grape_keeper())
  group by o.bucket_id
$$;
revoke all on function public.get_storage_usage_summary() from public, anon;
grant execute on function public.get_storage_usage_summary() to authenticated;

-- 已确认凭证的存储对象也锁定，避免绕过元数据锁定直接删文件。
drop policy if exists "consumption attachments delete own" on storage.objects;
create policy "consumption attachments delete own" on storage.objects for delete to authenticated using (
  bucket_id = 'consumption-attachments' and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (select 1 from public.grape_consumptions c where c.id::text = (storage.foldername(name))[2] and c.status = 'confirmed')
);
drop policy if exists "consumption attachments select own or keeper" on storage.objects;
create policy "consumption attachments select own or keeper" on storage.objects for select to authenticated using (
  bucket_id = 'consumption-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or
    (public.is_grape_keeper() and exists (select 1 from public.profiles p where p.id::text = (storage.foldername(name))[1] and p.org_id = public.current_profile_org_id())))
);

-- 服务端定时邮件幂等账本，不允许浏览器读写。
create table if not exists public.notification_deliveries (
  delivery_key text primary key, owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('low_balance','monthly_report')),
  sent_at timestamptz, provider_id text, created_at timestamptz not null default now()
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from anon, authenticated;
grant all on public.notification_deliveries to service_role;
-- 归属列不可挪动；预算科目还必须属于指定的预算表。
create or replace function public.guard_owned_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.owner_id <> old.owner_id or new.org_id <> old.org_id or new.id <> old.id) then raise exception '数据归属不可修改'; end if;
  if tg_table_name = 'budget_categories' then
    if not exists (select 1 from public.budget_plans where id = new.budget_plan_id and owner_id = new.owner_id and org_id = new.org_id) then raise exception '预算科目所属预算不匹配'; end if;
    if tg_op = 'UPDATE' and new.budget_plan_id <> old.budget_plan_id then raise exception '科目不可挪到其他预算'; end if;
  end if;
  return new;
end $$;
create trigger supporters_owner_guard before update on public.supporters for each row execute function public.guard_owned_row();
create trigger commitments_owner_guard before update on public.commitments for each row execute function public.guard_owned_row();
create trigger budget_categories_owner_guard before insert or update on public.budget_categories for each row execute function public.guard_owned_row();

-- 审计由数据库自动记录，避免浏览器漏写、失败或伪造日志。
alter table public.audit_logs add column if not exists owner_id uuid references public.profiles(id);
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.audit_business_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  entity_name text := tg_table_name; entity_uuid uuid := (row_data->>'id')::uuid;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if tg_table_name = 'budget_categories' then entity_name := 'budget_plans'; entity_uuid := (row_data->>'budget_plan_id')::uuid; end if;
  insert into public.audit_logs(org_id, owner_id, actor_id, action, entity_table, entity_id, old_data, new_data)
  values ((row_data->>'org_id')::uuid, (row_data->>'owner_id')::uuid, auth.uid(),
    tg_table_name || ':' || lower(tg_op), entity_name, entity_uuid,
    case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
revoke all on function private.audit_business_change() from public, anon, authenticated;
create trigger budget_plans_audit after insert or update or delete on public.budget_plans for each row execute function private.audit_business_change();
create trigger budget_categories_audit after insert or update or delete on public.budget_categories for each row execute function private.audit_business_change();
create trigger receipts_audit after insert or update or delete on public.grape_receipts for each row execute function private.audit_business_change();
create trigger consumptions_audit after insert or update or delete on public.grape_consumptions for each row execute function private.audit_business_change();
create trigger commitments_audit after insert or update or delete on public.commitments for each row execute function private.audit_business_change();
create trigger supporters_audit after insert or update or delete on public.supporters for each row execute function private.audit_business_change();
drop policy if exists "audit insert self actions" on public.audit_logs;
create policy "audit select own records" on public.audit_logs for select to authenticated using (owner_id = auth.uid());

create or replace function public.prevent_confirmed_period_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'confirmed' then raise exception '已确认期次不可修改'; end if;
  if new.owner_id <> old.owner_id or new.org_id <> old.org_id or new.commitment_id <> old.commitment_id or new.supporter_id <> old.supporter_id then raise exception '期次归属不可修改'; end if;
  if new.status = 'confirmed' and (not public.is_grape_keeper() or not exists (
    select 1 from public.grape_receipts where id = new.actual_receipt_id and commitment_period_id = new.id and status = 'confirmed'
  )) then raise exception '期次须由管家确认关联的收葡萄记录'; end if;
  if new.actual_receipt_id is not null and not exists (
    select 1 from public.grape_receipts where id = new.actual_receipt_id and commitment_period_id = new.id and owner_id = new.owner_id
  ) then raise exception '期次关联收葡萄不匹配'; end if;
  return new;
end $$;
commit;
