# gr.fisherai6.top 域名与账号邮件配置（逐项操作）

适用项目：`grape-harvest-system`；Supabase 项目：`xkolwcidzixuvstubghw`。用户已确认 Resend 中的 `fisherai6.top` 为 **Verified**。

## 最终填写的地址

| 用途 | 值 |
| --- | --- |
| 网站 | `https://gr.fisherai6.top` |
| 登录页 | `https://gr.fisherai6.top/login` |
| 总园主管理页 | `https://gr.fisherai6.top/estate` |
| 发件邮箱 | `grape@fisherai6.top` |
| 发件名称 | `收葡萄` |
| Supabase API 地址（保留原值） | `https://xkolwcidzixuvstubghw.supabase.co` |

网站域名和发件域名用途不同。已验证 `fisherai6.top` 后可以使用 `grape@fisherai6.top` 发信，无需购买邮箱，也无需单独验证 `gr.fisherai6.top` 为邮件域名。这个地址仅用于发信；它不会自动成为能收信的邮箱。

现有系统有两条邮件路径，必须分别配置：

- 总园主创建账号、重发临时密码：**Vercel 网站 → Resend API**。
- 登录页“忘记密码”：**Supabase Auth → Resend SMTP**。

只配置其中一条，不会自动启用另一条。

## 1. Vercel 添加网站域名

1. 登录 Vercel，切换到拥有当前 `grape-harvest-system.vercel.app` 的账号或 Team。
2. 打开 **grape-harvest-system** 项目，进入 **Settings → Domains**。
3. 点击 **Add Domain / Add Existing**，输入 `gr.fisherai6.top`，不要填 `https://`，也不要填 `/login`。
4. 关联到 **Production**。如有选项，选择将域名连接到项目，不要把它设置成跳转到旧 `vercel.app` 域名。
5. 页面会显示需要添加的 DNS 记录。记下它要求的 **CNAME Value / Target** 完整内容。以这个项目的实际提示为准，不能照抄截图里 `le` 或 `color` 的目标。
6. 暂时保持此页面打开，下一步在 Cloudflare 添加记录。

## 2. Cloudflare 添加网站 DNS

打开截图中的 **fisherai6.top → DNS → Records**，点击右侧蓝色 **Add record**：

| Cloudflare 字段 | 填写 |
| --- | --- |
| Type | `CNAME` |
| Name | `gr` |
| Target / Content | 第 1 步中 Vercel 显示的完整 CNAME 目标 |
| Proxy status | **DNS only，灰色云朵** |
| TTL | `Auto` |

1. 点击 **Save**。
2. 如果已经存在名字为 `gr` 的 A、AAAA 或 CNAME 记录，先检查是否属于本系统；修改对应记录，不能给同一名字同时添加冲突的 CNAME 和 A/AAAA。
3. 回到 Vercel Domains，点击 **Refresh / Recheck**。
4. 如果 Vercel 额外要求所有权 TXT 验证，就按它显示的 Type、Name、Value 再添加一条。其他系统的 `_vercel` TXT 要保留；多条所有权 TXT 可以并存，不要覆盖 `le`、`color` 的验证值。
5. 等待 Vercel 显示 **Valid Configuration** 并签发 HTTPS 证书，再访问 `https://gr.fisherai6.top/login`。

这里采用 DNS only 直接连接 Vercel，由 Vercel 处理 HTTPS。不必修改 Cloudflare Nameservers，也不必调整整个域名的 SSL 模式。

## 3. Resend 复用已有验证域名

用户已确认 **Resend → Domains → fisherai6.top = Verified**，所以邮件 DNS 本次无需重复添加。

截图里已有的 `send` MX/TXT、`resend._domainkey` TXT、`_dmarc` TXT 以及其他系统的记录均保留。不要增加第二条同名 SPF，也不要改收信 MX。网站的 `gr` CNAME 和这些邮件记录可以同时存在。

1. 在 Resend 打开 **Domains → fisherai6.top**，确认 **Sending** 已启用。
2. 在该域名设置中关闭 **Click tracking**；账号安全邮件建议同时关闭 **Open tracking**。尤其不要让重置链接被追踪链接替换。
3. 不需要开启或更改 **Receiving**；我们这次只配置发信。

若以后域名变成 Pending/Failed：打开域名详情，将 Resend 当前列出的 DNS 记录逐条与 Cloudflare 比较。MX 的服务器、优先级和 DKIM 长文本都以该页面完整值为准，截图中的截断内容不能用于填写。只有缺失或不匹配的项目才需要处理。

## 4. Resend 创建本系统专用 API key

在截图里的 **API keys** 页面，点击右上角 **Create API key**。

建议创建两个独立 key，便于定位问题且不影响字芽等其他系统：

