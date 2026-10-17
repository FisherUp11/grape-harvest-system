begin;
alter table public.organizations add column fixed_requires_approval boolean not null default false;
alter table public.profiles alter column org_id drop not null;
alter table public.profiles add column must_change_password boolean not null default false;
alter table public.profiles add column onboarding_delivery_status text not null default 'not_required' check (onboarding_delivery_status in ('not_required','pending','sent','failed'));
alter table public.profiles add constraint profile_farm_required check (role = 'super_admin' or org_id is not null);

create or replace function private.ready() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and not must_change_password)
$$;
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='super_admin' and not must_change_password)
$$;
create or replace function public.is_grape_keeper() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='grape_keeper' and not must_change_password)
$$;
create or replace function public.can_read_farm(p_org uuid,p_owner uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select private.ready() and (public.is_super_admin() or (p_org=public.current_profile_org_id() and (p_owner=auth.uid() or public.is_grape_keeper())))
$$;
create or replace function public.can_record(p_org uuid,p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.ready() and not public.is_super_admin() and p_org=public.current_profile_org_id() and p_owner=auth.uid()
$$;
revoke all on function private.ready() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.ready() to authenticated;
revoke all on function public.is_super_admin(),public.can_read_farm(uuid,uuid),public.can_record(uuid,uuid) from public,anon;
grant execute on function public.is_super_admin(),public.can_read_farm(uuid,uuid),public.can_record(uuid,uuid) to authenticated;

-- 账号与农场分配仅经受控管理接口操作，不信任浏览器可编辑的 metadata。
create or replace function public.prevent_profile_privilege_escalation() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('postgres','supabase_admin','service_role') then return new; end if;
 if new.id<>old.id or new.role<>old.role or new.org_id is distinct from old.org_id or new.email is distinct from old.email
    or new.must_change_password<>old.must_change_password or new.onboarding_delivery_status<>old.onboarding_delivery_status then
   raise exception '账号角色、农场、邮箱与首次改密状态只能通过总园主管理接口设置';
 end if;
 if public.is_super_admin() then raise exception '总园主不修改用户业务参数'; end if;
 return new;
end $$;

create or replace function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
   update public.profiles set must_change_password=(old.raw_app_meta_data->>'onboarding_nonce' is distinct from new.raw_app_meta_data->>'onboarding_nonce') where id=new.id;
 end if;
 return new;
end $$;
revoke all on function private.password_changed() from public,anon,authenticated;
create trigger grape_password_changed after update of encrypted_password on auth.users for each row execute function private.password_changed();

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
   select 1 from public.grape_receipts where owner_id=p_user union all select 1 from public.grape_consumptions where owner_id=p_user
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
revoke all on function public.admin_assign_profile(uuid,uuid,public.user_role,text,text,boolean) from public,anon;
grant execute on function public.admin_assign_profile(uuid,uuid,public.user_role,text,text,boolean) to authenticated;
alter table public.audit_logs alter column org_id drop not null;

-- 增加草稿/退回、软删除及明确的提交版本。
do $$ declare t text; begin
 foreach t in array array['supporters','commitments','grape_receipts','grape_consumptions','budget_plans','budget_categories'] loop
 execute format('alter table public.%I add column deleted_at timestamptz, add column deleted_by uuid references public.profiles(id), add column deletion_reason text',t);
 end loop;
 foreach t in array array['grape_receipts','grape_consumptions'] loop
 execute format('alter table public.%I alter column status set default ''draft'', add column returned_by uuid references public.profiles(id), add column returned_at timestamptz, add column return_reason text, add column submitted_at timestamptz, add column revision_number integer not null default 1, add column approval_required boolean default true, add column auto_confirmed boolean not null default false',t);
 end loop;
end $$;
alter table public.budget_plans add column return_reason text;
alter table public.budget_plans add column supersedes_id uuid references public.budget_plans(id);

create table public.record_corrections(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id),owner_id uuid not null references public.profiles(id),
 target_table text not null check(target_table in ('grape_receipts','grape_consumptions')),target_id uuid not null,
 previous_amount numeric(12,2) not null,replacement_amount numeric(12,2) not null check(replacement_amount>=0),
 amount_delta numeric(12,2) generated always as (replacement_amount-previous_amount) stored,
 correction_date date not null default (now() at time zone 'Asia/Shanghai')::date,reason text not null check(length(trim(reason))>0),
 status public.confirmation_status not null default 'draft',confirmed_by uuid references public.profiles(id),confirmed_at timestamptz,
 returned_by uuid references public.profiles(id),returned_at timestamptz,return_reason text,submitted_at timestamptz,
 revision_number integer not null default 1,approval_required boolean not null default true,auto_confirmed boolean not null default false,
 deleted_at timestamptz,deleted_by uuid references public.profiles(id),deletion_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.record_corrections enable row level security;
create index corrections_target_idx on public.record_corrections(target_table,target_id,created_at);

-- 替换所有旧业务策略，避免宽松旧策略通过 OR 绕开新规则。
do $$ declare p record; t text; begin
 for p in select tablename,policyname from pg_policies where schemaname='public' and tablename=any(array['organizations','profiles','supporters','commitments','commitment_periods','grape_receipts','grape_consumptions','budget_plans','budget_categories','grape_consumption_attachments','audit_logs','record_corrections']) loop
 execute format('drop policy %I on public.%I',p.policyname,p.tablename);
 end loop;
 foreach t in array array['supporters','commitments','commitment_periods','grape_receipts','grape_consumptions','budget_plans','budget_categories','grape_consumption_attachments','record_corrections'] loop
 execute format('create policy scoped_read on public.%I for select to authenticated using(public.can_read_farm(org_id,owner_id))',t);
 execute format('create policy own_insert on public.%I for insert to authenticated with check(public.can_record(org_id,owner_id))',t);
 execute format('create policy own_or_keeper_update on public.%I for update to authenticated using(public.can_record(org_id,owner_id) or (public.is_grape_keeper() and org_id=public.current_profile_org_id())) with check(public.can_record(org_id,owner_id) or (public.is_grape_keeper() and org_id=public.current_profile_org_id()))',t);
 end loop;
end $$;
create policy farm_read on public.organizations for select to authenticated using(public.is_super_admin() or (private.ready() and id=public.current_profile_org_id()));
create policy farm_create on public.organizations for insert to authenticated with check(public.is_super_admin());
create policy farm_policy_update on public.organizations for update to authenticated using(public.is_grape_keeper() and id=public.current_profile_org_id()) with check(public.is_grape_keeper() and id=public.current_profile_org_id());
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or public.is_super_admin() or (private.ready() and org_id=public.current_profile_org_id() and (public.is_grape_keeper() or role='grape_keeper')));
create policy profile_parameter_update on public.profiles for update to authenticated using(private.ready() and not public.is_super_admin() and (id=auth.uid() or (public.is_grape_keeper() and org_id=public.current_profile_org_id()))) with check(private.ready() and not public.is_super_admin() and (id=auth.uid() or (public.is_grape_keeper() and org_id=public.current_profile_org_id())));
create policy audit_read on public.audit_logs for select to authenticated using(public.is_super_admin() or (private.ready() and (owner_id=auth.uid() or (public.is_grape_keeper() and org_id=public.current_profile_org_id()))));
-- 仅未提交/已退回凭证可清理；业务文本永不硬删。
create policy attachment_delete on public.grape_consumption_attachments for delete to authenticated using(public.can_record(org_id,owner_id) and exists(select 1 from public.grape_consumptions c where c.id=consumption_id and c.status in ('draft','returned') and c.deleted_at is null));

create or replace function private.guard_business_record() returns trigger language plpgsql set search_path='' as $$
declare oldj jsonb; newj jsonb:=to_jsonb(new); patch jsonb:='{}'; editable boolean; required boolean; current_amount numeric;
begin
 if public.is_super_admin() or not private.ready() then raise exception '总园主只读业务数据，或账号尚未完成首次改密'; end if;
 if tg_op='INSERT' then
   if new.status<>'draft' or not public.can_record(new.org_id,new.owner_id) then raise exception '只能创建自己的草稿'; end if;
   return jsonb_populate_record(new,jsonb_build_object('confirmed_by',null,'confirmed_at',null,'returned_by',null,'returned_at',null,'return_reason',null,'submitted_at',null,'revision_number',1,'approval_required',case when tg_table_name='grape_consumptions' then null else true end,'auto_confirmed',false,'deleted_at',null,'deleted_by',null,'deletion_reason',null));
 end if;
 oldj:=to_jsonb(old);
 if old.status='confirmed' or old.deleted_at is not null then raise exception '已确认或已作废记录永久锁定，不能修改'; end if;
 if new.id<>old.id or new.owner_id<>old.owner_id or new.org_id<>old.org_id or new.created_at<>old.created_at then raise exception '记录归属不可修改'; end if;
 if (newj-array['status','confirmed_by','confirmed_at','returned_by','returned_at','return_reason','submitted_at','revision_number','approval_required','auto_confirmed','updated_at','amount_delta']) is distinct from
    (oldj-array['status','confirmed_by','confirmed_at','returned_by','returned_at','return_reason','submitted_at','revision_number','approval_required','auto_confirmed','updated_at','amount_delta']) and not (old.owner_id=auth.uid() and old.status in ('draft','returned')) then
   raise exception '提交后必须由农场管家退回才能修改';
 end if;
 if new.deleted_at is distinct from old.deleted_at then
   if not public.can_record(old.org_id,old.owner_id) or old.status not in ('draft','returned') or nullif(trim(new.deletion_reason),'') is null then raise exception '仅可作废自己的草稿或退回记录，并填写原因'; end if;
   return jsonb_populate_record(new,jsonb_build_object('deleted_at',now(),'deleted_by',auth.uid()));
 end if;
 -- 受保护的审核字段只能由本触发器生成。
 patch:=jsonb_build_object('confirmed_by',old.confirmed_by,'confirmed_at',old.confirmed_at,'returned_by',old.returned_by,'returned_at',old.returned_at,'submitted_at',old.submitted_at,'revision_number',old.revision_number,'approval_required',old.approval_required,'auto_confirmed',old.auto_confirmed,'return_reason',old.return_reason);
 if new.status<>old.status then
   if new.status='pending' and old.status in ('draft','returned') and public.can_record(old.org_id,old.owner_id) then
     required:=coalesce(old.approval_required,true);
     if tg_table_name='grape_consumptions' then
       if not new.attachments_ready or not exists(select 1 from public.grape_consumption_attachments where consumption_id=new.id) then raise exception '请先完成至少一个凭证上传'; end if;
       if old.approval_required is null then select (new.consumption_type<>'fixed' or fixed_requires_approval) into required from public.organizations where id=new.org_id; end if;
     end if;
     patch:=patch||jsonb_build_object('submitted_at',now(),'revision_number',old.revision_number+case when old.status='returned' then 1 else 0 end,'approval_required',required);
     if not required then patch:=patch||jsonb_build_object('status','confirmed','confirmed_at',now(),'auto_confirmed',true,'confirmed_by',null); end if;
   elsif old.status='pending' and new.status in ('returned','confirmed') and public.is_grape_keeper() and old.org_id=public.current_profile_org_id() then
     if new.status='returned' then
       if nullif(trim(new.return_reason),'') is null then raise exception '请填写退回原因'; end if;
       patch:=patch||jsonb_build_object('returned_by',auth.uid(),'returned_at',now(),'return_reason',new.return_reason);
     else
       if tg_table_name='grape_consumptions' then if not old.attachments_ready or not exists(select 1 from public.grape_consumption_attachments where consumption_id=old.id) then raise exception '凭证不完整，不能确认'; end if; end if;
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
 elsif old.status='pending' then raise exception '待确认记录只能由农场管家确认或退回';
 elsif not public.can_record(old.org_id,old.owner_id) then raise exception '只能修改自己的草稿或退回记录';
 end if;
 return jsonb_populate_record(new,patch);
end $$;
revoke all on function private.guard_business_record() from public,anon,authenticated;
drop trigger grape_receipts_lock on public.grape_receipts;
drop trigger grape_consumptions_lock on public.grape_consumptions;
create trigger grape_receipts_lock before insert or update on public.grape_receipts for each row execute function private.guard_business_record();
create trigger grape_consumptions_lock before insert or update on public.grape_consumptions for each row execute function private.guard_business_record();
create trigger correction_workflow before insert or update on public.record_corrections for each row execute function private.guard_business_record();

create or replace function public.enforce_attachment_limit() returns trigger language plpgsql set search_path='' as $$
declare parent public.grape_consumptions;
begin
 select * into parent from public.grape_consumptions where id=new.consumption_id for update;
 if not found or not public.can_record(parent.org_id,parent.owner_id) or new.owner_id<>parent.owner_id or new.org_id<>parent.org_id then raise exception '凭证归属不匹配'; end if;
 if parent.status not in ('draft','returned') or parent.deleted_at is not null then raise exception '只有草稿或退回记录可修改凭证'; end if;
 if (select count(*) from public.grape_consumption_attachments where consumption_id=new.consumption_id)>=5 then raise exception '每条记录最多 5 个凭证'; end if;
 if split_part(new.file_path,'/',1)<>new.owner_id::text or split_part(new.file_path,'/',2)<>new.consumption_id::text or new.file_size not between 1 and 8388608 then raise exception '凭证路径或大小不正确'; end if;
 return new;
end $$;
drop policy own_or_keeper_update on public.grape_consumption_attachments;

create or replace function public.sync_receipt_period() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then return old; end if;
 if new.commitment_period_id is null then return new; end if;
 if new.deleted_at is not null then
   update public.commitment_periods set status='not_received',actual_receipt_id=null,actual_grapes=null,received_at=null,confirmed_by=null,confirmed_at=null where id=new.commitment_period_id;
 else
   update public.commitment_periods set status=case new.status when 'confirmed' then 'confirmed'::public.period_status when 'pending' then 'pending_confirmation'::public.period_status else 'not_received'::public.period_status end,
   actual_receipt_id=new.id,actual_grapes=new.grape_amount,received_at=new.received_date::timestamptz,confirmed_by=new.confirmed_by,confirmed_at=new.confirmed_at where id=new.commitment_period_id;
 end if;
 return new;
end $$;

create or replace function private.owner_editable() returns trigger language plpgsql set search_path='' as $$
begin
 if not public.can_record(new.org_id,new.owner_id) then raise exception '只能维护自己的业务资料'; end if;
 if tg_op='UPDATE' then
   if old.deleted_at is not null then raise exception '作废资料不可修改'; end if;
   if new.deleted_at is distinct from old.deleted_at then
     if nullif(trim(new.deletion_reason),'') is null then raise exception '请填写作废原因'; end if;
     new.deleted_at:=now();new.deleted_by:=auth.uid();
   end if;
 end if;
 return new;
end $$;
revoke all on function private.owner_editable() from public,anon,authenticated;
create trigger supporters_editable before insert or update on public.supporters for each row execute function private.owner_editable();
create trigger commitments_editable before insert or update on public.commitments for each row execute function private.owner_editable();

create or replace function private.validate_correction() returns trigger language plpgsql set search_path='' as $$
declare amount numeric; original_owner uuid; original_org uuid;
begin
 if new.target_table not in ('grape_receipts','grape_consumptions') then raise exception '更正类型无效'; end if;
 if tg_op='UPDATE' then
   if new.target_table<>old.target_table or new.target_id<>old.target_id or new.previous_amount<>old.previous_amount then raise exception '更正关联原单不可改变'; end if;
 else
   execute format('select grape_amount,owner_id,org_id from public.%I where id=$1 and status=''confirmed'' and deleted_at is null',new.target_table) into amount,original_owner,original_org using new.target_id;
   if amount is null or original_owner<>auth.uid() or original_owner<>new.owner_id or original_org<>new.org_id then raise exception '只能更正自己已确认的原单'; end if;
   new.previous_amount:=amount+coalesce((select sum(amount_delta) from public.record_corrections where target_table=new.target_table and target_id=new.target_id and status='confirmed'),0);
 end if;
 return new;
end $$;
revoke all on function private.validate_correction() from public,anon,authenticated;
create trigger correction_target_guard before insert or update on public.record_corrections for each row execute function private.validate_correction();

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
   else raise exception '只能由管家退回待审核预算后再修改；已确认版本不可解锁'; end if;
   if (to_jsonb(new)-array['status','confirmed_by','confirmed_at','unlocked_by','unlocked_at','return_reason','submitted_at','updated_at']) is distinct from (to_jsonb(old)-array['status','confirmed_by','confirmed_at','unlocked_by','unlocked_at','return_reason','submitted_at','updated_at']) then raise exception '状态操作不能同时修改预算内容'; end if;
 elsif old.status not in ('draft','revision_unlocked') or not public.can_record(old.org_id,old.owner_id) then raise exception '预算已提交，请先等待管家退回';
 end if;
 return new;
end $$;

create or replace function public.clone_budget_version(p_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare src public.budget_plans; newid uuid;
begin
 select * into src from public.budget_plans where id=p_id and owner_id=auth.uid() and status='confirmed';
 if not found or public.is_super_admin() then raise exception '只能从自己的已确认预算创建新版'; end if;
 insert into public.budget_plans(org_id,owner_id,title,period_start,period_end,version,notes,supersedes_id)
 values(src.org_id,src.owner_id,src.title,src.period_start,src.period_end,src.version+1,src.notes,src.id) returning id into newid;
 insert into public.budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount,sort_order,notes)
 select org_id,owner_id,newid,name,budgeted_amount,sort_order,notes from public.budget_categories where budget_plan_id=p_id and deleted_at is null;
 return newid;
end $$;
revoke all on function public.clone_budget_version(uuid) from public,anon;
grant execute on function public.clone_budget_version(uuid) to authenticated;

-- 统一业务动作入口，保留行级锁与各表触发器的最终检查。
create or replace function public.record_action(p_table text,p_id uuid,p_action text,p_reason text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare rowstate public.confirmation_status;
begin
 if p_table not in ('grape_receipts','grape_consumptions','record_corrections') then raise exception '记录类型无效'; end if;
 execute format('select status from public.%I where id=$1 for update',p_table) into rowstate using p_id;
 if rowstate is null then raise exception '记录不存在或无权限'; end if;
 if p_action='submit' then
   execute format('update public.%I set status=''pending'' where id=$1',p_table) using p_id;
 elsif p_action='confirm' then
   execute format('update public.%I set status=''confirmed'' where id=$1',p_table) using p_id;
 elsif p_action='return' then
   execute format('update public.%I set status=''returned'',return_reason=$2 where id=$1',p_table) using p_id,p_reason;
 elsif p_action='archive' then
   execute format('update public.%I set deleted_at=now(),deletion_reason=$2 where id=$1',p_table) using p_id,p_reason;
 else raise exception '动作无效'; end if;
end $$;
revoke all on function public.record_action(text,uuid,text,text) from public,anon;
grant execute on function public.record_action(text,uuid,text,text) to authenticated;

-- 审计仅记录变化的字段，技术上传标志和更新时间不产生重复日志。
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
 tg_table_name||':'||case when tg_op='UPDATE' and rowdata->>'deleted_at' is not null then 'archived' else lower(tg_op) end,entity,eid,a,b);
 return coalesce(new,old);
end $$;
create trigger corrections_audit after insert or update on public.record_corrections for each row execute function private.audit_business_change();
create trigger farms_audit after insert or update on public.organizations for each row execute function private.audit_business_change();

-- 全局真实容量，只允许完成首次改密的总园主调用。
create or replace function public.get_estate_capacity() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_super_admin() then raise exception '只有总园主可查看全局容量'; end if;
 select jsonb_build_object('database_bytes',pg_database_size(current_database()),'audit_bytes',pg_total_relation_size('public.audit_logs'),
 'audit_count',(select count(*) from public.audit_logs),'storage_bytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects),
 'storage_count',(select count(*) from storage.objects),'measured_at',now(),
 'farms',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'user_count',(select count(*) from public.profiles where org_id=o.id and role<>'super_admin'),
 'keeper_count',(select count(*) from public.profiles where org_id=o.id and role='grape_keeper'),
 'pending_count',((select count(*) from public.grape_receipts where org_id=o.id and status='pending' and deleted_at is null)+(select count(*) from public.grape_consumptions where org_id=o.id and status='pending' and deleted_at is null)+(select count(*) from public.record_corrections where org_id=o.id and status='pending' and deleted_at is null)+(select count(*) from public.budget_plans where org_id=o.id and status in ('pending_confirmation','revision_pending_confirmation') and deleted_at is null)),
 'storage_bytes',(select coalesce(sum((s.metadata->>'size')::bigint),0) from storage.objects s join public.profiles p on p.id::text=split_part(s.name,'/',1) where p.org_id=o.id))), '[]') from public.organizations o)) into result;
 return result;
