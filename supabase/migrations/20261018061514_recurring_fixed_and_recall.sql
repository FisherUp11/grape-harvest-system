-- batch: schema
begin;
create table public.recurring_consumption_plans(
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id), owner_id uuid not null references public.profiles(id),
 description text not null check(length(trim(description)) between 1 and 500), grape_amount numeric(12,2) not null check(grape_amount>0),
 start_date date not null, end_date date not null, day_of_month integer not null check(day_of_month between 1 and 31),
 budget_category_id uuid references public.budget_categories(id), next_date date, status text not null default 'active' check(status in ('active','stopped','completed')),
 generated_count integer not null default 0, last_generated_date date, last_error text,
 stopped_at timestamptz, stop_reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(end_date>=start_date and end_date<=start_date+interval '10 years')
);
alter table public.recurring_consumption_plans enable row level security;
create index recurring_plans_owner_idx on public.recurring_consumption_plans(owner_id);
create index recurring_plans_org_idx on public.recurring_consumption_plans(org_id);
create index recurring_plans_category_idx on public.recurring_consumption_plans(budget_category_id);
create index recurring_plans_due_idx on public.recurring_consumption_plans(next_date) where status='active';
alter table public.grape_consumptions add column recurring_plan_id uuid references public.recurring_consumption_plans(id), add column scheduled_for date;
create unique index consumption_recurring_occurrence_idx on public.grape_consumptions(recurring_plan_id,scheduled_for) where recurring_plan_id is not null;
alter table public.grape_consumptions add constraint recurring_origin_pair check((recurring_plan_id is null)=(scheduled_for is null));
alter table public.grape_consumption_attachments add column is_permanent boolean not null default false;
update public.grape_consumption_attachments a set is_permanent=true from public.grape_consumptions c where c.id=a.consumption_id and c.consumption_type='fixed';
commit;
-- batch: workflows
begin;
create or replace function private.guard_business_record() returns trigger language plpgsql set search_path='' as $$
declare oldj jsonb; newj jsonb:=to_jsonb(new); patch jsonb:='{}'; editable boolean; required boolean; current_amount numeric;
begin
 -- Only the private scheduled generator (owned by postgres) may insert a finalized occurrence.
 if tg_op='INSERT' and tg_table_name='grape_consumptions' and newj->>'recurring_plan_id' is not null then
   if current_user<>'postgres' or not exists(
     select 1 from public.recurring_consumption_plans p join public.organizations o on o.id=p.org_id
     where p.id=(newj->>'recurring_plan_id')::uuid and p.status='active' and p.owner_id=new.owner_id and p.org_id=new.org_id
     and p.grape_amount=new.grape_amount and p.next_date=new.consumption_date and p.next_date=(newj->>'scheduled_for')::date
     and p.next_date<=p.end_date and p.next_date<=(now() at time zone 'Asia/Shanghai')::date
     and new.consumption_type='fixed' and new.approval_required=o.fixed_requires_approval
     and new.status=case when o.fixed_requires_approval then 'pending'::public.confirmation_status else 'confirmed'::public.confirmation_status end
   ) then raise exception '周期来源只能由到期任务生成，不能提前记账'; end if;
   return new;
 end if;
 if public.is_super_admin() or not private.ready() then raise exception '总园主只读业务数据，或账号尚未完成首次改密'; end if;
 if tg_op='INSERT' then
   if new.status<>'draft' or not public.can_record(new.org_id,new.owner_id) then raise exception '只能创建自己的草稿'; end if;
   return jsonb_populate_record(new,jsonb_build_object('confirmed_by',null,'confirmed_at',null,'returned_by',null,'returned_at',null,'return_reason',null,'submitted_at',null,'revision_number',1,'approval_required',case when tg_table_name='grape_consumptions' then null else true end,'auto_confirmed',false,'deleted_at',null,'deleted_by',null,'deletion_reason',null));
 end if;
 oldj:=to_jsonb(old);
 if newj->'recurring_plan_id' is distinct from oldj->'recurring_plan_id' or newj->'scheduled_for' is distinct from oldj->'scheduled_for' then raise exception '周期来源不可修改'; end if;
 if old.status='confirmed' or old.deleted_at is not null then raise exception '已确认或已作废记录永久锁定，不能修改'; end if;
 if new.id<>old.id or new.owner_id<>old.owner_id or new.org_id<>old.org_id or new.created_at<>old.created_at then raise exception '记录归属不可修改'; end if;
 if (newj-array['status','confirmed_by','confirmed_at','returned_by','returned_at','return_reason','submitted_at','revision_number','approval_required','auto_confirmed','updated_at','amount_delta']) is distinct from
    (oldj-array['status','confirmed_by','confirmed_at','returned_by','returned_at','return_reason','submitted_at','revision_number','approval_required','auto_confirmed','updated_at','amount_delta']) and not (old.owner_id=auth.uid() and old.status in ('draft','returned')) then
   raise exception '提交后请先召回，或由农场管家退回后再修改';
 end if;
 if new.deleted_at is distinct from old.deleted_at then
   if not public.can_record(old.org_id,old.owner_id) or old.status not in ('draft','returned') or nullif(trim(new.deletion_reason),'') is null then raise exception '仅可作废自己的草稿或退回记录，并填写原因'; end if;
   return jsonb_populate_record(new,jsonb_build_object('deleted_at',now(),'deleted_by',auth.uid()));
 end if;
 -- 受保护的审核字段只能由本触发器生成。
 patch:=jsonb_build_object('confirmed_by',old.confirmed_by,'confirmed_at',old.confirmed_at,'returned_by',old.returned_by,'returned_at',old.returned_at,'submitted_at',old.submitted_at,'revision_number',old.revision_number,'approval_required',old.approval_required,'auto_confirmed',old.auto_confirmed,'return_reason',old.return_reason);
 if new.status<>old.status then
   if new.status='pending' and old.status in ('draft','returned') and public.can_record(old.org_id,old.owner_id) then
     if tg_table_name='grape_consumptions' and newj->>'consumption_type'='fixed' and (newj->>'consumption_date')::date>(now() at time zone 'Asia/Shanghai')::date then raise exception '未到发生日期，不能提交固定吃葡萄；请使用按月计划'; end if;
     required:=coalesce(old.approval_required,true);
     if tg_table_name='grape_consumptions' then
       if new.consumption_type<>'fixed' and (not new.attachments_ready or not exists(select 1 from public.grape_consumption_attachments where consumption_id=new.id)) then raise exception '请先完成至少一个凭证上传'; end if;
       if old.approval_required is null then select (new.consumption_type<>'fixed' or fixed_requires_approval) into required from public.organizations where id=new.org_id; end if;
     end if;
     patch:=patch||jsonb_build_object('submitted_at',now(),'revision_number',old.revision_number+case when old.status='returned' then 1 else 0 end,'approval_required',required);
     if not required then patch:=patch||jsonb_build_object('status','confirmed','confirmed_at',now(),'auto_confirmed',true,'confirmed_by',null); end if;
   elsif old.status='pending' and new.status='draft' and public.can_record(old.org_id,old.owner_id) then
     patch:=patch||jsonb_build_object('submitted_at',null,'revision_number',old.revision_number+1);
   elsif old.status='pending' and new.status in ('returned','confirmed') and public.is_grape_keeper() and old.org_id=public.current_profile_org_id() then
     if new.status='returned' then
       if nullif(trim(new.return_reason),'') is null then raise exception '请填写退回原因'; end if;
       patch:=patch||jsonb_build_object('returned_by',auth.uid(),'returned_at',now(),'return_reason',new.return_reason);
     else
       if tg_table_name='grape_consumptions' and oldj->>'consumption_type'='fixed' and (oldj->>'consumption_date')::date>(now() at time zone 'Asia/Shanghai')::date then raise exception '尚未到固定吃葡萄发生日期'; end if;
       if tg_table_name='grape_consumptions' then if old.consumption_type<>'fixed' and (not old.attachments_ready or not exists(select 1 from public.grape_consumption_attachments where consumption_id=old.id)) then raise exception '凭证不完整，不能确认'; end if; end if;
       if tg_table_name='record_corrections' then
         -- 同一原单的更正串行核验，防止两个更正基于相同旧金额重复生效。
         perform pg_advisory_xact_lock(hashtextextended(new.target_id::text,42));
         execute format('select grape_amount from public.%I where id=$1 and status=''confirmed''',new.target_table) into current_amount using new.target_id;
         current_amount:=current_amount+coalesce((select sum(amount_delta) from public.record_corrections where target_table=new.target_table and target_id=new.target_id and status='confirmed'),0);
         if current_amount<>new.previous_amount then raise exception '原记录已有其他更正生效，请退回并重新创建更正单'; end if;
       end if;
       patch:=patch||jsonb_build_object('confirmed_by',auth.uid(),'confirmed_at',now(),'auto_confirmed',false);
     end if;
   else raise exception '状态流转不允许'; end if;
 elsif old.status='pending' then raise exception '待确认记录只能召回、由农场管家确认或退回';
 elsif not public.can_record(old.org_id,old.owner_id) then raise exception '只能修改自己的草稿或退回记录';
 end if;
 return jsonb_populate_record(new,patch);
