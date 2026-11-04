import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users, workspaces } from "@/db/schema";

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 150000 }, key, 256);
  return hex(bits);
}

function cookieValue(request: Request, key: string) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1);
}

export type CurrentUser = { id: string; name: string; email: string; workspace: { id: string; name: string } };

export async function currentUser(request: Request): Promise<CurrentUser | null> {
  const token = cookieValue(request, "nova_session");
  if (!token) return null;
  const db = getDb();
  const [session] = await db.select().from(sessions).where(and(eq(sessions.tokenHash, await digest(token)), gt(sessions.expiresAt, new Date().toISOString()))).limit(1);
  if (!session) return null;
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.ownerId, session.userId)).limit(1);
  return user && workspace ? { id: user.id, name: user.name, email: user.email, workspace: { id: workspace.id, name: workspace.name } } : null;
}

export async function createSession(userId: string) {
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  await getDb().insert(sessions).values({ id: crypto.randomUUID(), userId, tokenHash: await digest(token), expiresAt: expires });
  return token;
}

// Secure only over https, so local http previews (including Safari) keep the session.
export function sessionCookie(token: string, request: Request, maxAge = 1209600) {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `nova_session=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

export async function endSession(request: Request) {
  const token = cookieValue(request, "nova_session");
  if (token) await getDb().delete(sessions).where(eq(sessions.tokenHash, await digest(token)));
}