end $$;
revoke all on function public.get_estate_capacity() from public,anon;
grant execute on function public.get_estate_capacity() to authenticated;

create or replace function public.get_storage_usage_summary() returns table(bucket_id text,object_count bigint,total_bytes bigint)
language sql stable security definer set search_path='' as $$
 select s.bucket_id,count(*)::bigint,coalesce(sum((s.metadata->>'size')::bigint),0)::bigint from storage.objects s left join public.profiles p on p.id::text=split_part(s.name,'/',1)
 where private.ready() and (public.is_super_admin() or (s.bucket_id='consumption-attachments' and p.org_id=public.current_profile_org_id() and (p.id=auth.uid() or public.is_grape_keeper()))) group by s.bucket_id
$$;

-- 存储策略与文字记录同样隔离，首次改密前不可访问。
do $$ declare p record; begin for p in select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'consumption attachments%' loop execute format('drop policy %I on storage.objects',p.policyname); end loop; end $$;
create policy "consumption attachments scoped read" on storage.objects for select to authenticated using(private.ready() and bucket_id='consumption-attachments' and (public.is_super_admin() or exists(select 1 from public.profiles p where p.id::text=(storage.foldername(name))[1] and public.can_read_farm(p.org_id,p.id))));
create policy "consumption attachments own insert" on storage.objects for insert to authenticated with check(bucket_id='consumption-attachments' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.grape_consumptions c where c.id::text=(storage.foldername(name))[2] and public.can_record(c.org_id,c.owner_id) and c.status in ('draft','returned') and c.deleted_at is null));
create policy "consumption attachments draft delete" on storage.objects for delete to authenticated using(bucket_id='consumption-attachments' and private.ready() and not public.is_super_admin() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.grape_consumptions c where c.id::text=(storage.foldername(name))[2] and c.status not in ('draft','returned')));

