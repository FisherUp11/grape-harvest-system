begin;
create or replace function public.record_action_checked(p_table text,p_id uuid,p_action text,p_revision integer,p_reason text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare revision integer;
begin
 if p_table not in ('grape_receipts','grape_consumptions','record_corrections') then raise exception '记录类型无效'; end if;
 execute format('select revision_number from public.%I where id=$1 for update',p_table) into revision using p_id;
 if revision is null or p_revision is null or revision<>p_revision then raise exception '记录已召回或更新，请刷新核对最新版本后再操作'; end if;
 perform public.record_action(p_table,p_id,p_action,p_reason);
end $$;
revoke all on function public.record_action_checked(text,uuid,text,integer,text) from public,anon;
grant execute on function public.record_action_checked(text,uuid,text,integer,text) to authenticated;
commit;
