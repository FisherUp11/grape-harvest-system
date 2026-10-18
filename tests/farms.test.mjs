import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const farm = "00000000-0000-0000-0000-000000000001",
  farm2 = "00000000-0000-0000-0000-000000000002";
const owner = "10000000-0000-0000-0000-000000000001",
  user = "10000000-0000-0000-0000-000000000002",
  keeper = "10000000-0000-0000-0000-000000000003",
  other = "10000000-0000-0000-0000-000000000004",
  otherKeeper = "10000000-0000-0000-0000-000000000005",
  first = "10000000-0000-0000-0000-000000000006";
test("三角色、多农场、审核状态机与容量（完整升级）", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("set timezone='Asia/Shanghai'");
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','xiangyufei11@gmail.com',now());`);
  await db.exec(
    (
      await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8")
    ).replace("create extension if not exists pgcrypto;", ""),
  );
  await db.exec(
    "grant select,insert,update,delete on all tables in schema public to authenticated",
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261017123845_mobile_workflows_and_integrity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(`insert into profiles(id,org_id,role,email) values('${owner}','${farm}','grape_keeper','xiangyufei11@gmail.com');
 insert into grape_receipts(org_id,owner_id,received_date,grape_amount,status) values('${farm}','${owner}','2026-09-01',123,'confirmed'),('${farm}','${owner}','2026-09-02',456,'pending');
 insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,status) values('${farm}','${owner}','2026-09-03',12,'fixed','升级前已确认','confirmed');`);
  for (const file of [
    "20261017134545_farm_roles.sql",
    "20261017134546_farm_workflows.sql",
    "20261017150658_farm_security_review.sql",
    "20261017151557_budget_version_usage.sql",
    "20261018061514_recurring_fixed_and_recall.sql",
    "20261018063700_review_record_revision.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  assert.equal(
    (
      await db.query(
        "select grape_amount,approval_required from grape_receipts where status='confirmed'",
      )
    ).rows[0].grape_amount,
    "123.00",
  );
  assert.equal(
    (
      await db.query(
        "select approval_required from grape_receipts where status='pending'",
      )
    ).rows[0].approval_required,
    true,
  );
  await db.exec(`insert into organizations(id,name) values('${farm2}','第二农场');
 insert into auth.users(id,email,email_confirmed_at,encrypted_password) values('${user}','user@example.invalid',now(),'initial'),('${keeper}','keeper@example.invalid',now(),'initial'),('${other}','other@example.invalid',now(),'initial'),('${otherKeeper}','otherkeeper@example.invalid',now(),'initial'),('${first}','first@example.invalid',now(),'temp');
 insert into profiles(id,org_id,role,display_name,must_change_password) values('${user}','${farm}','user','甲用户',false),('${keeper}','${farm}','grape_keeper','甲管家',false),('${other}','${farm2}','user','乙用户',false),('${otherKeeper}','${farm2}','grape_keeper','乙管家',false),('${first}','${farm}','user','首次登录',true);`);
  const as = async (id) =>
    db.exec(
      `reset role;set role authenticated;set request.jwt.claim.sub='${id}';`,
    );
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const v = async (sql, args = []) => Object.values((await q(sql, args))[0])[0];
  const act = async (table, id, action, reason = null) =>
    db.query("select public.record_action($1,$2,$3,$4)", [
      table,
      id,
      action,
      reason,
    ]);
  let receipt, expense, autoExpense, correction, budget, cat;
  await t.test("指定邮箱初始化总园主，能查看容量但没有业务写权限", async () => {
    await as(owner);
    assert.equal(
      await v("select role from profiles where id=$1", [owner]),
      "super_admin",
    );
    const data = await v("select public.get_estate_capacity()");
    assert.equal(data.farms.length, 2);
    assert.ok(Number(data.database_bytes) > 0);
    await assert.rejects(
      db.query(
        `insert into grape_receipts(org_id,owner_id,received_date,grape_amount) values($1,$2,'2026-10-17',100)`,
        [farm, owner],
      ),
    );
    await db.query(`insert into organizations(name) values('第三农场')`);
  });
  await t.test("首次改密前业务不可读写；修改密码后才可访问", async () => {
    await as(first);
    assert.equal((await q("select * from organizations")).length, 0);
    assert.equal((await q("select * from profiles")).length, 1);
    assert.equal(
      (
        await q(
          `update profiles set must_change_password=false where id=$1 returning id`,
          [first],
        )
      ).length,
      0,
    );
    assert.equal(
      (await q("select * from public.get_storage_usage_summary()")).length,
      0,
    );
  });
  // storage summary intentionally returns no rows for accounts not ready, not a successful read of other users.
  await t.test(
    "Auth 密码变化清除首次改密要求，管理员轮换临时密码重新开启要求",
    async () => {
      await db.exec(`reset role;set request.jwt.claim.sub='';`);
      await db.query(
        `update auth.users set encrypted_password='newhash' where id=$1`,
        [first],
      );
      assert.equal(
        await v("select must_change_password from profiles where id=$1", [
          first,
        ]),
        false,
      );
      await db.query(
        `update auth.users set encrypted_password='rotated',raw_app_meta_data='{"onboarding_nonce":"rotated"}' where id=$1`,
        [first],
      );
      assert.equal(
        await v("select must_change_password from profiles where id=$1", [
          first,
        ]),
        true,
      );
    },
  );
  await t.test("不同农场数据隔离；提交锁定，必须退回才能编辑", async () => {
    await as(user);
    receipt = await v(
      `insert into grape_receipts(org_id,owner_id,received_date,grape_amount,status) values($1,$2,'2026-10-17',100,'draft') returning id`,
      [farm, user],
    );
    await act("grape_receipts", receipt, "submit");
    await assert.rejects(
      db.query("update grape_receipts set grape_amount=120 where id=$1", [
        receipt,
      ]),
    );
    await as(otherKeeper);
    assert.equal(
      (await q("select * from grape_receipts where id=$1", [receipt])).length,
      0,
    );
    await assert.rejects(act("grape_receipts", receipt, "confirm"));
    await as(owner);
    await assert.rejects(act("grape_receipts", receipt, "confirm"));
    await as(keeper);
    await assert.rejects(act("grape_receipts", receipt, "return", ""));
    await act("grape_receipts", receipt, "return", "请核对金额");
    await as(user);
    await db.query("update grape_receipts set grape_amount=120 where id=$1", [
      receipt,
    ]);
    await act("grape_receipts", receipt, "submit");
    await as(keeper);
    await act("grape_receipts", receipt, "confirm");
    await assert.rejects(act("grape_receipts", receipt, "return", "错误"));
    await as(user);
    await assert.rejects(
      db.query("update grape_receipts set grape_amount=130 where id=$1", [
        receipt,
      ]),
    );
    assert.equal(
      (
        await q("delete from grape_receipts where id=$1 returning id", [
          receipt,
        ])
      ).length,
      0,
    );
  });
  const consumption = async (type) => {
    const id = await v(
      `insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,attachments_ready,status) values($1,$2,'2026-10-17',20,$3,'测试使用',false,'draft') returning id`,
      [farm, user, type],
    );
    await db.query(
      `insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values($1,$2,$3,$4,'voucher.jpg','image/jpeg',1024)`,
      [farm, user, id, `${user}/${id}/voucher.jpg`],
    );
    await db.query(
      "update grape_consumptions set attachments_ready=true where id=$1",
      [id],
    );
    return id;
  };
  await t.test(
    "固定吃葡萄默认免确认；项目与一次性始终人工确认；历史规则不追溯",
    async () => {
      await as(user);
      autoExpense = await consumption("fixed");
      await act("grape_consumptions", autoExpense, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [
          autoExpense,
        ]),
        "confirmed",
      );
      assert.equal(
        await v("select auto_confirmed from grape_consumptions where id=$1", [
          autoExpense,
        ]),
        true,
      );
      await assert.rejects(
        db.query("update grape_consumptions set grape_amount=1 where id=$1", [
          autoExpense,
        ]),
      );
      expense = await consumption("project");
      await act("grape_consumptions", expense, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [expense]),
        "pending",
      );
      const one = await consumption("one_time");
      await act("grape_consumptions", one, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [one]),
        "pending",
      );
      await as(otherKeeper);
      assert.equal(
        (
          await q(
            "update organizations set fixed_requires_approval=true where id=$1 returning id",
            [farm],
          )
        ).length,
        0,
      );
      await as(keeper);
      await db.query(
        "update organizations set fixed_requires_approval=true where id=$1",
        [farm],
      );
      await assert.rejects(
        db.query("update organizations set name=$2 where id=$1", [
          farm,
          "伪造名称",
        ]),
      );
      await as(user);
      const manual = await consumption("fixed");
      await act("grape_consumptions", manual, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [manual]),
        "pending",
      );
      await as(keeper);
      await db.query(
        "update organizations set fixed_requires_approval=false where id=$1",
        [farm],
      );
      await act("grape_consumptions", manual, "return", "补充说明");
      await as(user);
      await act("grape_consumptions", manual, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [manual]),
        "pending",
      );
    },
  );
  await t.test("作废保留原文字与审计；审核中不可作废", async () => {
    await as(user);
    await assert.rejects(
      act("grape_consumptions", expense, "archive", "不再使用"),
    );
    const draft = await v(
      `insert into grape_receipts(org_id,owner_id,received_date,grape_amount) values($1,$2,'2026-10-17',10) returning id`,
      [farm, user],
    );
    await act("grape_receipts", draft, "archive", "重复草稿");
    assert.equal(
      await v("select grape_amount from grape_receipts where id=$1", [draft]),
      "10.00",
    );
    assert.ok(
      await v("select deleted_at from grape_receipts where id=$1", [draft]),
    );
    const logs = await q(
      `select * from audit_logs where entity_id=$1 and action like '%archived'`,
      [draft],
    );
    assert.equal(logs.length, 1);
    assert.ok(logs[0].new_data.deleted_at);
    await assert.rejects(
      db.query(
        `insert into audit_logs(action,entity_table) values('伪造','x')`,
      ),
    );
  });
  await t.test("更正单不覆盖原单；强制管家确认后差额进入余额", async () => {
    await as(user);
    correction = await v(
      `insert into record_corrections(org_id,owner_id,target_table,target_id,previous_amount,replacement_amount,reason) values($1,$2,'grape_receipts',$3,0,150,'更正为实际收到数') returning id`,
      [farm, user, receipt],
    );
    assert.equal(
      await v("select previous_amount from record_corrections where id=$1", [
        correction,
      ]),
      "120.00",
    );
    await act("record_corrections", correction, "submit");
    await assert.rejects(act("record_corrections", correction, "confirm"));
    await as(keeper);
    await act("record_corrections", correction, "confirm");
    assert.equal(
      await v("select grape_amount from grape_receipts where id=$1", [receipt]),
      "120.00",
    );
    assert.equal(
      await v(
        "select confirmed_received from grape_user_balances where owner_id=$1",
        [user],
      ),
      "150.00",
    );
  });
  await t.test(
    "预算待确认可自行召回，确认版本不可解锁但可复制新版",
    async () => {
      await as(user);
      budget = await v(
        `insert into budget_plans(org_id,owner_id,title,period_start,period_end) values($1,$2,'预算','2027-01-01','2027-12-31') returning id`,
        [farm, user],
      );
      cat = await v(
        `insert into budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount) values($1,$2,$3,'交通',200) returning id`,
        [farm, user, budget],
      );
      await db.query(
        `update budget_plans set status='pending_confirmation' where id=$1`,
        [budget],
      );
      await db.query(`update budget_plans set status='draft' where id=$1`, [
        budget,
      ]);
      await db.query(
        `update budget_plans set status='pending_confirmation' where id=$1`,
        [budget],
      );
      await as(keeper);
      await db.query(
        `update budget_plans set status='revision_unlocked',return_reason='调整交通预算' where id=$1`,
        [budget],
      );
      await as(user);
      await db.query(
        "update budget_categories set budgeted_amount=300 where id=$1",
        [cat],
      );
      await db.query(
        `update budget_plans set status='revision_pending_confirmation' where id=$1`,
        [budget],
      );
      await as(keeper);
      await db.query(`update budget_plans set status='confirmed' where id=$1`, [
        budget,
      ]);
      await assert.rejects(
        db.query(
          `update budget_plans set status='revision_unlocked',return_reason='解锁' where id=$1`,
          [budget],
        ),
      );
      await as(user);
      const clone = await v("select clone_budget_version($1)", [budget]);
      assert.equal(
        await v("select supersedes_id from budget_plans where id=$1", [clone]),
        budget,
      );
    },
  );
  await t.test(
    "账号分配只能由总园主完成，限制两位管家且不能移除最后的总园主",
    async () => {
      await as(user);
      await assert.rejects(
        db.query("select admin_assign_profile($1,$2,$3,$4,$5,false)", [
          first,
          farm,
          "grape_keeper",
          "新管家",
          "first@example.invalid",
        ]),
      );
      await as(owner);
      await db.query("select admin_assign_profile($1,$2,$3,$4,$5,false)", [
        first,
        farm,
        "grape_keeper",
        "新管家",
        "first@example.invalid",
      ]);
      await assert.rejects(
        db.query("select admin_assign_profile($1,$2,$3,$4,$5,false)", [
          user,
          farm,
          "grape_keeper",
          "第三管家",
          "user@example.invalid",
        ]),
      );
      await assert.rejects(
        db.query("select admin_assign_profile($1,$2,$3,$4,$5,false)", [
          owner,
          farm,
          "user",
          "总园主",
          "xiangyufei11@gmail.com",
        ]),
      );
      await assert.rejects(
        db.query("select admin_assign_profile($1,$2,$3,$4,$5,false)", [
          user,
          farm2,
          "user",
          "跨农场",
          "user@example.invalid",
        ]),
      );
    },
  );
  await t.test("伪造审批开关或审核字段不能使项目支出自动生效", async () => {
    await as(user);
    const id = await consumption("project");
    await db.query(
      "update grape_consumptions set approval_required=false,auto_confirmed=true,confirmed_by=$2,confirmed_at=now() where id=$1",
      [id, keeper],
    );
    assert.equal(
      await v("select auto_confirmed from grape_consumptions where id=$1", [
        id,
      ]),
      false,
    );
    assert.equal(
      await v("select confirmed_by from grape_consumptions where id=$1", [id]),
      null,
    );
    await act("grape_consumptions", id, "submit");
    assert.equal(
      await v("select status from grape_consumptions where id=$1", [id]),
      "pending",
    );
  });
  await t.test(
    "承诺收款状态原子同步，无法直接篡改实际金额或自确认期次",
    async () => {
      await as(user);
      const cid = await v(
        "select create_commitment_with_periods(null,'测试支持者','one_time',100,null,'2026-10-17',1,null,null)",
      );
      const period = (
        await q("select * from commitment_periods where commitment_id=$1", [
          cid,
        ])
      )[0];
      await assert.rejects(
        db.query(
          "update commitment_periods set actual_grapes=999 where id=$1",
          [period.id],
        ),
      );
      const rid = await v(
        "insert into grape_receipts(org_id,owner_id,supporter_id,commitment_id,commitment_period_id,source_type,received_date,grape_amount) values($1,$2,$3,$4,$5,'commitment','2026-10-17',110) returning id",
        [farm, user, period.supporter_id, cid, period.id],
      );
      await act("grape_receipts", rid, "submit");
      assert.equal(
        await v("select status from commitment_periods where id=$1", [
          period.id,
        ]),
        "pending_confirmation",
      );
      await assert.rejects(
        db.query(
          "update commitment_periods set status='confirmed' where id=$1",
          [period.id],
        ),
      );
      await as(keeper);
      await act("grape_receipts", rid, "return", "核对实际数");
      await as(user);
      await db.query("update grape_receipts set grape_amount=115 where id=$1", [
        rid,
      ]);
      await act("grape_receipts", rid, "submit");
      await as(keeper);
      await act("grape_receipts", rid, "confirm");
      assert.equal(
        await v("select actual_grapes from commitment_periods where id=$1", [
          period.id,
        ]),
        "115.00",
      );
      await assert.rejects(
        db.query("update commitment_periods set actual_grapes=9 where id=$1", [
          period.id,
        ]),
      );
    },
  );
  await t.test("预算新版本继承历史支出，并禁止丢弃已有使用的科目", async () => {
    await as(user);
    const spent = await v(
      "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,budget_category_id) values($1,$2,'2027-01-02',25,'project','旧版已发生支出',$3) returning id",
      [farm, user, cat],
    );
    await db.query(
      "insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values($1,$2,$3,$4,'voucher.jpg','image/jpeg',1024)",
      [farm, user, spent, `${user}/${spent}/voucher.jpg`],
    );
    await db.query(
      "update grape_consumptions set attachments_ready=true where id=$1",
      [spent],
    );
    await act("grape_consumptions", spent, "submit");
    await as(keeper);
    await act("grape_consumptions", spent, "confirm");
    await as(user);
    const clone = await v("select clone_budget_version($1)", [budget]);
    const newcat = await v(
      "select id from budget_categories where budget_plan_id=$1",
      [clone],
    );
    assert.equal(
      await v(
        "select confirmed_consumed from budget_category_usage where category_id=$1",
        [newcat],
      ),
      "25.00",
    );
    await assert.rejects(
      db.query(
        "update budget_categories set deleted_at=now(),deletion_reason='删除历史科目' where id=$1",
        [newcat],
      ),
    );
    await db.query(
      "update budget_plans set status='pending_confirmation' where id=$1",
      [clone],
    );
    await as(keeper);
    await db.query("update budget_plans set status='confirmed' where id=$1", [
      clone,
    ]);
    await as(user);
    await assert.rejects(
      db.query(
        "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,budget_category_id) values($1,$2,'2027-02-02',10,'project','不能再用旧版科目',$3)",
        [farm, user, cat],
      ),
    );
    assert.equal(
      await v(
        "select confirmed_consumed from budget_category_usage where category_id=$1",
        [newcat],
      ),
      "25.00",
    );
  });
  await t.test("待确认仅本人可召回；召回与确认互斥，审计保留变更", async () => {
    await as(user);
    const id = await v(
      "insert into grape_receipts(org_id,owner_id,received_date,grape_amount) values($1,$2,current_date,77) returning id",
      [farm, user],
    );
    await act("grape_receipts", id, "submit");
    await as(keeper);
    await assert.rejects(act("grape_receipts", id, "recall"));
    await as(user);
    await act("grape_receipts", id, "recall");
    assert.equal(
      await v("select status from grape_receipts where id=$1", [id]),
      "draft",
    );
    await as(keeper);
    await assert.rejects(act("grape_receipts", id, "confirm"));
    await as(user);
    await db.query("update grape_receipts set grape_amount=78 where id=$1", [
      id,
    ]);
    await act("grape_receipts", id, "submit");
    await as(keeper);
    await assert.rejects(
      db.query(
        "select record_action_checked('grape_receipts',$1,'confirm',1)",
        [id],
      ),
    );
    await act("grape_receipts", id, "confirm");
    await as(user);
    await assert.rejects(act("grape_receipts", id, "recall"));
    assert.ok(
      Number(
        await v(
          "select count(*) from audit_logs where entity_id=$1 and action='grape_receipts:recalled' and old_data->>'status'='pending' and new_data->>'status'='draft'",
          [id],
        ),
      ) > 0,
    );
  });
  await t.test(
    "固定吃葡萄可无凭证生效，确认后可补传，凭证及存储对象不能删除或覆盖",
    async () => {
      await as(user);
      const id = await v(
        "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description) values($1,$2,current_date,31,'fixed','后补凭证') returning id",
        [farm, user],
      );
      await act("grape_consumptions", id, "submit");
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [id]),
        "confirmed",
      );
      const path = `${user}/${id}/permanent.jpg`;
      await db.query(
        "insert into storage.objects(bucket_id,name) values('consumption-attachments',$1)",
        [path],
      );
      const aid = await v(
        "insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values($1,$2,$3,$4,'permanent.jpg','image/jpeg',1024) returning id",
        [farm, user, id, path],
      );
      assert.equal(
        await v(
          "select is_permanent from grape_consumption_attachments where id=$1",
          [aid],
        ),
        true,
      );
      assert.equal(
        (
          await q(
            "delete from grape_consumption_attachments where id=$1 returning id",
            [aid],
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await q("delete from storage.objects where name=$1 returning id", [
            path,
          ])
        ).length,
        0,
      );
      assert.equal(
        (
          await q(
            "update grape_consumption_attachments set file_name='changed' where id=$1 returning id",
            [aid],
          )
        ).length,
        0,
      );
      const raw = await v(
        "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description) values($1,$2,current_date,3,'fixed','草稿凭证不可移除') returning id",
        [farm, user],
      );
      const rawpath = `${user}/${raw}/permanent.jpg`;
      const rawaid = await v(
        "insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values($1,$2,$3,$4,'permanent.jpg','image/jpeg',1024) returning id",
        [farm, user, raw, rawpath],
      );
      await db.query(
        "update grape_consumptions set consumption_type='project' where id=$1",
        [raw],
      );
      assert.equal(
        (
          await q(
            "delete from grape_consumption_attachments where id=$1 returning id",
            [rawaid],
          )
        ).length,
        0,
      );
      const future = await v(
        "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description) values($1,$2,current_date+1,2,'fixed','未来不生效') returning id",
        [farm, user],
      );
      await assert.rejects(act("grape_consumptions", future, "submit"));
    },
  );
  await t.test(
    "月末计算、仅到期生成、幂等与来源防伪；终止不能恢复且跨农场隔离",
    async () => {
      await as(other);
      assert.equal(
        await v("select private.fixed_month_date('2028-02-01',31)::text"),
        "2028-02-29",
      );
      assert.equal(
        await v("select private.fixed_month_date('2027-02-01',31)::text"),
        "2027-02-28",
      );
      const id = await v(
        "insert into recurring_consumption_plans(org_id,owner_id,description,grape_amount,start_date,end_date,day_of_month) values($1,$2,'每月固定',3000,current_date,(current_date+interval '3 months')::date,extract(day from current_date)) returning id",
        [farm2, other],
      );
      const run = await v("select sync_recurring_consumptions()");
      assert.equal(run.generated, 1);
      assert.equal(run.blocked, 0);
      assert.equal(
        await v(
          "select count(*) from grape_consumptions where recurring_plan_id=$1",
          [id],
        ),
        1,
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).generated,
        0,
      );
      await assert.rejects(
        db.query(
          "insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,consumption_type,description,recurring_plan_id,scheduled_for) select org_id,owner_id,next_date,grape_amount,'fixed',description,id,next_date from recurring_consumption_plans where id=$1",
          [id],
        ),
      );
      await as(user);
      assert.equal(
        (await q("select * from recurring_consumption_plans where id=$1", [id]))
          .length,
        0,
      );
      await as(owner);
      await assert.rejects(db.query("select sync_recurring_consumptions()"));
      await as(otherKeeper);
      await assert.rejects(
        db.query("select stop_recurring_consumption($1,'无权停止')", [id]),
      );
      await as(other);
      await assert.rejects(
        db.query("select stop_recurring_consumption($1,'')", [id]),
      );
      await db.query("select stop_recurring_consumption($1,'意外情况')", [id]);
      await assert.rejects(
        db.query(
          "update recurring_consumption_plans set status='active' where id=$1",
          [id],
        ),
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).generated,
        0,
      );
      assert.equal(
        await v(
          "select count(*) from grape_consumptions where recurring_plan_id=$1",
          [id],
        ),
        1,
      );
    },
  );
  await t.test(
    "开启审核时每期需管家确认，但可不带凭证；缺预算不会跳过，补正后可重试",
    async () => {
      await as(otherKeeper);
      await db.query(
        "update organizations set fixed_requires_approval=true where id=$1",
        [farm2],
      );
      await as(other);
      const p = await v(
        "insert into recurring_consumption_plans(org_id,owner_id,description,grape_amount,start_date,end_date,day_of_month) values($1,$2,'需要确认',45,current_date,current_date,extract(day from current_date)) returning id",
        [farm2, other],
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).generated,
        1,
      );
      const c = await v(
        "select id from grape_consumptions where recurring_plan_id=$1",
        [p],
      );
      assert.equal(
        await v("select status from grape_consumptions where id=$1", [c]),
        "pending",
      );
      await act("grape_consumptions", c, "recall");
      await act("grape_consumptions", c, "submit");
      await as(otherKeeper);
      await act("grape_consumptions", c, "confirm");
      await as(other);
      const b = await v(
        "insert into budget_plans(org_id,owner_id,title,period_start,period_end) values($1,$2,'固定预算',current_date,(current_date+interval '2 months')::date) returning id",
        [farm2, other],
      );
      const bc = await v(
        "insert into budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount) values($1,$2,$3,'固定事项',9999) returning id",
        [farm2, other, b],
      );
      await db.query(
        "update budget_plans set status='pending_confirmation' where id=$1",
        [b],
      );
      await as(otherKeeper);
      await db.query("update budget_plans set status='confirmed' where id=$1", [
        b,
      ]);
      await as(other);
      const blocked = await v(
        "insert into recurring_consumption_plans(org_id,owner_id,description,grape_amount,start_date,end_date,day_of_month) values($1,$2,'缺科目',46,current_date,current_date,extract(day from current_date)) returning id",
        [farm2, other],
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).blocked,
        1,
      );
      assert.equal(
        await v(
          "select count(*) from grape_consumptions where recurring_plan_id=$1",
          [blocked],
        ),
        0,
      );
      assert.ok(
        await v(
          "select last_error from recurring_consumption_plans where id=$1",
          [blocked],
        ),
      );
      await db.query(
        "update recurring_consumption_plans set budget_category_id=$2 where id=$1",
        [blocked, bc],
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).generated,
        1,
      );
      assert.equal(
        await v(
          "select budget_category_id from grape_consumptions where recurring_plan_id=$1",
          [blocked],
        ),
        bc,
      );
      assert.equal(
        await v("select status from recurring_consumption_plans where id=$1", [
          blocked,
        ]),
        "completed",
      );
      await db.exec(
        "reset role;set role service_role;set request.jwt.claim.sub='';",
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).blocked,
        0,
      );
    },
  );
  await t.test(
    "任务中断后补处理到期期次，未来不生成，数据库后台身份可运行且重试不重复",
    async () => {
      await as(other);
      const category = await v(
        "select id from budget_categories where owner_id=$1 limit 1",
        [other],
      );
      const id = await v(
        "insert into recurring_consumption_plans(org_id,owner_id,description,grape_amount,start_date,end_date,day_of_month,budget_category_id) values($1,$2,'中断恢复测试',17,current_date,current_date,extract(day from current_date),$3) returning id",
        [farm2, other, category],
      );
      // 模拟三个月未执行的后台状态；客户端无权把计划改成过去日期。
      await db.exec("reset role");
      await db.query(
        "update recurring_consumption_plans set start_date=(current_date-interval '3 months')::date,next_date=private.fixed_month_date((current_date-interval '3 months')::date,extract(day from current_date)::integer) where id=$1",
        [id],
      );
      await db.exec("set request.jwt.claim.sub=''");
      const result = await v("select sync_recurring_consumptions()");
      assert.equal(result.generated, 4);
      assert.equal(result.blocked, 0);
      assert.equal(
        await v(
          "select count(*) from grape_consumptions where recurring_plan_id=$1 and consumption_date>current_date",
          [id],
        ),
        0,
      );
      assert.equal(
        await v(
          "select count(*) from grape_consumptions where recurring_plan_id=$1",
          [id],
        ),
        4,
      );
      assert.equal(
        (await v("select sync_recurring_consumptions()")).generated,
        0,
      );
      await db.exec("set role anon");
      await assert.rejects(db.query("select sync_recurring_consumptions()"));
    },
  );
});