end $$;
create or replace function public.record_action(p_table text,p_id uuid,p_action text,p_reason text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare rowstate public.confirmation_status;
begin
 if p_table not in ('grape_receipts','grape_consumptions','record_corrections') then raise exception '记录类型无效'; end if;
 execute format('select status from public.%I where id=$1 for update',p_table) into rowstate using p_id;
 if rowstate is null then raise exception '记录不存在或无权限'; end if;
 if p_action='recall' then
   if rowstate<>'pending' then raise exception '记录已不在待确认状态，无法召回，请刷新'; end if;
   execute format('update public.%I set status=''draft'' where id=$1',p_table) using p_id;
 elsif p_action='submit' then
   if rowstate not in ('draft','returned') then raise exception '记录已提交，请刷新后操作'; end if;
   execute format('update public.%I set status=''pending'' where id=$1',p_table) using p_id;
 elsif p_action='confirm' then
   if rowstate<>'pending' then raise exception '记录已被召回或处理，无法确认，请刷新'; end if;
   execute format('update public.%I set status=''confirmed'' where id=$1',p_table) using p_id;
 elsif p_action='return' then
   if rowstate<>'pending' then raise exception '记录已被召回或处理，请刷新'; end if;
   execute format('update public.%I set status=''returned'',return_reason=$2 where id=$1',p_table) using p_id,p_reason;
 elsif p_action='archive' then
   execute format('update public.%I set deleted_at=now(),deletion_reason=$2 where id=$1',p_table) using p_id,p_reason;
 else raise exception '动作无效'; end if;
end $$;
create or replace function public.enforce_budget_plan_transition() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='confirmed' or old.deleted_at is not null then raise exception '已确认预算原版本永久锁定，需要调整请新建版本'; end if;
 if new.id<>old.id or new.owner_id<>old.owner_id or new.org_id<>old.org_id or new.supersedes_id is distinct from old.supersedes_id then raise exception '预算归属或版本来源不可修改'; end if;
 if new.deleted_at is distinct from old.deleted_at then
   if not public.can_record(old.org_id,old.owner_id) or old.status not in ('draft','revision_unlocked') or nullif(trim(new.deletion_reason),'') is null then raise exception '只可作废自己的草稿或退回预算，并填写原因'; end if;
   new.deleted_at:=now();new.deleted_by:=auth.uid();return new;
 end if;
 new.confirmed_by:=old.confirmed_by;new.confirmed_at:=old.confirmed_at;new.unlocked_by:=old.unlocked_by;new.unlocked_at:=old.unlocked_at;new.submitted_at:=old.submitted_at;
 if new.status<>old.status then
   if old.status in ('draft','revision_unlocked') and new.status in ('pending_confirmation','revision_pending_confirmation') and public.can_record(old.org_id,old.owner_id) then
     if not exists(select 1 from public.budget_categories where budget_plan_id=old.id and deleted_at is null) then raise exception '请至少添加一个科目'; end if;
     new.submitted_at:=now();
   elsif old.status in ('pending_confirmation','revision_pending_confirmation') and public.can_record(old.org_id,old.owner_id) and new.status=(case when old.status='pending_confirmation' then 'draft'::public.budget_status else 'revision_unlocked'::public.budget_status end) then
     new.submitted_at:=null;
   elsif old.status in ('pending_confirmation','revision_pending_confirmation') and public.is_grape_keeper() and old.org_id=public.current_profile_org_id() and new.status in ('confirmed','revision_unlocked') then
     if new.status='revision_unlocked' then
       if nullif(trim(new.return_reason),'') is null then raise exception '请填写退回原因'; end if;
       new.unlocked_by:=auth.uid();new.unlocked_at:=now();
     else
       perform pg_advisory_xact_lock(hashtextextended(old.owner_id::text,8));
       if exists(select 1 from public.budget_plans b where b.owner_id=old.owner_id and b.status='confirmed' and b.deleted_at is null and b.id<>old.id
         and b.period_start<=old.period_end and b.period_end>=old.period_start
         and b.id not in (with recursive ancestors as (select old.supersedes_id as id union all select x.supersedes_id from public.budget_plans x join ancestors a on x.id=a.id where x.supersedes_id is not null) select id from ancestors where id is not null)) then raise exception '与另一份生效预算重叠'; end if;
       if old.supersedes_id is not null and exists(select 1 from public.budget_plans where supersedes_id=old.supersedes_id and status='confirmed' and id<>old.id) then raise exception '已有更新版本生效，请从最新版本创建'; end if;
       new.confirmed_by:=auth.uid();new.confirmed_at:=now();
     end if;
   else raise exception '待审核预算请先召回或等待管家退回；已确认版本不可解锁'; end if;
   if (to_jsonb(new)-array['status','confirmed_by','confirmed_at','unlocked_by','unlocked_at','return_reason','submitted_at','updated_at']) is distinct from (to_jsonb(old)-array['status','confirmed_by','confirmed_at','unlocked_by','unlocked_at','return_reason','submitted_at','updated_at']) then raise exception '状态操作不能同时修改预算内容'; end if;
 elsif old.status not in ('draft','revision_unlocked') or not public.can_record(old.org_id,old.owner_id) then raise exception '预算已提交，请先等待管家退回';
 end if;
 return new;
end $$;

create or replace function public.enforce_attachment_limit() returns trigger language plpgsql set search_path='' as $$
declare parent public.grape_consumptions;
begin
 select * into parent from public.grape_consumptions where id=new.consumption_id for update;
 if not found or not public.can_record(parent.org_id,parent.owner_id) or new.owner_id<>parent.owner_id or new.org_id<>parent.org_id then raise exception '凭证归属不匹配'; end if;
 if parent.deleted_at is not null or (parent.consumption_type<>'fixed' and parent.status not in ('draft','returned')) then raise exception '此记录不可追加凭证'; end if;
 if (select count(*) from public.grape_consumption_attachments where consumption_id=new.consumption_id)>=5 then raise exception '每条记录最多 5 个凭证'; end if;
 if split_part(new.file_path,'/',1)<>new.owner_id::text or split_part(new.file_path,'/',2)<>new.consumption_id::text or new.file_size not between 1 and 8388608 then raise exception '凭证路径或大小不正确'; end if;
 new.is_permanent:=parent.consumption_type='fixed';
 return new;
end $$;
create or replace function public.prevent_confirmed_attachment_delete() returns trigger language plpgsql set search_path='' as $$
begin
 if old.is_permanent or exists(select 1 from public.grape_consumptions where id=old.consumption_id and status='confirmed') then raise exception '已上传的固定吃凭证或已确认凭证不可删除'; end if;
 return old;
end $$;
drop policy attachment_delete on public.grape_consumption_attachments;
create policy attachment_delete on public.grape_consumption_attachments for delete to authenticated using(not is_permanent and public.can_record(org_id,owner_id) and exists(select 1 from public.grape_consumptions c where c.id=consumption_id and c.status in ('draft','returned') and c.deleted_at is null));
alter policy "consumption attachments own insert" on storage.objects with check(bucket_id='consumption-attachments' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.grape_consumptions c where c.id::text=(storage.foldername(name))[2] and public.can_record(c.org_id,c.owner_id) and (c.consumption_type='fixed' or c.status in ('draft','returned')) and c.deleted_at is null));
alter policy "consumption attachments draft delete" on storage.objects using(bucket_id='consumption-attachments' and private.ready() and not public.is_super_admin() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.grape_consumption_attachments a where a.file_path=name and a.is_permanent) and not exists(select 1 from public.grape_consumptions c where c.id::text=(storage.foldername(name))[2] and c.status not in ('draft','returned') and c.consumption_type<>'fixed'));
create or replace function private.audit_business_change() returns trigger language plpgsql security definer set search_path='' as $$
declare a jsonb; b jsonb; changed text[]; rowdata jsonb; entity text:=tg_table_name; eid uuid;
begin
 if tg_op='DELETE' then rowdata:=to_jsonb(old); else rowdata:=to_jsonb(new); end if;
 a:=case when tg_op<>'INSERT' then to_jsonb(old)-array['updated_at','attachments_ready'] end;
 b:=case when tg_op<>'DELETE' then to_jsonb(new)-array['updated_at','attachments_ready'] end;
 if tg_op='UPDATE' then
   select array_agg(k) into changed from jsonb_object_keys(b) k where a->k is distinct from b->k;
   if changed is null then return new; end if;
   select jsonb_object_agg(k,a->k),jsonb_object_agg(k,b->k) into a,b from unnest(changed) k;
 end if;
 eid:=(rowdata->>'id')::uuid;
 if tg_table_name='budget_categories' then entity:='budget_plans';eid:=(rowdata->>'budget_plan_id')::uuid; end if;
 insert into public.audit_logs(org_id,owner_id,actor_id,action,entity_table,entity_id,old_data,new_data)
 values(case when tg_table_name='organizations' then eid else (rowdata->>'org_id')::uuid end,(rowdata->>'owner_id')::uuid,auth.uid(),
 tg_table_name||':'||case when tg_op='UPDATE' and to_jsonb(old)->>'status' in ('pending','pending_confirmation','revision_pending_confirmation') and rowdata->>'status' in ('draft','revision_unlocked') and auth.uid()=(rowdata->>'owner_id')::uuid then 'recalled' when tg_op='UPDATE' and rowdata->>'deleted_at' is not null then 'archived' else lower(tg_op) end,entity,eid,a,b);
 return coalesce(new,old);
