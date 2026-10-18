const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

function shell(options: {
  title: string;
  preheader: string;
  content: string;
  siteUrl: string;
  siteLabel: string;
}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(options.title)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { padding: 20px 12px !important; }
      .email-card { width: 100% !important; }
      .email-header, .email-body, .email-footer { padding: 28px 24px !important; }
      .email-title { font-size: 25px !important; }
      .email-button { display: block !important; padding: 15px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f7f2e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(options.preheader)}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f7f2e8" class="email-shell" style="width:100%;background-color:#f7f2e8;padding:44px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#fffdf8" class="email-card" style="width:100%;max-width:600px;background-color:#fffdf8;border:1px solid #e8dfcf;border-radius:22px;overflow:hidden;box-shadow:0 12px 36px rgba(46,78,58,0.10);">
        <tr><td bgcolor="#315f49" class="email-header" style="background-color:#315f49;padding:34px 42px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr>
            <td width="58" valign="middle"><table width="50" height="50" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#fffdf8" style="width:50px;height:50px;background-color:#fffdf8;border-radius:15px;"><tr><td align="center" valign="middle" style="font-size:28px;line-height:50px;">🍇</td></tr></table></td>
            <td valign="middle" style="padding-left:14px;"><p style="margin:0;color:#ffffff;font-family:Georgia,'Songti SC',serif;font-size:23px;font-weight:700;line-height:1.25;letter-spacing:1px;">收葡萄</p><p style="margin:5px 0 0;color:#dce9df;font-size:13px;line-height:1.4;">葡萄农场 · 记录与管理</p></td>
          </tr></table>
        </td></tr>
        <tr><td class="email-body" style="padding:42px 48px 38px;color:#415248;font-size:15px;line-height:1.8;">${options.content}</td></tr>
        <tr><td bgcolor="#f3eee3" class="email-footer" style="background-color:#f3eee3;padding:23px 42px;border-top:1px solid #e6dece;">
          <p style="margin:0;color:#7f847e;font-size:12px;text-align:center;line-height:1.7;">此邮件由收葡萄系统自动发送，请勿直接回复。<br>收葡萄 · <a href="${escapeHtml(options.siteUrl)}" style="color:#315f49;text-decoration:none;">${escapeHtml(options.siteLabel)}</a></p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#9a978f;font-size:11px;line-height:1.6;text-align:center;">认真记下每一份收获。</p>
    </td></tr>
  </table>
</body>
</html>
`;
}

function accountBox(email: string, password?: string) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f2eee4" style="width:100%;background-color:#f2eee4;border-radius:12px;margin:22px 0 26px;"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.8;word-break:break-all;">
    <span style="color:#7b877f;">登录账号：</span><strong style="color:#2b4435;">${escapeHtml(email)}</strong>${password ? `<br><span style="color:#7b877f;">临时密码：</span><strong style="color:#2b4435;font-family:Consolas,monospace;">${escapeHtml(password)}</strong>` : ""}
  </td></tr></table>`;
}

function button(url: string, label: string) {
  const safeUrl = escapeHtml(url);
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td align="center" style="padding:2px 0 28px;">
    <table cellpadding="0" cellspacing="0" border="0" role="presentation"><tr><td align="center" bgcolor="#315f49" style="background-color:#315f49;border-radius:12px;"><a class="email-button" href="${safeUrl}" style="display:inline-block;border:1px solid #315f49;border-radius:12px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.3;padding:15px 34px;">${escapeHtml(label)}&nbsp; →</a></td></tr></table>
  </td></tr></table>`;
}

function note(text: string) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#fff5dc" style="width:100%;background-color:#fff5dc;border:1px solid #f1dfb8;border-radius:12px;margin-bottom:25px;"><tr><td style="padding:15px 18px;color:#765a30;font-size:13px;line-height:1.7;">${escapeHtml(text)}</td></tr></table>`;
}

function fallbackLink(url: string) {
  return `<p style="margin:0 0 8px;color:#7a867f;font-size:12px;line-height:1.65;">如果按钮无法点击，请复制下面的完整链接到浏览器：</p><p style="margin:0;padding:12px 14px;background-color:#f6f3eb;border:1px solid #e9e2d5;border-radius:9px;color:#315f49;font-size:11px;line-height:1.65;word-break:break-all;">${escapeHtml(url)}</p>`;
}

export function accountWelcomeEmail(options: {
  email: string;
  password: string;
  loginUrl: string;
}) {
  const site = new URL(options.loginUrl);
  if (!["https:", "http:"].includes(site.protocol))
    throw new Error("站点地址无效");
  const subject = "你的葡萄农场账号已准备好";
  return {
    subject,
    html: shell({
      title: subject,
      // 不把临时密码放进收件箱预览文字。
      preheader: "您的收葡萄账号已准备好。首次登录后，请先设置自己的密码。",
      siteUrl: site.origin,
      siteLabel: site.host,
      content: `<h1 class="email-title" style="margin:0 0 18px;color:#1f3127;font-family:Georgia,'Songti SC',serif;font-size:29px;line-height:1.35;">欢迎来到葡萄农场</h1>
        <p style="margin:0 0 14px;">您好，</p><p style="margin:0 0 20px;">总园主已为您创建账号并分配农场与角色。请使用以下账号和临时密码登录：</p>
        ${accountBox(options.email, options.password)}${button(site.href, "登录并修改密码")}
        ${note("首次登录必须修改密码，完成后才能使用系统。临时密码请仅供本人使用；如果总园主重发了邮件，此前的临时密码将失效，请以最新邮件为准。")}
        ${fallbackLink(site.href)}
        <p style="margin:25px 0 0;color:#7a867f;font-size:12px;line-height:1.7;">如果您不认识这个农场或并未申请账号，请联系邀请您的总园主。收葡萄不会通过邮件向您索要密码。</p>`,
    }),
    text: `您的葡萄农场账号已准备好。\n账号：${options.email}\n临时密码：${options.password}\n登录地址：${site.href}\n首次登录必须修改密码。重发后旧临时密码失效，请使用最新邮件。\n此邮件由收葡萄系统自动发送，请勿直接回复。`,
  };
}

// 生成后粘贴到 Supabase 的 Reset password 模板；占位符由 Supabase 替换。
export function passwordRecoveryEmail() {
  const recoveryUrl =
    "{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password";
  return shell({
    title: "重置收葡萄密码",
    preheader: "请为您的收葡萄账号设置新密码。此链接只能使用一次，请尽快完成。",
    siteUrl: "{{ .SiteURL }}",
    siteLabel: "gr.fisherai6.top",
    content: `<h1 class="email-title" style="margin:0 0 18px;color:#1f3127;font-family:Georgia,'Songti SC',serif;font-size:29px;line-height:1.35;">重新设置您的密码</h1>
      <p style="margin:0 0 14px;">您好，</p><p style="margin:0 0 20px;">我们收到了为下面这个收葡萄账号重置密码的请求。请点击按钮设置新密码：</p>
      ${accountBox("{{ .Email }}")}${button(recoveryUrl, "设置新密码")}
      ${note("为了账号安全，此链接有有效期且只能使用一次。设置成功后，请使用新密码重新登录，并核对改密页面显示的邮箱。")}
      ${fallbackLink(recoveryUrl)}
      <p style="margin:25px 0 0;color:#7a867f;font-size:12px;line-height:1.7;">如果您没有申请重置密码，请直接忽略本邮件；您的原密码不会因此改变。收葡萄不会通过邮件向您索要密码。</p>`,
  });
}