-- 所有旧已确认单保持不变；更正增量在独立视图合并进统计。
create or replace view public.ledger_receipts with(security_invoker=true) as
 select id,org_id,owner_id,supporter_id,received_date,grape_amount,receipt_method,status,notes,confirmed_by,confirmed_at,created_at,false as is_correction from public.grape_receipts where deleted_at is null
 union all select c.id,c.org_id,c.owner_id,r.supporter_id,c.correction_date,c.amount_delta,'other'::public.receipt_method,c.status,'更正：'||c.reason,c.confirmed_by,c.confirmed_at,c.created_at,true from public.record_corrections c join public.grape_receipts r on r.id=c.target_id where c.target_table='grape_receipts' and c.status='confirmed' and c.deleted_at is null;
create or replace view public.ledger_consumptions with(security_invoker=true) as
 select id,org_id,owner_id,consumption_date,grape_amount,consumption_type,description,status,confirmed_by,confirmed_at,created_at,false as is_correction from public.grape_consumptions where deleted_at is null
 union all select id,org_id,owner_id,correction_date,amount_delta,'one_time'::public.consumption_type,'更正：'||reason,status,confirmed_by,confirmed_at,created_at,true from public.record_corrections where target_table='grape_consumptions' and status='confirmed' and deleted_at is null;
