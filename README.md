# 收葡萄系统

面向单一机构多用户的“收葡萄”脱敏记录系统。系统区分承诺支持、实际收到、吃葡萄和葡萄存量；普通用户数据隔离，葡萄管家负责最终确认与查看全局数据。

## 技术栈

- Next.js App Router
- React / TypeScript
- Supabase Auth + PostgreSQL + RLS
- Vercel 部署

## 本地启动

1. 复制环境变量：`cp .env.example .env.local`
2. 在 Supabase 创建项目，并执行 [supabase/schema.sql](supabase/schema.sql)
3. 填写 `.env.local` 中的 Supabase URL 和 Anon Key
4. 安装依赖：`npm install`
5. 启动：`npm run dev`

完整部署步骤见 [docs/VERCEL_SUPABASE_DEPLOYMENT_GUIDE.md](docs/VERCEL_SUPABASE_DEPLOYMENT_GUIDE.md)。