end $$;
create trigger consumption_attachment_audit after insert or delete on public.grape_consumption_attachments for each row execute function private.audit_business_change();
commit;
-- batch: scheduler
begin;
create policy recurring_read on public.recurring_consumption_plans for select to authenticated using(public.can_read_farm(org_id,owner_id));
create policy recurring_insert on public.recurring_consumption_plans for insert to authenticated with check(public.can_record(org_id,owner_id));
create policy recurring_update on public.recurring_consumption_plans for update to authenticated using(public.can_record(org_id,owner_id)) with check(public.can_record(org_id,owner_id));
grant select,insert,update on public.recurring_consumption_plans to authenticated;
grant select,insert,update on public.recurring_consumption_plans to service_role;

grant usage on schema private to service_role;
create or replace function private.fixed_month_date(p_month date,p_day integer) returns date language sql immutable set search_path='' as $$
 select make_date(extract(year from p_month)::integer,extract(month from p_month)::integer,least(p_day,extract(day from (date_trunc('month',p_month)+interval '1 month - 1 day'))::integer));
$$;
revoke all on function private.fixed_month_date(date,integer) from public,anon;
grant execute on function private.fixed_month_date(date,integer) to authenticated,service_role;

create or replace function private.guard_recurring_plan() returns trigger language plpgsql set search_path='' as $$
declare today date:=(now() at time zone 'Asia/Shanghai')::date;
begin
 -- Called as postgres only by the private due generator, never by browser clients.
 if tg_op='UPDATE' and current_user='postgres' then return new; end if;
 if not public.can_record(new.org_id,new.owner_id) then raise exception '只能设置自己的固定吃葡萄计划'; end if;
 if tg_op='INSERT' then
   if new.start_date<today then raise exception '周期计划只能从今天或未来开始，历史记录请单独登记'; end if;
   new.status:='active';new.generated_count:=0;new.last_generated_date:=null;new.last_error:=null;new.stopped_at:=null;new.stop_reason:=null;
   new.next_date:=private.fixed_month_date(new.start_date,new.day_of_month);
   if new.next_date<new.start_date then new.next_date:=private.fixed_month_date((date_trunc('month',new.start_date)+interval '1 month')::date,new.day_of_month); end if;
   if new.next_date>new.end_date then raise exception '所选期间没有可执行的每月日期'; end if;
 else
   if old.status<>'active' then raise exception '已终止或已结束计划不能修改或重新启用，请新建计划'; end if;
   if (to_jsonb(new)-array['status','stopped_at','stop_reason','budget_category_id','updated_at']) is distinct from (to_jsonb(old)-array['status','stopped_at','stop_reason','budget_category_id','updated_at']) then raise exception '计划日期和数量不可覆盖修改，请终止后新建'; end if;
   if new.status='stopped' then
     if nullif(trim(new.stop_reason),'') is null then raise exception '请填写终止原因'; end if;
     new.stopped_at:=now();new.next_date:=null;
   elsif new.status<>'active' then raise exception '计划状态操作无效';
   elsif new.budget_category_id is not distinct from old.budget_category_id then raise exception '未选择新的预算科目';
   else new.stopped_at:=old.stopped_at;new.stop_reason:=old.stop_reason;
   end if;
 end if;
 if new.budget_category_id is not null and not exists(select 1 from public.budget_categories c where c.id=new.budget_category_id and c.owner_id=new.owner_id and c.org_id=new.org_id and c.deleted_at is null) then raise exception '预算科目不属于本人'; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function private.guard_recurring_plan() from public,anon,authenticated;