create or replace view public.grape_user_balances with(security_invoker=true) as
 select p.org_id,p.id as owner_id,p.display_name,p.email,coalesce(r.total,0) as confirmed_received,coalesce(c.total,0) as confirmed_consumed,
 coalesce(r.total,0)-coalesce(c.total,0) as grape_balance,p.grape_alert_threshold,p.monthly_fixed_consumption from public.profiles p
 left join(select owner_id,sum(grape_amount) total from public.ledger_receipts where status='confirmed' group by owner_id) r on r.owner_id=p.id
 left join(select owner_id,sum(grape_amount) total from public.ledger_consumptions where status='confirmed' group by owner_id) c on c.owner_id=p.id;
grant select,insert,update on public.record_corrections to authenticated;
grant all on public.record_corrections to service_role;
grant select on public.ledger_receipts,public.ledger_consumptions to authenticated,service_role;
create index audit_org_created_idx on public.audit_logs(org_id,created_at desc);
create index audit_owner_created_idx on public.audit_logs(owner_id,created_at desc);


create or replace function private.guard_farm_update() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'fixed_requires_approval') is distinct from (to_jsonb(old)-'fixed_requires_approval') then raise exception '农场管家仅能修改本农场固定吃葡萄审核开关'; end if;
 return new;
end $$;
revoke all on function private.guard_farm_update() from public,anon,authenticated;
create trigger farm_update_guard before update on public.organizations for each row execute function private.guard_farm_update();
create or replace function private.guard_budget_insert() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status<>'draft' or new.confirmed_by is not null or new.confirmed_at is not null or not public.can_record(new.org_id,new.owner_id) then raise exception '预算必须从自己的草稿开始'; end if;
 if new.supersedes_id is not null and not exists(select 1 from public.budget_plans where id=new.supersedes_id and owner_id=new.owner_id and org_id=new.org_id and status='confirmed') then raise exception '新版预算必须关联自己的已确认原版本'; end if;
 return new;
