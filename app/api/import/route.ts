import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, transactions } from "@/db/schema";
import { currentUser } from "@/lib/auth";

type Row = { date?: string; description?: string; amount?: number; expected?: number; reference?: string; kind?: string };

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "سجّلي الدخول أولًا." }, { status: 401 });
    const body = await request.json() as { source?: string; rows?: Row[] };
    const source = body.source?.trim().slice(0, 60) || "CSV";
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5000) : [];
    if (!rows.length) return Response.json({ error: "لم نجد عمليات صالحة في الملف." }, { status: 400 });
    const now = new Date().toISOString();
    const records = rows.filter((row) => Number.isFinite(row.amount)).map((row) => ({
      id: crypto.randomUUID(), workspaceId: user.workspace.id, source,
      reference: row.reference?.slice(0, 100) || null,
      occurredOn: /^\d{4}-\d{2}-\d{2}/.test(row.date || "") ? row.date!.slice(0, 10) : now.slice(0, 10),
      description: row.description?.slice(0, 300) || "عملية مستوردة",
      amountHalalas: Math.round(Number(row.amount) * 100),
      expectedHalalas: Number.isFinite(row.expected) ? Math.round(Number(row.expected) * 100) : null,
      kind: row.kind?.slice(0, 30) || "sale",
    }));
    if (!records.length) return Response.json({ error: "تأكدي أن عمود amount يحتوي أرقامًا." }, { status: 400 });
    const db = getDb();
    await db.insert(transactions).values(records);
    const [connection] = await db.select().from(connections).where(eq(connections.workspaceId, user.workspace.id)).orderBy(desc(connections.lastSyncAt)).limit(1);
    const sameSource = connection?.source === source;
    if (sameSource) await db.update(connections).set({ lastSyncAt: now, status: "connected" }).where(eq(connections.id, connection.id));
    else await db.insert(connections).values({ id: crypto.randomUUID(), workspaceId: user.workspace.id, source, status: "connected", lastSyncAt: now });
    return Response.json({ imported: records.length });
  } catch { return Response.json({ error: "تعذر استيراد الملف. تأكدي من تنسيقه وحاولي مرة أخرى." }, { status: 500 }); }
}