create trigger recurring_plan_guard before insert or update on public.recurring_consumption_plans for each row execute function private.guard_recurring_plan();
create trigger recurring_plan_audit after insert or update on public.recurring_consumption_plans for each row execute function private.audit_business_change();

-- Definer is private; caller is checked inside, and the exposed wrapper remains invoker.
create or replace function private.generate_due_fixed_consumptions() returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.recurring_consumption_plans; next_due date; category uuid; approval boolean; created uuid;
 today date:=(now() at time zone 'Asia/Shanghai')::date; generated integer:=0; blocked integer:=0; plan_generated integer;
 actor uuid:=auth.uid(); worker boolean:=current_setting('role',true)='service_role' or (auth.uid() is null and session_user='postgres' and current_setting('role',true) in ('none','postgres'));
begin
 if not worker and (actor is null or not private.ready() or public.is_super_admin()) then raise exception '无权执行到期固定吃葡萄'; end if;
 for p in select * from public.recurring_consumption_plans where status='active' and next_date<=today and (worker or owner_id=actor) order by next_date,id for update skip locked loop
   plan_generated:=0;
   begin
     if not exists(select 1 from public.profiles u where u.id=p.owner_id and u.org_id=p.org_id and u.role<>'super_admin' and not u.must_change_password) then raise exception '计划所属账号或农场已变化，或尚未完成首次改密'; end if;
     while p.next_date<=today and p.next_date<=p.end_date loop
       select o.fixed_requires_approval into approval from public.organizations o where o.id=p.org_id;
       category:=null;
       if p.budget_category_id is not null then
         select c.id into category from public.budget_categories c join public.budget_plans b on b.id=c.budget_plan_id
         where c.lineage_id=(select lineage_id from public.budget_categories where id=p.budget_category_id)
         and b.owner_id=p.owner_id and b.org_id=p.org_id and b.status='confirmed' and b.deleted_at is null and c.deleted_at is null
         and p.next_date between b.period_start and b.period_end
         and not exists(select 1 from public.budget_plans n where n.supersedes_id=b.id and n.status='confirmed' and n.deleted_at is null)
         order by b.version desc limit 1;
       end if;
       -- The normal budget trigger still checks the effective budget and category.
       insert into public.grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,budget_category_id,status,approval_required,auto_confirmed,submitted_at,confirmed_at,recurring_plan_id,scheduled_for,attachments_ready)
       values(p.org_id,p.owner_id,p.next_date,p.grape_amount,'fixed',p.description,category,
         case when approval then 'pending'::public.confirmation_status else 'confirmed'::public.confirmation_status end,
         approval,not approval,now(),case when not approval then now() end,p.id,p.next_date,false)
       on conflict(recurring_plan_id,scheduled_for) where recurring_plan_id is not null do nothing returning id into created;
       if created is not null then plan_generated:=plan_generated+1; end if;
       next_due:=private.fixed_month_date((date_trunc('month',p.next_date)+interval '1 month')::date,p.day_of_month);
       update public.recurring_consumption_plans set last_generated_date=p.next_date,generated_count=generated_count+case when created is null then 0 else 1 end,
         next_date=case when next_due<=end_date then next_due end,status=case when next_due>end_date then 'completed' else 'active' end,last_error=null,updated_at=now() where id=p.id;
       p.next_date:=next_due;
     end loop;
     generated:=generated+plan_generated;
   exception when others then
     -- This plan's partial inserts are rolled back; other plans can still run.
     update public.recurring_consumption_plans set last_error=left(sqlerrm,300),updated_at=now() where id=p.id;
     blocked:=blocked+1;
   end;
 end loop;
 return jsonb_build_object('generated',generated,'blocked',blocked,'as_of',today);
