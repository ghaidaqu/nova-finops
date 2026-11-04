import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaces } from "@/db/schema";
import { createSession, passwordHash, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: string; email?: string; password?: string; workspace?: string };
    const name = body.name?.trim() || "صاحب الحساب";
    const email = body.email?.trim().toLowerCase() || "";
    const password = body.password || "";
    const workspaceName = body.workspace?.trim() || "مساحة عمل جديدة";
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return Response.json({ error: "أدخلي بريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل." }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "هذا البريد مسجل بالفعل. سجّلي الدخول." }, { status: 409 });
    const id = crypto.randomUUID();
    const salt = crypto.randomUUID();
    await db.insert(users).values({ id, name, email, passwordSalt: salt, passwordHash: await passwordHash(password, salt) });
    const workspace = { id: crypto.randomUUID(), ownerId: id, name: workspaceName };
    await db.insert(workspaces).values(workspace);
    const token = await createSession(id);
    return Response.json({ user: { name, email }, workspace: { id: workspace.id, name: workspace.name } }, { status: 201, headers: { "Set-Cookie": sessionCookie(token, request) } });
  } catch {
    return Response.json({ error: "تعذر إنشاء الحساب الآن. حاولي مرة أخرى." }, { status: 500 });
  }
}
