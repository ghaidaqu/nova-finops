import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { currentUser, digest, isAdmin, readJson, str } from "@/lib/auth";
import { originOf } from "@/lib/integrations/sync";

// Owner tools: see open reset requests and issue a one-time link (valid 24 hours) to send.
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user || !isAdmin(user)) return Response.json({ error: "غير مصرح" }, { status: 403 });
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const rows = await getDb().select({ id: passwordResets.id, email: passwordResets.email, requestedAt: passwordResets.requestedAt, hasAccount: users.id })
      .from(passwordResets).leftJoin(users, eq(users.email, passwordResets.email))
      .where(and(isNull(passwordResets.usedAt), gt(passwordResets.requestedAt, week))).orderBy(desc(passwordResets.requestedAt)).limit(50);
    return Response.json({ requests: rows.map((r) => ({ id: r.id, email: r.email, requestedAt: r.requestedAt, hasAccount: Boolean(r.hasAccount) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "تعذر التحميل." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user || !isAdmin(user)) return Response.json({ error: "غير مصرح" }, { status: 403 });
    const body = await readJson(request, 1_000);
    if (body instanceof Response) return body;
    const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
    await getDb().update(passwordResets).set({ tokenHash: await digest(token), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }).where(and(eq(passwordResets.id, str(body.id, 60)), isNull(passwordResets.usedAt)));
    return Response.json({ link: `${originOf(request)}/reset-password?token=${token}` }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "تعذر إنشاء الرابط." }, { status: 500 }); }
}