end $$;
revoke all on function private.guard_budget_insert() from public,anon,authenticated;
create trigger budget_insert_guard before insert on public.budget_plans for each row execute function private.guard_budget_insert();
create trigger budget_category_soft_delete_guard before insert or update on public.budget_categories for each row execute function private.owner_editable();

-- 仅为人工指定且已验证邮箱的现有账号初始化，不基于可编辑 metadata 自动授予角色。
insert into public.profiles(id,org_id,role,display_name,email)
 select id,null,'super_admin','葡萄总园主',email from auth.users where lower(email)='xiangyufei11@gmail.com' and email_confirmed_at is not null
 on conflict(id) do update set role='super_admin';
insert into public.audit_logs(org_id,owner_id,actor_id,action,entity_table,entity_id,new_data)
 select org_id,id,id,'account:bootstrap_super_admin','profiles',id,jsonb_build_object('role','super_admin','reason','用户明确指定初始化邮箱') from public.profiles where lower(email)='xiangyufei11@gmail.com' and role='super_admin';

create or replace view public.budget_category_usage with(security_invoker=true) as
select bc.id as category_id,bc.budget_plan_id,bp.owner_id,bp.org_id,bp.status as plan_status,bp.period_start,bp.period_end,bc.name as category_name,bc.budgeted_amount,bc.sort_order,
coalesce(sum(gc.grape_amount+coalesce(correction.delta,0)) filter(where gc.status='confirmed'),0) as confirmed_consumed,
coalesce(sum(gc.grape_amount) filter(where gc.status='pending'),0) as pending_consumed
from public.budget_categories bc join public.budget_plans bp on bp.id=bc.budget_plan_id
left join public.grape_consumptions gc on gc.budget_category_id=bc.id and gc.deleted_at is null
left join (select target_id,sum(amount_delta) delta from public.record_corrections where target_table='grape_consumptions' and status='confirmed' and deleted_at is null group by target_id) correction on correction.target_id=gc.id
where bc.deleted_at is null and bp.deleted_at is null group by bc.id,bp.id;
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
    if exists (select 1 from public.grape_receipts where commitment_period_id = new.commitment_period_id and id <> new.id and deleted_at is null) then
      raise exception '该期次已有收葡萄记录，请在收葡萄页修改';
    end if;
  elsif new.commitment_id is not null or new.source_type = 'commitment' then raise exception '来自承诺的收葡萄必须关联期次';
  end if;
  return new;
