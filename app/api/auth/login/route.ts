import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { PASSWORD_ITERATIONS, createSession, passwordHash, readJson, sessionCookie, str } from "@/lib/auth";

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

export async function POST(request: Request) {
  try {
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const email = str(body.email).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) {
      // Hash anyway so response time doesn't reveal which emails have accounts.
      await passwordHash(password, "no-such-user");
      return Response.json({ error: "البريد أو كلمة المرور غير صحيحة." }, { status: 401 });
    }
    if (user.lockedUntil && user.lockedUntil > new Date().toISOString()) return Response.json({ error: `محاولات كثيرة خاطئة. حاول بعد ${LOCK_MINUTES} دقيقة.` }, { status: 429 });
    if (await passwordHash(password, user.passwordSalt, user.passwordIterations) !== user.passwordHash) {
      const failures = user.failedLogins + 1;
      const locked = failures >= MAX_FAILURES;
      await db.update(users).set({ failedLogins: locked ? 0 : failures, lockedUntil: locked ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : user.lockedUntil }).where(eq(users.id, user.id));
      return Response.json({ error: "البريد أو كلمة المرور غير صحيحة." }, { status: 401 });
    }
    // Successful login: clear failures and move older hashes to the current iteration count.
    const salt = user.passwordIterations === PASSWORD_ITERATIONS ? user.passwordSalt : crypto.randomUUID();
    await db.update(users).set({ failedLogins: 0, lockedUntil: null, passwordSalt: salt, passwordIterations: PASSWORD_ITERATIONS, passwordHash: salt === user.passwordSalt ? user.passwordHash : await passwordHash(password, salt) }).where(eq(users.id, user.id));
    const token = await createSession(user.id);
    return Response.json({ user: { name: user.name, email: user.email } }, { headers: { "Set-Cookie": sessionCookie(token, request) } });
  } catch { return Response.json({ error: "تعذر تسجيل الدخول الآن." }, { status: 500 }); }
}
