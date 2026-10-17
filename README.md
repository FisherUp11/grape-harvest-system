# 收葡萄系统

面向 20 人以内、多个葡萄农场的收支记录系统。承诺支持、实际收到、实际使用分开登记，审核生效后计入存量和月报。

- **葡萄总园主**：创建农场、创建账号并分配角色、查看所有农场和实际容量。业务只读，不能代改或确认。
- **农场管家**：查看本农场成员、管理提醒参数、确认或退回本农场记录，设置固定吃葡萄是否免确认。每个农场最多两位。
- **记录者**：维护自己的资料、提交记录和更正单。提交后锁定，管家退回后才可修改；确认后原单永久锁定。

固定吃葡萄默认免确认；项目、一次性吃葡萄与更正单始终需要管家确认。图片上传前清晰压缩，提供放大核对和原图选项。界面支持手机卡片、底部导航及电脑表格。

## 启动与升级

Next.js 14 App Router、React 18、TypeScript、Supabase Auth/PostgreSQL/Storage。

1. `npm install`，复制 `.env.example` 为 `.env.local` 并填写 Supabase URL 和 anon key。
2. 全新数据库先执行 `supabase/schema.sql`；已有项目不要重跑 schema。
3. 按文件名顺序分别执行 `supabase/migrations/20261017*.sql`。枚举迁移必须单独提交，之后再执行农场工作流迁移。不要在全新 schema 上重跑历史 0002/0003。
4. `npm run dev`。生产运行需 `npm run build` 后部署。

账号创建与临时密码邮件需要服务端 `SUPABASE_SERVICE_ROLE_KEY`、`RESEND_API_KEY`、`MAIL_FROM` 和正确的 `NEXT_PUBLIC_SITE_URL`。密钥不带 `NEXT_PUBLIC_` 前缀；未配置时明确拒绝创建，避免生成无法送达的账号。已有账号角色分配和容量查看无需服务端密钥。

## 容量与审计

总园主 `/estate` 显示数据库实际大小、审计大小与条数、文件实际用量、各农场成员/管家/待审核数；可见页面每 30 秒刷新，也支持手动刷新。70%、80%、90% 提醒，配额为环境变量配置参考。`/audit` 可筛选分页查看，支持 gzip 审计归档与业务文字备份；不会自动清除历史。

验证：`npm test`、`npm run test:ui`（本机 Chrome）、`npm run build`。

详见 [应用架构说明](docs/APP_ARCHITECTURE.md) 和 [部署指南](docs/VERCEL_SUPABASE_DEPLOYMENT_GUIDE.md)。
