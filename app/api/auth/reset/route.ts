import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { passwordResets, sessions, users } from "@/db/schema";
import { PASSWORD_ITERATIONS, digest, passwordHash, readJson } from "@/lib/auth";

// Set a new password with a one-time link issued by the owner. Signs out every session.
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2_000);
    if (body instanceof Response) return body;
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 200 || !password.trim()) return Response.json({ error: "كلمة المرور 8 أحرف على الأقل." }, { status: 400 });
    const db = getDb();
    const [reset] = token ? await db.select().from(passwordResets).where(and(eq(passwordResets.tokenHash, await digest(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date().toISOString()))).limit(1) : [];
    if (!reset) return Response.json({ error: "الرابط غير صالح أو منتهي. اطلب رابطًا جديدًا." }, { status: 400 });
    const [user] = await db.select().from(users).where(eq(users.email, reset.email)).limit(1);
    if (!user) return Response.json({ error: "لا يوجد حساب بهذا البريد." }, { status: 400 });
    const salt = crypto.randomUUID();
    await db.batch([
      db.update(users).set({ passwordSalt: salt, passwordIterations: PASSWORD_ITERATIONS, passwordHash: await passwordHash(password, salt), failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id)),
      db.update(passwordResets).set({ usedAt: new Date().toISOString() }).where(eq(passwordResets.id, reset.id)),
      db.delete(sessions).where(eq(sessions.userId, user.id)),
    ]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر تغيير كلمة المرور." }, { status: 500 }); }
}
