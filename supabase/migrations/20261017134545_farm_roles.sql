-- 枚举扩展必须独立提交，后续迁移才能使用新值。
alter type public.user_role add value if not exists 'super_admin';
alter type public.confirmation_status add value if not exists 'draft';
alter type public.confirmation_status add value if not exists 'returned';