end $$;


-- 期次的实际收款/审核字段只能由收款同步触发器写入，不能绕过收款直接改账。
create or replace function public.prevent_confirmed_period_change() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   if new.status not in ('not_received','overdue') or new.actual_receipt_id is not null or new.actual_grapes is not null or new.confirmed_by is not null or new.confirmed_at is not null or new.received_at is not null then raise exception '新期次只能登记预期信息'; end if;
 elsif pg_trigger_depth()=1 then
   if old.status='confirmed' or old.status='pending_confirmation' or old.actual_receipt_id is not null then raise exception '已登记收款的期次只能随原收款流程变化'; end if;
   if not public.can_record(old.org_id,old.owner_id) or new.status not in ('not_received','overdue','stopped','cancelled') then raise exception '只能维护自己的未收款期次'; end if;
   if new.id<>old.id or new.owner_id<>old.owner_id or new.org_id<>old.org_id or new.commitment_id<>old.commitment_id or new.supporter_id<>old.supporter_id or new.actual_receipt_id is distinct from old.actual_receipt_id or new.actual_grapes is distinct from old.actual_grapes or new.confirmed_by is distinct from old.confirmed_by or new.confirmed_at is distinct from old.confirmed_at or new.received_at is distinct from old.received_at then raise exception '实际收款信息由收款记录同步'; end if;
 end if;
 return new;
