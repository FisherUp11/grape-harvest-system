// 仅供 Playwright 的本地 HTTP 替身；不读取环境文件、不访问真实项目。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export const org = "00000000-0000-0000-0000-000000000001";
export const uid = "10000000-0000-0000-0000-000000000001";
export const sid = "10000000-0000-0000-0000-000000000004";
export const kid = "10000000-0000-0000-0000-000000000003";
export function sessionFor(role = "user") {
  const user = {
    id: role === "super_admin" ? sid : role === "grape_keeper" ? kid : uid,
    aud: "authenticated",
    role: "authenticated",
    email:
      role === "super_admin"
        ? "owner@example.invalid"
        : role === "grape_keeper"
          ? "keeper@example.invalid"
          : "lin@example.invalid",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const expires = Math.floor(Date.now() / 1000) + 86400;
  const jwt = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        aud: "authenticated",
        role: "authenticated",
        exp: expires,
      }),
    ).toString("base64url"),
    "test-signature",
  ].join(".");
  return {
    access_token: jwt,
    refresh_token: "test-refresh-token",
    expires_at: expires,
    expires_in: 86400,
    token_type: "bearer",
    user,
  };
}
let tables;
let storedBytes;
let failedStorage = false;
let passwordUpdates = [];
let authFailure = "";
let passwords = new Map();
function reset() {
  storedBytes = 0;
  passwordUpdates = [];
  authFailure = "";
  passwords = new Map([
    [uid, "Old-demo-pass-1!"],
    [kid, "Keeper-demo-pass-1!"],
    [sid, "Owner-demo-pass-1!"],
  ]);
  failedStorage = false;
  const common = {
    org_id: org,
    owner_id: uid,
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
  };
  tables = {
    organizations: [
      { id: org, name: "测试庄园", fixed_requires_approval: false },
    ],
    record_corrections: [],
    recurring_consumption_plans: [],
    grape_receipt_attachments: [],
    profiles: [
      {
        id: sid,
        org_id: null,
        role: "super_admin",
        email: "owner@example.invalid",
        display_name: "总园主",
        must_change_password: false,
      },
      {
        id: uid,
        org_id: org,
        role: "user",
        display_name: "记录者小林",
        email: "lin@example.invalid",
        monthly_fixed_consumption: 1000,
        grape_alert_threshold: 2000,
        organizations: { name: "测试庄园", fixed_requires_approval: false },
      },
      {
        id: kid,
        org_id: org,
        role: "grape_keeper",
        display_name: "葡萄管家",
        email: "keeper@example.invalid",
        monthly_fixed_consumption: 0,
        grape_alert_threshold: 0,
        organizations: { name: "测试庄园", fixed_requires_approval: false },
      },
    ],
    supporters: [
      {
        ...common,
        id: "20000000-0000-0000-0000-000000000001",
        name: "支持者阿青",
        email: "support@example.invalid",
        notes: "每月支持",
        support_type: "recurring",
        cycle: "monthly",
        status: "active",
      },
    ],
    grape_receipts: [
      {
        ...common,
        id: "30000000-0000-0000-0000-000000000001",
        supporter_id: "20000000-0000-0000-0000-000000000001",
        received_date: "2026-10-02",
        grape_amount: 1200,
        receipt_method: "wechat",
        status: "returned",
        return_reason: "请核对金额",
        notes: "十月支持",
        source_type: "one_time",
      },
      {
        ...common,
        id: "30000000-0000-0000-0000-000000000002",
        supporter_id: null,
        received_date: "2026-09-02",
        grape_amount: 3000,
        receipt_method: "bank",
        status: "confirmed",
        confirmed_by: kid,
        confirmed_at: "2026-09-03T00:00:00Z",
      },
    ],
    grape_consumptions: [
      {
        ...common,
        id: "40000000-0000-0000-0000-000000000001",
        consumption_date: "2026-10-03",
        grape_amount: 100,
        consumption_type: "project",
        description: "项目交通",
        status: "pending",
        budget_category_id: "60000000-0000-0000-0000-000000000001",
        attachments_ready: true,
      },
    ],
    grape_consumption_attachments: [
      {
        ...common,
        id: "45000000-0000-0000-0000-000000000001",
        consumption_id: "40000000-0000-0000-0000-000000000001",
        file_path: `${uid}/40000000-0000-0000-0000-000000000001/voucher.jpg`,
        file_name: "凭证.jpg",
        file_size: 102400,
        mime_type: "image/jpeg",
      },
    ],
    commitments: [
      {
        ...common,
        id: "70000000-0000-0000-0000-000000000001",
        supporter_id: "20000000-0000-0000-0000-000000000001",
        commitment_type: "recurring",
        grape_amount: 1000,
        cycle: "monthly",
        total_periods: 12,
        total_grapes: 12000,
        status: "active",
      },
    ],
    commitment_periods: [
      {
        ...common,
        id: "75000000-0000-0000-0000-000000000001",
        commitment_id: "70000000-0000-0000-0000-000000000001",
        supporter_id: "20000000-0000-0000-0000-000000000001",
        period_no: 1,
        expected_date: "2026-10-01",
        expected_grapes: 1000,
        actual_grapes: null,
        status: "not_received",
      },
    ],
    budget_categories: [
      {
        ...common,
        id: "60000000-0000-0000-0000-000000000001",
        budget_plan_id: "50000000-0000-0000-0000-000000000001",
        name: "项目交通",
        budgeted_amount: 1000,
        sort_order: 0,
      },
    ],
    budget_plans: [
      {
        ...common,
        id: "50000000-0000-0000-0000-000000000001",
        title: "全年项目预算",
        period_start: "2026-01-01",
        period_end: "2027-12-31",
        status: "confirmed",
        version: 1,
        confirmed_by: kid,
        confirmed_at: "2026-01-01T08:00:00Z",
      },
    ],
    audit_logs: [],
  };
}
reset();
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.setHeader("Content-Type", "application/json");
  const send = (data, status = 200) => {
    res.statusCode = status;
    if (status >= 400 && data?.code) data = { ...data, error_code: data.code };
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") return send({});
  const url = new URL(req.url, "http://127.0.0.1:54399");
  const body = await new Promise((resolve) => {
    const chunks = [];
    req.on("data", (b) => chunks.push(b));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const token = (req.headers.authorization || "").split(".")[1];
  let current = uid;
  try {
    current =
      JSON.parse(Buffer.from(token || "", "base64url").toString()).sub || uid;
  } catch {}
  const keeper = current === kid;
  const superAdmin = current === sid;
  if (url.pathname === "/__reset") {
    reset();
    return send({ ok: true });
  }
  if (url.pathname === "/__first_login") {
    tables.profiles.find((p) => p.id === uid).must_change_password = true;
    return send({ ok: true });
  }
  if (url.pathname === "/__storage_failure") {
    failedStorage = url.searchParams.get("fail") === "true";
    return send({ ok: true });
  }
  if (url.pathname === "/__password_updates") return send(passwordUpdates);
  if (url.pathname === "/__auth_failure") {
    authFailure = url.searchParams.get("code") || "";
    return send({ ok: true });
  }
  if (url.pathname === "/auth/v1/logout" || url.pathname === "/auth/v1/recover")
    return send({});
  if (url.pathname === "/auth/v1/user") {
    if (
      !req.headers.authorization ||
      !token ||
      ![uid, kid, sid].includes(current)
    )
      return send({ code: "session_not_found", msg: "Missing session" }, 401);
    if (req.method === "PUT") {
      if (authFailure)
        return send({ code: authFailure, msg: "Password rejected" }, 422);
      const input = JSON.parse(body.toString());
      passwords.set(current, input.password);
      passwordUpdates.push({ id: current });
    }
    return send(
      sessionFor(superAdmin ? "super_admin" : keeper ? "grape_keeper" : "user")
        .user,
    );
  }
  if (url.pathname === "/auth/v1/token") {
    const input = JSON.parse(body.toString() || "{}");
    if (url.searchParams.get("grant_type") === "pkce") {
      if (input.auth_code !== "fixture-valid-code")
        return send({ code: "otp_expired", msg: "Expired link" }, 400);
      return send(sessionFor("grape_keeper"));
    }
    if (url.searchParams.get("grant_type") === "password") {
      const p = tables.profiles.find((p) => p.email === input.email);
      if (!p || passwords.get(p.id) !== input.password)
        return send(
          { code: "invalid_credentials", msg: "Invalid credentials" },
          400,
        );
      return send(sessionFor(p.role));
    }
    return send(sessionFor());
  }
  if (url.pathname === "/auth/v1/verify") {
    const input = JSON.parse(body.toString() || "{}");
    if (input.token_hash !== "fixture-valid-hash" || input.type !== "recovery")
      return send({ code: "otp_expired", msg: "Expired link" }, 403);
    return send(sessionFor("grape_keeper"));
  }
  if (url.pathname === "/rest/v1/rpc/get_estate_capacity")
    return superAdmin
      ? send({
          database_bytes: 42 * 1024 ** 2,
          audit_bytes: 256 * 1024,
          audit_count: 120,
          storage_bytes: 900 * 1024 ** 2,
          storage_count: 8,
          measured_at: new Date().toISOString(),
          farms: [
            {
              id: org,
              name: "测试庄园",
              user_count: 2,
              keeper_count: 1,
              pending_count: 2,
              storage_bytes: 900 * 1024 ** 2,
            },
          ],
        })
      : send({ message: "仅总园主可查看" }, 403);
  if (url.pathname === "/rest/v1/rpc/sync_recurring_consumptions")
    return send({ generated: 0, blocked: 0 });
  if (url.pathname === "/rest/v1/rpc/stop_recurring_consumption") {
    const { p_id, p_reason } = JSON.parse(body.toString());
    const plan = tables.recurring_consumption_plans.find(
      (p) => p.id === p_id && p.owner_id === current,
    );
    if (!plan || !p_reason)
      return send({ message: "计划不存在或原因缺失" }, 400);
    Object.assign(plan, {
      status: "stopped",
      next_date: null,
      stop_reason: p_reason,
    });
    return send(null);
  }
  if (
    [
      "/rest/v1/rpc/record_action",
      "/rest/v1/rpc/record_action_checked",
    ].includes(url.pathname)
  ) {
    const { p_table, p_id, p_action, p_reason } = JSON.parse(body.toString());
    const row = tables[p_table]?.find((r) => r.id === p_id);
    if (!row) return send({ message: "记录不存在" }, 404);
    if (superAdmin) return send({ message: "总园主只读" }, 403);
    if (p_action === "submit")
      row.status =
        p_table === "grape_consumptions" && row.consumption_type === "fixed"
          ? "confirmed"
          : "pending";
    if (p_action === "confirm") {
      row.status = "confirmed";
      row.confirmed_by = current;
      row.confirmed_at = new Date().toISOString();
    }
    if (p_action === "return") {
      row.status = "returned";
      row.return_reason = p_reason;
    }
    if (p_action === "recall") {
      if (row.status !== "pending" || row.owner_id !== current)
        return send({ message: "无法召回" }, 400);
      row.status = "draft";
    }
    if (p_action === "archive") row.deleted_at = new Date().toISOString();
    return send(null);
  }
  if (url.pathname.startsWith("/rest/v1/rpc/get_storage_usage_summary"))
    return failedStorage
      ? send({ message: "Fixture storage unavailable" }, 503)
      : send([
          {
            bucket_id: "consumption-attachments",
            total_bytes: (keeper ? 900 * 1024 * 1024 : 102400) + storedBytes,
            object_count: storedBytes ? 2 : 1,
          },
        ]);
  if (url.pathname.startsWith("/storage/v1/object/sign/"))
    return send({
      signedURL: "/object/sign/consumption-attachments/test?token=test",
    });
  if (url.pathname.startsWith("/storage/v1/object/")) {
    if (req.method === "POST") storedBytes += body.length;
    else if (req.method === "DELETE") storedBytes = 0;
    return send({ Key: "test", Id: randomUUID() });
  }
  let table = url.pathname.split("/").pop();
  if (table === "ledger_receipts") table = "grape_receipts";
  if (table === "ledger_consumptions") table = "grape_consumptions";
  if (table === "budget_category_usage")
    return send(
      tables.budget_categories.map((c) => ({
        ...c,
        category_id: c.id,
        category_name: c.name,
        confirmed_consumed: 0,
        pending_consumed: 100,
      })),
    );
  if (!tables[table])
    return send({ message: `Unknown fixture route ${url.pathname}` }, 404);
  let rows = tables[table].filter(
    (r) =>
      ["profiles", "organizations"].includes(table) ||
      superAdmin ||
      keeper ||
      r.owner_id === current,
  );
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (value.startsWith("eq."))
      rows = rows.filter((r) => String(r[key]) === value.slice(3));
    if (value.startsWith("in."))
      rows = rows.filter((r) =>
        value.slice(4, -1).split(",").includes(String(r[key])),
      );
  }
  if (req.method === "POST") {
    const input = JSON.parse(body.toString());
    const records = (Array.isArray(input) ? input : [input]).map((r) => ({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "pending",
      ...r,
    }));
    tables[table].push(...records);
    if (table === "recurring_consumption_plans")
      for (const p of records) {
        const month = new Date(p.start_date + "T00:00:00Z");
        const due = new Date(
          Date.UTC(
            month.getUTCFullYear(),
            month.getUTCMonth(),
            Math.min(
              p.day_of_month,
              new Date(
                Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
              ).getUTCDate(),
            ),
          ),
        );
        Object.assign(p, {
          status: "active",
          next_date: due.toISOString().slice(0, 10),
          generated_count: 0,
        });
      }
    rows = records;
  }
  if (req.method === "PATCH") {
    const input = JSON.parse(body.toString());
    for (const row of rows) Object.assign(row, input);
  }
  if (req.method === "DELETE")
    tables[table] = tables[table].filter((row) => !rows.includes(row));
  if (table === "budget_plans")
    rows = rows.map((r) => ({
      ...r,
      budget_categories: tables.budget_categories.filter(
        (c) => c.budget_plan_id === r.id,
      ),
    }));
  const offset = Number(url.searchParams.get("offset") || 0),
    limit = Number(url.searchParams.get("limit") || rows.length);
  rows = rows.slice(offset, offset + limit);
  if (String(req.headers.accept).includes("application/vnd.pgrst.object+json"))
    return rows.length === 1
      ? send(rows[0])
      : send({ code: "PGRST116", message: "Expected single record" }, 406);
  return send(rows);
});
if (process.argv[1] === fileURLToPath(import.meta.url))
  server.listen(54399, "127.0.0.1", () =>
    console.log("Isolated Supabase fixture ready: 54399"),
  );
