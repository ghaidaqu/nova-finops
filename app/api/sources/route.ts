import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, transactions } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { sourceKinds } from "@/lib/import-rows";
import type { SourceKind } from "@/lib/reconcile";

const clamp = (value: unknown, min: number, max: number) => (typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined);

// Update how a source is read: its kind, agreed fee and settlement window.
export async function PATCH(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await request.json() as { source?: string; kind?: string; feeBps?: number; feeFixedHalalas?: number; lagDays?: number };
    const set = {
      kind: sourceKinds.includes(body.kind as SourceKind) ? body.kind as SourceKind : undefined,
      feeBps: clamp(body.feeBps, 0, 5000),
      feeFixedHalalas: clamp(body.feeFixedHalalas, 0, 100000),
      lagDays: clamp(body.lagDays, 0, 60),
    };
    await getDb().update(connections).set(set).where(and(eq(connections.workspaceId, user.workspace.id), eq(connections.source, body.source || "")));
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر حفظ الإعدادات." }, { status: 500 }); }
}

// Remove a source and every transaction imported from it.
export async function DELETE(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const source = new URL(request.url).searchParams.get("source") || "";
    const db = getDb();
    await db.batch([
      db.delete(transactions).where(and(eq(transactions.workspaceId, user.workspace.id), eq(transactions.source, source))),
      db.delete(connections).where(and(eq(connections.workspaceId, user.workspace.id), eq(connections.source, source))),
    ]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر حذف المصدر." }, { status: 500 }); }
}