end $$;
drop trigger commitment_periods_lock on public.commitment_periods;
create trigger commitment_periods_lock before insert or update on public.commitment_periods for each row execute function public.prevent_confirmed_period_change();

create or replace function public.enforce_consumption_budget_category() returns trigger language plpgsql set search_path='' as $$
begin
 if new.grape_amount<=0 then raise exception '葡萄数必须大于 0'; end if;
 -- 历史已提交单据沿用原预算；新建、改日期、改科目或重新提交须检查最新生效版本。
 if tg_op='UPDATE' then
   if old.status='pending' or old.status='confirmed' then return new; end if;
   if new.consumption_date=old.consumption_date and new.budget_category_id is not distinct from old.budget_category_id and new.status=old.status then return new; end if;
 end if;
 if new.budget_category_id is not null and not exists(
   select 1 from public.budget_categories bc join public.budget_plans bp on bp.id=bc.budget_plan_id
   where bc.id=new.budget_category_id and bc.deleted_at is null and bp.deleted_at is null and bp.owner_id=new.owner_id and bp.org_id=new.org_id
   and bp.status='confirmed' and new.consumption_date between bp.period_start and bp.period_end
   and not exists(select 1 from public.budget_plans n where n.supersedes_id=bp.id and n.status='confirmed' and n.deleted_at is null)
 ) then raise exception '所选科目不属于该日期的最新生效预算'; end if;
 if new.budget_category_id is null and exists(select 1 from public.budget_plans bp where bp.owner_id=new.owner_id and bp.status='confirmed' and bp.deleted_at is null and new.consumption_date between bp.period_start and bp.period_end
   and not exists(select 1 from public.budget_plans n where n.supersedes_id=bp.id and n.status='confirmed' and n.deleted_at is null)) then raise exception '该日期已有生效预算，请选择科目'; end if;
 return new;
end $$;

create or replace function public.stop_commitment(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.commitments where id=p_id and owner_id=auth.uid() and status='active' and deleted_at is null for update;
 if not found then raise exception '承诺不存在、已停止或不属于你'; end if;
 update public.commitments set status='stopped' where id=p_id;
 update public.commitment_periods set status='stopped',stopped_at=now() where commitment_id=p_id and status in ('not_received','overdue') and actual_receipt_id is null;
end $$;
commit;