end $$;
revoke all on function private.generate_due_fixed_consumptions() from public,anon;
grant execute on function private.generate_due_fixed_consumptions() to authenticated,service_role;
create or replace function public.sync_recurring_consumptions() returns jsonb language sql security invoker set search_path='' as $$ select private.generate_due_fixed_consumptions(); $$;
revoke all on function public.sync_recurring_consumptions() from public,anon;
grant execute on function public.sync_recurring_consumptions() to authenticated,service_role;

create or replace function public.stop_recurring_consumption(p_id uuid,p_reason text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.recurring_consumption_plans where id=p_id and status='active' and owner_id=auth.uid() for update;
 if not found then raise exception '计划不存在、已结束或不属于本人'; end if;
 update public.recurring_consumption_plans set status='stopped',stop_reason=p_reason where id=p_id;
end $$;
revoke all on function public.stop_recurring_consumption(uuid,text) from public,anon;
grant execute on function public.stop_recurring_consumption(uuid,text) to authenticated;
commit;

-- batch: profile_guard
begin;
create or replace function public.admin_assign_profile(p_user uuid,p_farm uuid,p_role public.user_role,p_name text,p_email text,p_require_change boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare oldp public.profiles;
begin
 if not public.is_super_admin() then raise exception '只有葡萄总园主可以分配账号'; end if;
 if p_role<>'super_admin' and (p_farm is null or not exists(select 1 from public.organizations where id=p_farm)) then raise exception '请选择有效农场'; end if;
 if not exists(select 1 from auth.users where id=p_user and lower(email)=lower(p_email)) then raise exception '账号与邮箱不匹配'; end if;
 perform pg_advisory_xact_lock(7142026);
 select * into oldp from public.profiles where id=p_user for update;
 if oldp.role='super_admin' and p_role<>'super_admin' and (select count(*) from public.profiles where role='super_admin')<=1 then raise exception '不能移除最后一位总园主'; end if;
 if p_role='grape_keeper' and (select count(*) from public.profiles where role='grape_keeper' and org_id=p_farm and id<>p_user)>=2 then raise exception '每个农场最多配置两位农场管家'; end if;
 if oldp.org_id is distinct from p_farm and oldp.id is not null and exists(
   select 1 from public.grape_receipts where owner_id=p_user union all select 1 from public.grape_consumptions where owner_id=p_user union all select 1 from public.recurring_consumption_plans where owner_id=p_user
   union all select 1 from public.supporters where owner_id=p_user union all select 1 from public.budget_plans where owner_id=p_user
 ) and p_role<>'super_admin' then raise exception '账号已有历史业务，不能直接跨农场转移；请保留历史归属并新建农场账号'; end if;
 insert into public.profiles(id,org_id,role,display_name,email,must_change_password)
 values(p_user,case when p_role='super_admin' then oldp.org_id else p_farm end,p_role,nullif(trim(p_name),''),lower(p_email),p_require_change)
 on conflict(id) do update set org_id=excluded.org_id,role=excluded.role,display_name=excluded.display_name,email=excluded.email,
 must_change_password=public.profiles.must_change_password or excluded.must_change_password;
 insert into public.audit_logs(org_id,owner_id,actor_id,action,entity_table,entity_id,old_data,new_data)
 values(coalesce(p_farm,oldp.org_id),p_user,auth.uid(),'account:assigned','profiles',p_user,
 case when oldp.id is not null then jsonb_build_object('role',oldp.role,'org_id',oldp.org_id) end,jsonb_build_object('role',p_role,'org_id',p_farm));
end $$;
commit;
