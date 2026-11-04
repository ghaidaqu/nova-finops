import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, passwordHash, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() || "";
    const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || await passwordHash(body.password || "", user.passwordSalt) !== user.passwordHash) return Response.json({ error: "البريد أو كلمة المرور غير صحيحة." }, { status: 401 });
    const token = await createSession(user.id);
    return Response.json({ user: { name: user.name, email: user.email } }, { headers: { "Set-Cookie": sessionCookie(token) } });
  } catch { return Response.json({ error: "تعذر تسجيل الدخول الآن." }, { status: 500 }); }
}
