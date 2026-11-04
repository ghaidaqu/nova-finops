import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { PASSWORD_ITERATIONS, currentUser, digest, passwordHash, readJson } from "@/lib/auth";

// Change the signed-in user's password and sign out their other sessions.
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const next = typeof body.next === "string" ? body.next : "";
    if (next.length < 8 || next.length > 200 || !next.trim()) return Response.json({ error: "كلمة المرور الجديدة 8 أحرف على الأقل." }, { status: 400 });
    const db = getDb();
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (await passwordHash(typeof body.current === "string" ? body.current : "", row.passwordSalt, row.passwordIterations) !== row.passwordHash) return Response.json({ error: "كلمة المرور الحالية غير صحيحة." }, { status: 400 });
    const salt = crypto.randomUUID();
    const token = request.headers.get("cookie")?.match(/(?:^|;\s*)nova_session=([^;]+)/)?.[1] || "";
    await db.batch([
      db.update(users).set({ passwordSalt: salt, passwordIterations: PASSWORD_ITERATIONS, passwordHash: await passwordHash(next, salt) }).where(eq(users.id, user.id)),
      db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.tokenHash, await digest(token)))),
    ]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر تغيير كلمة المرور." }, { status: 500 }); }
}
