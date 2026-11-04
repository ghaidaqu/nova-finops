import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, issueStates, transactions, workspaces } from "@/db/schema";
import { currentUser, num, readJson, str } from "@/lib/auth";

export async function PATCH(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const toleranceValue = num(body.toleranceHalalas);
    const set = { name: str(body.name, 80) || undefined, sector: str(body.sector, 40) || undefined, toleranceHalalas: toleranceValue === undefined ? undefined : Math.min(100000, Math.max(0, Math.round(toleranceValue))) };
    if (Object.values(set).every((v) => v === undefined)) return Response.json({ error: "لا توجد إعدادات للحفظ." }, { status: 400 });
    await getDb().update(workspaces).set(set).where(eq(workspaces.id, user.workspace.id));
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر حفظ الإعدادات." }, { status: 500 }); }
}

// Delete all imported data, keeping the account and workspace.
export async function DELETE(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const db = getDb();
    const id = user.workspace.id;
    await db.batch([
      db.delete(transactions).where(eq(transactions.workspaceId, id)),
      db.delete(connections).where(eq(connections.workspaceId, id)),
      db.delete(issueStates).where(eq(issueStates.workspaceId, id)),
    ]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر حذف البيانات." }, { status: 500 }); }
}
