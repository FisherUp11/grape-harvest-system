begin;
-- 科目跨预算版本保持同一谱系，用于累计同一预算期内已发生的支出。
alter table public.budget_categories add column lineage_id uuid not null default gen_random_uuid();
create unique index budget_category_plan_lineage_idx on public.budget_categories(budget_plan_id,lineage_id);
create index budget_category_lineage_idx on public.budget_categories(lineage_id);
create or replace function private.guard_category_lineage() returns trigger language plpgsql set search_path='' as $$
declare plan public.budget_plans;
begin
 select * into plan from public.budget_plans where id=new.budget_plan_id;
 if tg_op='INSERT' then
   if exists(select 1 from public.budget_categories where lineage_id=new.lineage_id) and not exists(select 1 from public.budget_categories where budget_plan_id=plan.supersedes_id and lineage_id=new.lineage_id and owner_id=new.owner_id) then raise exception '预算科目只能继承直接原版本的同名谱系'; end if;
 else
   if new.lineage_id<>old.lineage_id then raise exception '科目历史关联不可修改'; end if;
   if new.deleted_at is distinct from old.deleted_at and exists(select 1 from public.grape_consumptions c join public.budget_categories bc on bc.id=c.budget_category_id where bc.lineage_id=old.lineage_id and c.deleted_at is null and c.status in ('pending','confirmed') and c.consumption_date between plan.period_start and plan.period_end) then raise exception '本预算期已有该科目支出，请保留科目并调整预算金额'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_category_lineage() from public,anon,authenticated;
create trigger budget_category_lineage_guard before insert or update on public.budget_categories for each row execute function private.guard_category_lineage();

create or replace function public.clone_budget_version(p_id uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare src public.budget_plans; newid uuid;
begin
 select * into src from public.budget_plans where id=p_id and owner_id=auth.uid() and status='confirmed';
 if not found or public.is_super_admin() then raise exception '只能从自己的已确认预算创建新版'; end if;
 insert into public.budget_plans(org_id,owner_id,title,period_start,period_end,version,notes,supersedes_id)
 values(src.org_id,src.owner_id,src.title,src.period_start,src.period_end,src.version+1,src.notes,src.id) returning id into newid;
 insert into public.budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount,sort_order,notes,lineage_id)
 select org_id,owner_id,newid,name,budgeted_amount,sort_order,notes,lineage_id from public.budget_categories where budget_plan_id=p_id and deleted_at is null;
 return newid;
end $$;

create or replace view public.budget_category_usage with(security_invoker=true) as
select bc.id as category_id,bc.budget_plan_id,bp.owner_id,bp.org_id,bp.status as plan_status,bp.period_start,bp.period_end,bc.name as category_name,bc.budgeted_amount,bc.sort_order,
coalesce(sum(gc.grape_amount+coalesce(correction.delta,0)) filter(where gc.status='confirmed'),0) as confirmed_consumed,
coalesce(sum(gc.grape_amount) filter(where gc.status='pending'),0) as pending_consumed
from public.budget_categories bc join public.budget_plans bp on bp.id=bc.budget_plan_id
left join public.budget_categories source on source.lineage_id=bc.lineage_id
left join public.grape_consumptions gc on gc.budget_category_id=source.id and gc.deleted_at is null and gc.consumption_date between bp.period_start and bp.period_end
left join(select target_id,sum(amount_delta) delta from public.record_corrections where target_table='grape_consumptions' and status='confirmed' and deleted_at is null group by target_id) correction on correction.target_id=gc.id
where bc.deleted_at is null and bp.deleted_at is null group by bc.id,bp.id;
commit;
