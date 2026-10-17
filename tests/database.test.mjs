import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const org = "00000000-0000-0000-0000-000000000001";
const org2 = "00000000-0000-0000-0000-000000000002";
const user = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
const keeper = "10000000-0000-0000-0000-000000000003";
const outsider = "10000000-0000-0000-0000-000000000004";

test("数据库业务规则与 RLS（独立 PostgreSQL，不连接线上）", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'),1)-1] $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant select,insert,update,delete on storage.objects to authenticated;
  `);
  const schema = await readFile(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  await db.exec(schema.replace("create extension if not exists pgcrypto;", ""));
  await db.exec(
    `grant select, insert, update, delete on all tables in schema public to authenticated;`,
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
  await db.exec(`
    insert into public.organizations(id,name) values ('${org2}', '另一个机构');
    insert into auth.users values ('${user}'),('${other}'),('${keeper}'),('${outsider}');
    insert into public.profiles(id,org_id,role,display_name) values
      ('${user}','${org}','user','记录者甲'), ('${other}','${org}','user','记录者乙'),
      ('${keeper}','${org}','grape_keeper','管家'), ('${outsider}','${org2}','user','外部用户');
  `);
  const as = async (id) => {
    await db.exec(
      `reset role; set role authenticated; set request.jwt.claim.sub = '${id}';`,
    );
  };
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const value = async (sql, params) =>
    Object.values((await q(sql, params))[0])[0];
  let cid, sid, pid, receipt, budget, category, consumption;
  await t.test("创建承诺与期次为单个事务，首期不早于开始日期", async () => {
    await as(user);
    cid = await value(
      `select public.create_commitment_with_periods(null,'支持者甲','recurring',100,'monthly','2026-10-17',3,5,'测试')`,
    );
    sid = await value("select supporter_id from commitments where id=$1", [
      cid,
    ]);
    const periods = await q(
      "select id,expected_date::text from commitment_periods where commitment_id=$1 order by period_no",
      [cid],
    );
    assert.deepEqual(
      periods.map((p) => p.expected_date),
      ["2026-11-05", "2026-12-05", "2027-01-05"],
    );
    pid = periods[0].id;
    const before = await value("select count(*) from supporters");
    await assert.rejects(
      db.query(
        `select public.create_commitment_with_periods(null,'失败应回滚','recurring',99999999999999,'monthly','2026-10-17',2,5,null)`,
      ),
    );
    assert.equal(await value("select count(*) from supporters"), before);
  });
  await t.test("普通用户只可读取自己的业务数据", async () => {
    await as(other);
    assert.equal((await q("select * from supporters")).length, 0);
    assert.equal((await q("select * from commitments")).length, 0);
    await as(user);
    await assert.rejects(
      db.query(`update profiles set role='grape_keeper' where id=$1`, [user]),
    );
    await assert.rejects(
      db.query(`update supporters set owner_id=$1 where id=$2`, [other, sid]),
    );
  });
  await t.test(
    "实际金额不同、重复收到、待确认修改与删除均正确同步",
    async () => {
      await as(user);
      receipt = await value(
        `insert into grape_receipts(org_id,owner_id,supporter_id,commitment_id,commitment_period_id,received_date,grape_amount,source_type) values ($1,$2,$3,$4,$5,'2026-11-06',80,'commitment') returning id`,
        [org, user, sid, cid, pid],
      );
      assert.equal(
        await value(
          "select actual_grapes from commitment_periods where id=$1",
          [pid],
        ),
        "80.00",
      );
      await assert.rejects(
        db.query(
          `insert into grape_receipts(org_id,owner_id,supporter_id,commitment_id,commitment_period_id,received_date,grape_amount,source_type) values ($1,$2,$3,$4,$5,'2026-11-06',100,'commitment')`,
          [org, user, sid, cid, pid],
        ),
      );
      await db.query("update grape_receipts set grape_amount=85 where id=$1", [
        receipt,
      ]);
      assert.equal(
        await value(
          "select actual_grapes from commitment_periods where id=$1",
          [pid],
        ),
        "85.00",
      );
      await db.query("delete from grape_receipts where id=$1", [receipt]);
      assert.equal(
        await value(
          "select actual_receipt_id from commitment_periods where id=$1",
          [pid],
        ),
        null,
      );
      assert.ok(
        ["not_received", "overdue"].includes(
          await value("select status from commitment_periods where id=$1", [
            pid,
          ]),
        ),
      );
      receipt = await value(
        `insert into grape_receipts(org_id,owner_id,supporter_id,commitment_id,commitment_period_id,received_date,grape_amount,source_type) values ($1,$2,$3,$4,$5,'2026-11-06',85,'commitment') returning id`,
        [org, user, sid, cid, pid],
      );
    },
  );
  await t.test(
    "用户不可自确认，管家不可代改金额，确认后锁定并同步期次",
    async () => {
      await as(user);
      await assert.rejects(
        db.query(`update grape_receipts set status='confirmed' where id=$1`, [
          receipt,
        ]),
      );
      await assert.rejects(
        db.query(
          `update commitment_periods set status='confirmed' where id=$1`,
          [pid],
        ),
      );
      await as(keeper);
      await assert.rejects(
        db.query("update grape_receipts set grape_amount=999 where id=$1", [
          receipt,
        ]),
      );
      await db.query(
        `update grape_receipts set status='confirmed',confirmed_by=$2 where id=$1`,
        [receipt, user],
      );
      assert.equal(
        await value("select confirmed_by from grape_receipts where id=$1", [
          receipt,
        ]),
        keeper,
      );
      assert.equal(
        await value("select status from commitment_periods where id=$1", [pid]),
        "confirmed",
      );
      await assert.rejects(
        db.query("update grape_receipts set grape_amount=999 where id=$1", [
          receipt,
        ]),
      );
      await as(user);
      assert.equal(
        (
          await q("delete from grape_receipts where id=$1 returning id", [
            receipt,
          ])
        ).length,
        0,
      );
    },
  );
  await t.test("预算必须有科目并按合法状态流转", async () => {
    await as(user);
    budget = await value(
      `insert into budget_plans(org_id,owner_id,title,period_start,period_end) values ($1,$2,'测试预算','2026-10-01','2026-10-31') returning id`,
      [org, user],
    );
    await assert.rejects(
      db.query(
        `update budget_plans set status='pending_confirmation' where id=$1`,
        [budget],
      ),
    );
    category = await value(
      `insert into budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount) values ($1,$2,$3,'项目',200) returning id`,
      [org, user, budget],
    );
    await db.query(
      `update budget_plans set status='pending_confirmation' where id=$1`,
      [budget],
    );
    await assert.rejects(
      db.query(
        `update budget_plans set status='revision_unlocked' where id=$1`,
        [budget],
      ),
    );
    const overlapping = await value(
      `insert into budget_plans(org_id,owner_id,title,period_start,period_end) values ($1,$2,'重叠预算','2026-10-01','2026-10-31') returning id`,
      [org, user],
    );
    await db.query(
      `insert into budget_categories(org_id,owner_id,budget_plan_id,name,budgeted_amount) values ($1,$2,$3,'其他',100)`,
      [org, user, overlapping],
    );
    await db.query(
      `update budget_plans set status='pending_confirmation' where id=$1`,
      [overlapping],
    );
    await as(keeper);
    await db.query(`update budget_plans set status='confirmed' where id=$1`, [
      budget,
    ]);
    await assert.rejects(
      db.query(`update budget_plans set status='confirmed' where id=$1`, [
        overlapping,
      ]),
    );
    await as(user);
    await db.query(`update budget_plans set status='draft' where id=$1`, [
      overlapping,
    ]);
    await db.query("delete from budget_plans where id=$1", [overlapping]);
    await as(user);
    await assert.rejects(
      db.query("update budget_categories set budgeted_amount=300 where id=$1", [
        category,
      ]),
    );
    await db.query(
      `update budget_plans set status='revision_requested' where id=$1`,
      [budget],
    );
    await assert.rejects(
      db.query(
        `update budget_plans set status='revision_unlocked' where id=$1`,
        [budget],
      ),
    );
    await as(keeper);
    await db.query(
      `update budget_plans set status='revision_unlocked' where id=$1`,
      [budget],
    );
    await as(user);
    await db.query(
      "update budget_categories set budgeted_amount=250 where id=$1",
      [category],
    );
    await db.query(
      `update budget_plans set status='revision_pending_confirmation' where id=$1`,
      [budget],
    );
    await as(keeper);
    await db.query(`update budget_plans set status='confirmed' where id=$1`, [
      budget,
    ]);
  });
  await t.test(
    "预算科目日期校验、凭证未完成不能确认、最多 5 个凭证",
    async () => {
      await as(user);
      await assert.rejects(
        db.query(
          `insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,description) values ($1,$2,'2026-10-17',20,'缺科目')`,
          [org, user],
        ),
      );
      await assert.rejects(
        db.query(
          `insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,description,budget_category_id) values ($1,$2,'2026-11-17',20,'日期不匹配',$3)`,
          [org, user, category],
        ),
      );
      consumption = await value(
        `insert into grape_consumptions(org_id,owner_id,consumption_date,grape_amount,description,budget_category_id,attachments_ready) values ($1,$2,'2026-10-17',20,'项目使用',$3,false) returning id`,
        [org, user, category],
      );
      for (let i = 0; i < 5; i++)
        await db.query(
          `insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values ($1,$2,$3,$4,'voucher.jpg','image/jpeg',1024)`,
          [org, user, consumption, `${user}/${consumption}/${i}.jpg`],
        );
      await assert.rejects(
        db.query(
          `insert into grape_consumption_attachments(org_id,owner_id,consumption_id,file_path,file_name,mime_type,file_size) values ($1,$2,$3,$4,'too-many.jpg','image/jpeg',1024)`,
          [org, user, consumption, `${user}/${consumption}/six.jpg`],
        ),
      );
      await as(keeper);
      await assert.rejects(
        db.query(
          `update grape_consumptions set status='confirmed' where id=$1`,
          [consumption],
        ),
      );
      await as(user);
      await db.query(
        "update grape_consumptions set attachments_ready=true where id=$1",
        [consumption],
      );
      await assert.rejects(
        db.query(
          `update grape_consumptions set consumption_date='2026-11-01' where id=$1`,
          [consumption],
        ),
      );
      await as(keeper);
      await db.query(
        `update grape_consumptions set status='confirmed' where id=$1`,
        [consumption],
      );
      await as(user);
      assert.equal(
        (
          await q(
            "delete from grape_consumption_attachments where consumption_id=$1 returning id",
            [consumption],
          )
        ).length,
        0,
      );
    },
  );
  await t.test("空间统计按人/机构隔离，已确认凭证对象不能删除", async () => {
    await db.exec("reset role");
    for (const [id, owner, path, size] of [
      [user, user, consumption, 1024],
      [other, other, "pending", 2048],
      [outsider, outsider, "pending", 4096],
    ]) {
      await db.query(
        `insert into storage.objects(bucket_id,name,metadata) values ('consumption-attachments',$1,$2::jsonb)`,
        [`${owner}/${path}/sample.jpg`, JSON.stringify({ size })],
      );
    }
    await as(user);
    assert.equal(
      (await q("select * from public.get_storage_usage_summary()"))[0]
        .total_bytes,
      1024,
    );
    assert.equal(
      (await q("delete from storage.objects returning id")).length,
      0,
    );
    await as(keeper);
    assert.equal(
      (await q("select * from public.get_storage_usage_summary()"))[0]
        .total_bytes,
      3072,
    );
    assert.equal((await q("select * from storage.objects")).length, 2);
  });
  await t.test("审计由数据库自动写入，用户不能伪造或读取他人日志", async () => {
    await as(user);
    assert.ok((await q("select * from audit_logs")).length > 0);
    await assert.rejects(
      db.query(
        `insert into audit_logs(org_id,actor_id,action,entity_table) values ($1,$2,'伪造','budget_plans')`,
        [org, user],
      ),
    );
    await as(other);
    assert.equal((await q("select * from audit_logs")).length, 0);
    await assert.rejects(db.query("select * from notification_deliveries"));
  });
});
