"use client";
import type { Profile } from "@/lib/types";
import { profileName } from "@/lib/utils";

export type Filters = {
  search: string;
  status: string;
  owner: string;
  month: string;
};
export const EMPTY_FILTERS: Filters = {
  search: "",
  status: "all",
  owner: "all",
  month: "",
};
export default function RecordFilters({
  value,
  onChange,
  profiles,
  count,
}: {
  value: Filters;
  onChange: (value: Filters) => void;
  profiles?: Profile[];
  count: number;
}) {
  return (
    <div className="record-filters no-print">
      <label className="field">
        <span>搜索</span>
        <input
          className="input"
          type="search"
          placeholder="姓名、说明或备注"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
        />
      </label>
      <label className="field">
        <span>状态</span>
        <select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
        >
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="returned">已退回</option>
          <option value="pending">待确认</option>
          <option value="confirmed">已确认</option>
        </select>
      </label>
      <label className="field">
        <span>月份</span>
        <input
          className="input"
          type="month"
          value={value.month}
          onChange={(e) => onChange({ ...value, month: e.target.value })}
        />
      </label>
      {profiles && (
        <label className="field">
          <span>记录人</span>
          <select
            value={value.owner}
            onChange={(e) => onChange({ ...value, owner: e.target.value })}
          >
            <option value="all">全部记录人</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {profileName(p)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="filter-summary">
        <span>{count} 条记录</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          重置筛选
        </button>
      </div>
    </div>
  );
}