| 用途 | Name | Permission | Domain |
| --- | --- | --- | --- |
| 创建用户和发送临时密码 | `grape-app` | `Sending access` | `fisherai6.top` |
| Supabase 重置密码邮件 | `grape-supabase-smtp` | `Sending access` | `fisherai6.top` |

创建后立即将完整 `re_...` 值保存到密码管理器。Resend 之后不会再次显示完整 key；截图里截断的 `re_...` 不能使用。旧系统的 key 保持原样。两个 key 必须在拥有已验证域名的同一个 Resend Team 中创建。

密钥直接填写到下述 Vercel/Supabase 控制台，不需要发到聊天中，也不要放进代码、Git 或截图。

## 5. Vercel 配置环境变量

回到 **grape-harvest-system → Settings → Environment Variables**。新增或编辑以下变量，环境选择 **Production**。

| Key | Value | 类型 |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://gr.fisherai6.top`，不加末尾斜杠 | Config / 普通配置 |
| `RESEND_API_KEY` | 第 4 步 `grape-app` 的完整 key | Secret / 敏感 |
| `MAIL_FROM` | `收葡萄 <grape@fisherai6.top>` | Config / 普通配置 |
| `SUPABASE_SERVICE_ROLE_KEY` | **葡萄项目**的服务端 `service_role` key | Secret / 敏感 |
| `NEXT_PUBLIC_SUPABASE_URL` | 保持 `https://xkolwcidzixuvstubghw.supabase.co` | 原有配置 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 保持同一葡萄项目的现有 anon key | 原有配置 |

`SUPABASE_SERVICE_ROLE_KEY` 的位置：打开葡萄 Supabase 项目 → **Project Settings → API Keys → Legacy anon, service_role API keys** → 找到 `service_role`，按需 Reveal/Copy。控制台名称可能略有变化，关键是必须为这个项目的服务端 key，不能误用 `anon`，也不能使用字芽项目的 key。

`RESEND_API_KEY` 和 `SUPABASE_SERVICE_ROLE_KEY` **不能添加 `NEXT_PUBLIC_` 前缀**。它们只在服务端使用。

保存后：

1. 进入 **Deployments**，选择最新的 Production 部署。
2. 点击菜单 **Redeploy**，确保使用刚保存的环境变量。
3. 等待状态为 **Ready**；如果界面提供缓存选项，更新公开站点配置后可取消构建缓存再部署。
4. 发布完成后进入 `https://gr.fisherai6.top/estate`。总园主的“尚未配置账号管理密钥或发件服务”提示应消失。

提示消失只说明必填变量存在，不证明 key 有效、域名验证通过或收件箱已收到邮件。最终仍要按第 8 步实际验证。

Preview/Development 按需单独配置，避免测试时向正式用户发信；本地站点地址继续使用实际 localhost 地址。

## 6. Supabase URL Configuration

务必选 **grape-harvest-system / xkolwcidzixuvstubghw**，不要进入字芽项目。

进入 **Authentication → URL Configuration**：

**Site URL** 填：

```text
https://gr.fisherai6.top
```

**Redirect URLs** 点击 **Add URL**，逐条添加：

```text
https://gr.fisherai6.top/auth/callback
https://gr.fisherai6.top/auth/callback?next=/reset-password
https://gr.fisherai6.top/reset-password
```

保存。旧 Vercel 域名的精确回调可在切换期间保留，兼容已发出的旧邮件；新邮件统一使用 gr 域名。本地开发需要时再添加本地回调，生产不需要允许所有互联网域名的通配地址。

这里改的是 Auth 的站点/跳转配置。**Supabase Project URL 和数据库连接地址保持原样**，Cloudflare 无需把 Supabase API 改成 gr 域名。

新旧网站域名不共享登录 cookie；第一次进入新域名，需要重新登录。

## 7. Supabase SMTP 与重置密码模板

进入 **Authentication → Notifications → Email → SMTP Settings**。部分旧版控制台入口叫 **Authentication → Settings → SMTP Settings**。

打开 **Enable Custom SMTP**，填写：

