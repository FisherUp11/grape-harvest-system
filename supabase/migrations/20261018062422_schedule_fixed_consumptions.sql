begin;
create extension if not exists pg_cron with schema pg_catalog;
-- UTC 16:05 = Asia/Shanghai next day 00:05. Only arrived dates are processed.
select cron.schedule('grape-fixed-consumptions-daily','5 16 * * *',
  $job$select public.sync_recurring_consumptions();
  delete from cron.job_run_details where jobid=(select jobid from cron.job where jobname='grape-fixed-consumptions-daily') and end_time<now()-interval '30 days';$job$);
commit;
