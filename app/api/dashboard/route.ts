import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, transactions } from "@/db/schema";
import { currentUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const db = getDb();
    const rows = await db.select().from(transactions).where(eq(transactions.workspaceId, user.workspace.id)).orderBy(desc(transactions.occurredOn)).limit(5000);
    const linked = await db.select().from(connections).where(eq(connections.workspaceId, user.workspace.id)).orderBy(desc(connections.lastSyncAt));
    const sales = rows.filter((row) => row.amountHalalas > 0).reduce((total, row) => total + row.amountHalalas, 0);
    const issues = rows.filter((row) => row.expectedHalalas !== null && Math.abs(row.amountHalalas - row.expectedHalalas) > 1);
    const difference = issues.reduce((total, row) => total + Math.abs(row.amountHalalas - (row.expectedHalalas || 0)), 0);
    return Response.json({ user, totals: { records: rows.length, sales: sales / 100, issues: issues.length, difference: difference / 100, matched: rows.length ? Math.round(((rows.length - issues.length) / rows.length) * 1000) / 10 : 0 }, connections: linked.map((item) => ({ source: item.source, status: item.status, lastSyncAt: item.lastSyncAt })), recentIssues: issues.slice(0, 5).map((row) => ({ description: row.description, amount: Math.abs(row.amountHalalas - (row.expectedHalalas || 0)) / 100, source: row.source })) });
  } catch { return Response.json({ error: "تعذر تحميل البيانات." }, { status: 500 }); }
}