| 字段 | 值 |
| --- | --- |
| Sender email | `grape@fisherai6.top` |
| Sender name | `收葡萄` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend`（固定文字，不是邮箱） |
| Password | 第 4 步 `grape-supabase-smtp` 的完整 `re_...` key |

点击 Save。保留最小发送间隔，实际需要调整时查看 **Authentication → Rate Limits**；自定义 SMTP 后仍有 Supabase Auth 和 Resend 各自的限流，不是无限发送。

然后在 **Email → Templates → Reset password**（旧版为 **Email Templates → Reset Password**）：

1. Subject 填 **`重置您的收葡萄密码`**。
2. 打开本仓库 [recovery.html](../supabase/templates/recovery.html)，复制全部 HTML，完整替换邮件 Body。
3. 点击 Save，预览中文和按钮样式。

模板保留 Supabase 的 `{{ .Email }}`、`{{ .SiteURL }}`、`{{ .TokenHash }}` 占位符，不能手动改成某个用户的真实邮箱或 token。这里使用本项目现有的链接：

```html
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password
```

参考 HTML 中的 `/auth/recovery` 属于另一个系统，本项目用 `/auth/callback`。直接照抄另一个系统的链接会造成路径错误。该 token_hash 流程由本项目服务端验证邮件凭证，再显示对应账号的改密页面。

**临时密码邮件无需粘贴到 Supabase 或 Resend Templates。** 它由网站代码生成，已接入同一套绿色卡片样式，包含账号、临时密码、登录按钮和首次改密说明，并有纯文本版本。

维护模板时执行 `node --import tsx scripts/render-email-templates.ts` 可重新生成 Supabase HTML；然后再次手动粘贴到控制台。仅修改仓库文件不会自动修改线上 Supabase 模板。

## 8. 最后验证（配置完成后执行）

### 创建用户与首次改密

1. 在 `https://gr.fisherai6.top/login` 使用总园主账号登录。
2. 进入 `/estate`，选一个实际农场，使用**你能查收邮件且尚未在本系统注册**的测试邮箱，角色选普通记录者。
3. 点击“创建账号并发送邮件”，确认弹窗中的邮箱、角色和农场后提交。
4. 页面提示邮件已发送后，在 Resend **Emails** 中找到该收件人：`Sent` 表示已经提交发送，`Delivered` 表示收件服务器已接收。再检查真实收件箱和垃圾邮件，确认能收到完整邮件。
5. 用隐私窗口打开邮件里的新域名登录页，使用邮件邮箱和临时密码登录。必须先进入改密页，完成前不能进入业务页面。
6. 设置新密码后，重新登录确认生效；原临时密码应该无法登录。改密后能看到所属农场，其他农场的数据不能访问。

### 忘记密码

1. 在新域名登录页输入这个测试邮箱，点击“忘记密码 / 设置密码”。
2. Resend 中应该出现另一封邮件，收件箱中应显示新的收葡萄重置密码模板。
3. 点击最新邮件中的按钮，页面显示的邮箱应与收件邮箱一致。
4. 保存新密码后，用新密码重新登录。旧密码和已使用的重置链接均不能再次生效。

### 出问题时按提示定位

| 现象 | 检查位置 / 处理 |
| --- | --- |
| “请先配置发件服务…” / HTTP 503 | Vercel 的变量是否为 Production，是否拼写正确，是否重新部署 |
| “缺少账号管理服务端密钥” | `SUPABASE_SERVICE_ROLE_KEY` 是否存在且属于葡萄 Supabase 项目 |
| “账号已保留，但邮件发送未确认成功” / HTTP 502 | 不要重复创建；查 Resend Logs、key 权限、发件人域名，然后在账号列表重发临时密码 |
| 邮件显示发送失败 / rejected | Resend 的完整错误、收件邮箱、域名 Verified 和 Sending、key 的域名限制是否匹配 |
| Resend 显示 Delivered，但没有收到 | 检查垃圾邮件、隔离邮箱及收件地址；Delivered 不等于一定进入主收件箱 |
| 忘记密码报限流 | Supabase Auth Rate Limits 和 Resend 配额；等候后重新请求最新邮件 |
| 邮件仍跳到旧网址 | 核对新部署 `NEXT_PUBLIC_SITE_URL`、Supabase Site URL 和模板，再申请新邮件；旧邮件内容不会自动更新 |
| 链接失效、重复使用或验证失败 | 关闭 Click tracking，申请最新邮件，并核对账户；不要反复使用旧链接 |
| “请求来源不匹配” | 核对网站域名的生产绑定；本次代码已兼容 Vercel 代理的公开主机名 |

“邮件已发送”是 Resend 接受发送请求的结果，系统目前不通过 webhook 将 Delivered/Bounced 实时同步回账号列表；实际送达以 Resend Emails 和真实收件箱共同核验。

## 官方参考

- [Vercel 添加自定义域名](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel 环境变量与重新部署](https://vercel.com/docs/environment-variables)
- [Resend 已验证域名与发件地址](https://resend.com/docs/dashboard/domains/introduction)
- [Resend API keys](https://resend.com/docs/dashboard/api-keys/introduction)
- [Resend 的 Cloudflare DNS 指引](https://resend.com/docs/guides/dns/cloudflare)
- [Resend 接入 Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase 邮件模板与追踪设置](https://supabase.com/docs/guides/auth/auth-email-templates)
