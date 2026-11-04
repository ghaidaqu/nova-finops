import { currentUser, readJson, str } from "@/lib/auth";
import { importRows, sourceKinds, type ImportRow } from "@/lib/import-rows";
import type { SourceKind } from "@/lib/reconcile";

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "سجّل الدخول أولًا." }, { status: 401 });
    const body = await readJson(request);
    if (body instanceof Response) return body;
    const source = str(body.source, 60) || "CSV";
    const kind = sourceKinds.includes(body.kind as SourceKind) ? body.kind as SourceKind : "sales";
    if (Array.isArray(body.rows) && body.rows.length > 20000) return Response.json({ error: "الملف أكبر من 20,000 عملية. قسّمه إلى ملفات أصغر." }, { status: 413 });
    const rows = (Array.isArray(body.rows) ? body.rows : []).filter((row): row is ImportRow => Boolean(row) && typeof row === "object");
    if (!rows.length) return Response.json({ error: "لم نجد عمليات صالحة في الملف." }, { status: 400 });
    const result = await importRows(user.workspace.id, source, kind, rows);
    if (!result.imported && !result.skipped) return Response.json({ error: "تأكد أن عمودي التاريخ والمبلغ صحيحان." }, { status: 400 });
    return Response.json(result);
  } catch { return Response.json({ error: "تعذر استيراد الملف. تأكد من تنسيقه وحاول مرة أخرى." }, { status: 500 }); }
}
