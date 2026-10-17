begin;
-- 旧触发器固定搜索路径；授权查询工具仅对登录角色开放。
alter function public.touch_updated_at() set search_path='';
alter function public.prevent_confirmed_delete() set search_path='';
alter function public.enforce_budget_category_editable() set search_path='';
alter function public.prevent_confirmed_attachment_delete() set search_path='';
revoke all on function public.current_profile_org_id(),public.current_user_role(),public.is_grape_keeper() from public,anon;
grant execute on function public.current_profile_org_id(),public.current_user_role(),public.is_grape_keeper() to authenticated,service_role;

-- 与行无关的身份查询按语句缓存，避免每行重新计算。
alter policy profile_read on public.profiles using(id=(select auth.uid()) or (select public.is_super_admin()) or ((select private.ready()) and org_id=(select public.current_profile_org_id()) and ((select public.is_grape_keeper()) or role='grape_keeper')));
alter policy profile_parameter_update on public.profiles using((select private.ready()) and not (select public.is_super_admin()) and (id=(select auth.uid()) or ((select public.is_grape_keeper()) and org_id=(select public.current_profile_org_id())))) with check((select private.ready()) and not (select public.is_super_admin()) and (id=(select auth.uid()) or ((select public.is_grape_keeper()) and org_id=(select public.current_profile_org_id()))));
alter policy audit_read on public.audit_logs using((select public.is_super_admin()) or ((select private.ready()) and (owner_id=(select auth.uid()) or ((select public.is_grape_keeper()) and org_id=(select public.current_profile_org_id())))));

-- 不允许客户端伪造软删除人/时间；保留既有归属和不可变记录规则。
create or replace function private.owner_editable() returns trigger language plpgsql set search_path='' as $$
begin
 if not public.can_record(new.org_id,new.owner_id) then raise exception '只能维护自己的业务资料'; end if;
 if tg_op='INSERT' then new.deleted_at:=null;new.deleted_by:=null;new.deletion_reason:=null;
 else
   if old.deleted_at is not null then raise exception '作废资料不可修改'; end if;
   if new.deleted_at is distinct from old.deleted_at then
     if nullif(trim(new.deletion_reason),'') is null then raise exception '请填写作废原因'; end if;
     new.deleted_at:=now();new.deleted_by:=auth.uid();
   else new.deleted_by:=old.deleted_by;new.deletion_reason:=old.deletion_reason;
   end if;
 end if;
 return new;
end $$;
commit;
