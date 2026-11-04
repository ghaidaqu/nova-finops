import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, workspaces } from "@/db/schema";
import { createSession, passwordHash, readJson, sessionCookie, str } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const name = str(body.name, 80) || "صاحب الحساب";
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const workspaceName = str(body.workspace, 80) || "مساحة عمل جديدة";
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200 || !password.trim()) return Response.json({ error: "أدخل بريدًا صحيحًا وكلمة مرور من 8 أحرف على الأقل." }, { status: 400 });
    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return Response.json({ error: "هذا البريد مسجل بالفعل. سجّل الدخول." }, { status: 409 });
    const id = crypto.randomUUID();
    const salt = crypto.randomUUID();
    const workspace = { id: crypto.randomUUID(), ownerId: id, name: workspaceName };
    // One batch, so a failure can't leave a user without a workspace.
    await db.batch([
      db.insert(users).values({ id, name, email, passwordSalt: salt, passwordHash: await passwordHash(password, salt) }),
      db.insert(workspaces).values(workspace),
    ]);
    const token = await createSession(id);
    return Response.json({ user: { name, email }, workspace: { id: workspace.id, name: workspace.name } }, { status: 201, headers: { "Set-Cookie": sessionCookie(token, request) } });
  } catch {
    return Response.json({ error: "تعذر إنشاء الحساب الآن. حاول مرة أخرى." }, { status: 500 });
  }
}
