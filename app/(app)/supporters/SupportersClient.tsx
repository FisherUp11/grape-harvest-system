"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import RecordTable from "@/app/components/RecordTable";
import type {
  CommitmentPeriod,
  GrapeReceipt,
  Profile,
  Supporter,
} from "@/lib/types";
import {
  cycleLabel,
  downloadCsv,
  errorMessage,
  formatGrapes,
  profileName,
  toDateInput,
} from "@/lib/utils";

type Props = {
  profile: Profile;
  profiles: Profile[];
  supporters: Supporter[];
  receipts: GrapeReceipt[];
  periods: CommitmentPeriod[];
};
export default function SupportersClient({
  profile,
  profiles,
  supporters,
  receipts,
  periods,
}: Props) {
  const supabase = createClient();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<Supporter | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("active");
  const [supportType, setSupportType] = useState("one_time");
  const [cycle, setCycle] = useState("monthly");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles],
  );
  const stats = useMemo(() => {
    const map: Record<
      string,
      {
        confirmed: number;
        pending: number;
        missed: number;
        count: number;
        last: string;
      }
    > = {};
    for (const s of supporters)
      map[s.id] = { confirmed: 0, pending: 0, missed: 0, count: 0, last: "" };
    for (const r of receipts) {
      if (!r.supporter_id || !map[r.supporter_id]) continue;
      if (r.status === "confirmed") {
        map[r.supporter_id].confirmed += Number(r.grape_amount);
        if (!r.is_correction) map[r.supporter_id].count++;
        if (!r.is_correction && r.received_date > map[r.supporter_id].last)
          map[r.supporter_id].last = r.received_date;
      } else map[r.supporter_id].pending += Number(r.grape_amount);
    }
    for (const p of periods)
      if (map[p.supporter_id] && ["not_received", "overdue"].includes(p.status))
        map[p.supporter_id].missed += Number(p.expected_grapes);
    return map;
  }, [supporters, receipts, periods]);
  const filtered = supporters.filter(
    (s) =>
      (owner === "all" || owner === s.owner_id) &&
      (statusFilter === "all" || statusFilter === s.status) &&
      `${s.name} ${s.email || ""} ${s.notes || ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const reset = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setNotes("");
    setStatus("active");
    setSupportType("one_time");
    setCycle("monthly");
    setMessage("");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setMessage("");
    setSuccess("");
    if (!name.trim()) return setMessage("请填写支持者姓名。");
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        notes: notes.trim() || null,
        status,
        support_type: supportType,
        cycle: supportType === "recurring" ? cycle : null,
      };
      const { error } = await (editing
        ? supabase
            .from("supporters")
            .update(payload)
            .eq("id", editing.id)
            .eq("owner_id", profile.id)
            .select("id")
            .single()
        : supabase
            .from("supporters")
            .insert({
              ...payload,
              org_id: profile.org_id,
              owner_id: profile.id,
            })
            .select("id")
            .single());
      if (error) throw error;
      setSuccess(editing ? "支持者资料已更新。" : "支持者已新增。");
      reset();
      router.refresh();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const edit = (s: Supporter) => {
    setEditing(s);
    setName(s.name);
    setEmail(s.email || "");
    setNotes(s.notes || "");
    setStatus(s.status);
    setSupportType(s.support_type);
    setCycle(s.cycle || "monthly");
    setMessage("");
    setSuccess("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    formRef.current?.querySelector("input")?.focus({ preventScroll: true });
  };
  const exportCsv = () =>
    downloadCsv(`支持者明细_${toDateInput()}.csv`, [
      [
        "用户",
        "支持者",
        "邮箱",
        "备注",
        "支持类型",
        "周期",
        "状态",
        "已确认",
        "待确认",
        "未收到",
        "次数",
        "最近收到",
      ],
      ...filtered.map((s) => [
        profileName(profileMap[s.owner_id]),
        s.name,
        s.email || "",
        s.notes || "",
        s.support_type === "recurring" ? "周期性" : "一次性",
        cycleLabel(s.cycle),
        s.status === "active"
          ? "活跃"
          : s.status === "paused"
            ? "暂停"
            : "已停止",
        String(stats[s.id].confirmed),
        String(stats[s.id].pending),
        String(stats[s.id].missed),
        String(stats[s.id].count),
        stats[s.id].last,
      ]),
    ]);
  return (
    <>
      <header className="page-header">
        <div className="page-title">
          <p className="eyebrow">SUPPORTER GARDEN</p>
          <h1>支持者管理</h1>
          <p>维护自己的支持者资料与支持情况。同名支持者按所属用户分别保存。</p>
        </div>
        <button className="btn btn-secondary" onClick={exportCsv}>
          导出筛选结果 CSV
        </button>
      </header>
      {success && (
        <p className="notice success" role="status">
          {success}
        </p>
      )}
      {profile.role !== "super_admin" && (
        <form className="card stack record-form" ref={formRef} onSubmit={save}>
          <div className="section-heading">
            <h2>{editing ? "修改支持者" : "新增支持者"}</h2>
            {editing && (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={reset}
              >
                取消修改
              </button>
            )}
          </div>
          <fieldset className="form-grid" disabled={saving}>
            <label className="field">
              <span>姓名</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>邮箱（选填）</span>
              <input
                className="input"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="field">
              <span>支持类型</span>
              <select
                value={supportType}
                onChange={(e) => setSupportType(e.target.value)}
              >
                <option value="one_time">一次性</option>
                <option value="recurring">周期性</option>
              </select>
            </label>
            {supportType === "recurring" && (
              <label className="field">
                <span>周期</span>
                <select
                  value={cycle}
                  onChange={(e) => setCycle(e.target.value)}
                >
                  {["monthly", "quarterly", "half_yearly", "yearly"].map(
                    (c) => (
                      <option key={c} value={c}>
                        {cycleLabel(c as Supporter["cycle"])}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
            <label className="field">
              <span>当前状态</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">活跃</option>
                <option value="paused">暂停</option>
                <option value="stopped">已停止</option>
              </select>
            </label>
            <label className="field full-width">
              <span>备注（选填）</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </fieldset>
          {message && (
            <p className="notice danger" role="alert">
              {message}
            </p>
          )}
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "保存中…" : editing ? "保存修改" : "新增支持者"}
          </button>
        </form>
      )}
      <section className="card section-space">
        <h2>支持者列表</h2>
        <div className="record-filters">
          <label className="field">
            <span>搜索支持者</span>
            <input
              className="input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="姓名、邮箱或备注"
            />
          </label>
          <label className="field">
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="active">活跃</option>
              <option value="paused">暂停</option>
              <option value="stopped">已停止</option>
            </select>
          </label>
          {profile.role !== "user" && (
            <label className="field">
              <span>所属用户</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">全部用户</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {profileName(p)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span>{filtered.length} 位支持者</span>
        </div>
        <RecordTable
          headings={[
            "支持者",
            "所属用户",
            "邮箱",
            "备注",
            "已确认",
            "待确认 / 未收到",
            "次数 / 最近收到",
            "操作",
          ]}
          rows={filtered.map((s) => ({
            id: s.id,
            cells: [
              <span key="n">
                <strong>{s.name}</strong>
                <br />
                <span className="muted">
                  {cycleLabel(s.cycle)} ·{" "}
                  {s.status === "active"
                    ? "活跃"
                    : s.status === "paused"
                      ? "暂停"
                      : "已停止"}
                </span>
              </span>,
              profileName(profileMap[s.owner_id]),
              s.email ? (
                <a key="e" href={`mailto:${s.email}`}>
                  {s.email}
                </a>
              ) : (
                "—"
              ),
              s.notes || "—",
              formatGrapes(stats[s.id].confirmed),
              `${formatGrapes(stats[s.id].pending)} / ${formatGrapes(stats[s.id].missed)}`,
              `${stats[s.id].count} 次 · ${stats[s.id].last || "暂无"}`,
              s.owner_id === profile.id && profile.role !== "super_admin" ? (
                <button
                  key="edit"
                  className="btn btn-secondary"
                  onClick={() => edit(s)}
                >
                  修改资料
                </button>
              ) : (
                <span key="ro" className="muted">
                  仅查看
                </span>
              ),
            ],
          }))}
        />
      </section>
    </>
  );
}
