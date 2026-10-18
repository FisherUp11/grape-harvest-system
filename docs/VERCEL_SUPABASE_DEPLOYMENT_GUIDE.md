# 收葡萄系统部署指南

`gr.fisherai6.top` 的 Cloudflare、Vercel、Resend、Supabase 控制台逐项填写说明见 [域名与邮件配置教程](GR_DOMAIN_EMAIL_SETUP.md)。重置密码 HTML 位于 `supabase/templates/recovery.html`，须粘贴到 Supabase 控制台才会生效。

## 数据库升级

已有项目不要重跑 schema。新项目先在 Supabase SQL Editor 执行 `supabase/schema.sql`，再按文件名顺序执行 `supabase/migrations/20261017*.sql`，然后执行 `20261018061514_recurring_fixed_and_recall.sql` 、`20261018062422_schedule_fixed_consumptions.sql` 和 `20261018063700_review_record_revision.sql`。枚举扩展 `farm_roles` 必须单独执行并提交，然后执行 `farm_workflows`。旧 0002/0003 不应在全新 schema 上重复执行。

初始总园主邮箱为 `xiangyufei11@gmail.com`，迁移只提升 Auth 中已验证邮箱的账号；不创建密码、不重置现有密码。新环境须先在 Auth 创建并验证这个邮箱，再执行农场工作流迁移。其他初始化邮箱须在受控 SQL 中明确指定，不能通过注册 metadata 赋予总园主。

## 部署环境变量

复制 `.env.example`。本地 `NEXT_PUBLIC_SITE_URL=http://localhost:3000`，生产必须改为真实 HTTPS 地址。

| 配置                                                     | 作用                                        |
| -------------------------------------------------------- | ------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | 前端与会话客户端                            |
| NEXT_PUBLIC_SITE_URL                                     | 临时密码邮件登录地址、重置密码回调          |
| SUPABASE_SERVICE_ROLE_KEY                                | 服务端创建/重发账号、定时任务；禁止放浏览器 |
| RESEND_API_KEY / MAIL_FROM                               | 发件服务密钥及已验证发件人                  |
| NEXT_PUBLIC_DATABASE_QUOTA_MB                            | 数据库容量参考，默认 500                    |
| NEXT_PUBLIC_SUPABASE_STORAGE_QUOTA_GB                    | 文件容量参考，默认 1                        |
| CRON_SECRET                                              | 每日任务鉴权                                |
| ENABLE_MONTHLY_REPORT_EMAIL                              | 上月摘要邮件，可选，默认 false              |

未配置账号管理或发件服务时，页面提示尚未就绪，API 在创建/重置账号之前拒绝执行。已有账号的角色分配与容量读取仍可使用。邮箱密码重置使用 Supabase Auth 邮件，生产建议配置自定义 SMTP；账号临时密码邮件直接调用 Resend API，两者配置分别管理。

## 发布

1. `npm install`，执行 `npm test`、`npm run test:ui`、`npm run build`。
2. 将项目导入现有 Vercel 项目或其他 Next.js 主机，配置环境变量。不要发布 `.env.local`。
3. 数据库升级与新前端配套上线，避免旧页面使用新权限后缺少退回或总园主入口。
4. Supabase Auth Site URL 设置为生产域名，Redirect URLs 添加生产 `/auth/callback`、`/reset-password`，本地开发需要时另加 localhost。
5. 总园主登录后进入 `/estate`，核对实际容量及各农场管家数量；给每个农场分配 1–2 位管家。
6. 创建测试账号并发送临时密码，核验首次改密后可使用业务。邮件失败在账号列表重发，旧临时密码失效；不要重复创建。
7. 用不同农场账号核验隔离，分别检查固定自动生效、项目人工审核、退回修改、确认锁定和更正单。

## 维护

容量页每 30 秒刷新，70/80/90% 提醒；显示的额度需与实际平台套餐核对。审计与业务文字可导出 gzip JSON，图片须单独备份。导出不会自动清理历史。审计采用字段差异、分页查看，不会每次复制整个表或图片。

API 返回 503 表示配置尚未完成；502 表示账号已保留但邮件未确认送达，在列表重发。总园主不能确认业务属于预期权限；农场无管家时先分配，不以总园主代审。

完整设计见 [应用架构说明](APP_ARCHITECTURE.md)。

## 按月固定吃葡萄与召回

吃葡萄页可设置按月计划，计划本身不提前扣除。Supabase Cron 已安装并使用 `grape-fixed-consumptions-daily` 每天北京时间 00:05 处理到期记录；无需 Resend 配置。任务执行历史在 Supabase Integrations → Cron 中查看。后台暂停/故障恢复后会补到期期次；有预算阻塞的计划在页面显示原因。

固定吃葡萄凭证允许后补，成功上传后永久保留；项目与一次性仍需凭证再提交。待确认收支、更正单和预算支持本人召回；已确认不能召回。上线后应检查 cron.job 的 active 状态，并验证 `select public.sync_recurring_consumptions()` 返回到期处理统计。生产不要为了验证创建真实支出，测试数据使用本地隔离测试。
