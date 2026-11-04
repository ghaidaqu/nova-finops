import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, issueStates, transactions, workspaces } from "@/db/schema";
import { currentUser } from "@/lib/auth";

export async function PATCH(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await request.json() as { name?: string; sector?: string; toleranceHalalas?: number };
    const tolerance = typeof body.toleranceHalalas === "number" && Number.isFinite(body.toleranceHalalas) ? Math.min(100000, Math.max(0, Math.round(body.toleranceHalalas))) : undefined;
    await getDb().update(workspaces).set({ name: body.name?.trim().slice(0, 80) || undefined, sector: body.sector?.trim().slice(0, 40) || undefined, toleranceHalalas: tolerance }).where(eq(workspaces.id, user.workspace.id));
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
