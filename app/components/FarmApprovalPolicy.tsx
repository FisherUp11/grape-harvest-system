"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
export default function FarmApprovalPolicy({
  farmId,
  required,
}: {
  farmId: string;
  required: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient()
        .from("organizations")
        .update({ fixed_requires_approval: !required })
        .eq("id", farmId)
        .select("id")
        .single();
      if (error) throw error;
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card section-space">
      <h2>本农场吃葡萄审核规则</h2>
      <p>
        <strong>
          固定吃葡萄：{required ? "需要管家确认" : "免确认，提交后自动生效"}
        </strong>
      </p>
      <p>项目吃葡萄、一次性吃葡萄及所有更正单：始终需要管家确认。</p>
      <button
        className="btn btn-secondary"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        {required ? "将固定吃葡萄设为免确认" : "开启固定吃葡萄人工确认"}
      </button>
      <p className="muted">
        仅影响之后首次提交的新单。已提交记录沿用原规则，已确认记录保持锁定。
      </p>
      <ConfirmDialog
        open={open}
        title="修改本农场固定吃葡萄规则？"
        loading={busy}
        errorMessage={error}
        onConfirm={() => void save()}
        onCancel={() => setOpen(false)}
        description={
          <p>
            固定吃葡萄将改为
            {required
              ? "免确认，提交后立即扣减存量并锁定"
              : "需由管家确认后才扣减存量"}
            。项目和一次性吃葡萄不会改变。
          </p>
        }
      />
    </section>
  );
}
