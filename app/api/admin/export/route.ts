import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { requireEstateOwner } from "@/lib/server/admin";
import { readRows } from "@/lib/data";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let context;
  try {
    context = await requireEstateOwner();
  } catch {
    return NextResponse.json(
      { error: "仅总园主可导出全局归档" },
      { status: 403 },
    );
  }
  const url = new URL(request.url);
  const auditOnly = url.searchParams.get("kind") === "audit";
  try {
    const tables = auditOnly
      ? ["audit_logs"]
      : [
          "organizations",
          "profiles",
          "supporters",
          "commitments",
          "commitment_periods",
          "grape_receipts",
          "grape_consumptions",
          "budget_plans",
          "budget_categories",
          "grape_consumption_attachments",
          "record_corrections",
          "audit_logs",
        ];
    const entries = await Promise.all(
      tables.map(async (table) => {
        let query = context.supabase.from(table).select("*").order("id");
        if (auditOnly) {
          const before = url.searchParams.get("before");
          if (before) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(before))
              throw new Error("归档日期无效");
            query = query.lt("created_at", `${before}T00:00:00+08:00`);
          }
        }
        return [table, await readRows(query, table)] as const;
      }),
    );
    const data = {
      format: "grape-business-export-v1",
      created_at: new Date().toISOString(),
      includes:
        "业务文字、软删除资料、附件元数据及审计；不含图片文件、Auth密码和密钥",
      tables: Object.fromEntries(entries),
    };
    const zipped = gzipSync(JSON.stringify(data));
    return new Response(new Uint8Array(zipped), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="grape-${auditOnly ? "audit" : "business"}-${new Date().toISOString().slice(0, 10)}.json.gz"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "导出失败，请检查数据库升级与网络后重试。" },
      { status: 500 },
    );
  }
}
