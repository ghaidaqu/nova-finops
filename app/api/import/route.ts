import { currentUser } from "@/lib/auth";
import { importRows, sourceKinds, type ImportRow } from "@/lib/import-rows";
import type { SourceKind } from "@/lib/reconcile";

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "سجّل الدخول أولًا." }, { status: 401 });
    const body = await request.json() as { source?: string; kind?: string; rows?: ImportRow[] };
    const source = body.source?.trim().slice(0, 60) || "CSV";
    const kind = sourceKinds.includes(body.kind as SourceKind) ? body.kind as SourceKind : "sales";
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [];
    if (!rows.length) return Response.json({ error: "لم نجد عمليات صالحة في الملف." }, { status: 400 });
    const result = await importRows(user.workspace.id, source, kind, rows);
    if (!result.imported && !result.skipped) return Response.json({ error: "تأكد أن عمودي التاريخ والمبلغ صحيحان." }, { status: 400 });
    return Response.json(result);
  } catch { return Response.json({ error: "تعذر استيراد الملف. تأكد من تنسيقه وحاول مرة أخرى." }, { status: 500 }); }
}
