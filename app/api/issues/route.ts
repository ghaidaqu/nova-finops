import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { issueStates } from "@/db/schema";
import { currentUser, readJson, str } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const issueId = str(body.issueId, 80);
    if (!issueId) return Response.json({ error: "تنبيه غير معروف." }, { status: 400 });
    const db = getDb();
    if (body.status === "open") await db.delete(issueStates).where(and(eq(issueStates.workspaceId, user.workspace.id), eq(issueStates.issueId, issueId)));
    else if (body.status === "resolved" || body.status === "snoozed") {
      const updatedAt = new Date().toISOString();
      await db.insert(issueStates).values({ workspaceId: user.workspace.id, issueId, status: body.status, updatedAt }).onConflictDoUpdate({ target: [issueStates.workspaceId, issueStates.issueId], set: { status: body.status, updatedAt } });
    } else return Response.json({ error: "حالة غير معروفة." }, { status: 400 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر تحديث التنبيه." }, { status: 500 }); }
}
