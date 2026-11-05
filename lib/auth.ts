import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users, workspaces } from "@/db/schema";
import { setting } from "@/lib/env";

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

// Cloudflare Workers reject PBKDF2 above 100,000 iterations in production.
export const PASSWORD_ITERATIONS = 100000;

export async function passwordHash(password: string, salt: string, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations }, key, 256);
  return hex(bits);
}

// Parses a JSON object body. Requiring application/json also blocks cross-site
// form posts (login CSRF), since browsers can't send that type cross-origin without CORS.
export async function readJson(request: Request, maxBytes = 15_000_000): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "طلب غير مدعوم." }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return Response.json({ error: "الملف كبير جدًا. قسّمه إلى ملفات أصغر." }, { status: 413 });
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {}
  return Response.json({ error: "طلب غير صالح." }, { status: 400 });
}

export const str = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");
export const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function cookieValue(request: Request, key: string) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1);
}

// Owners of this NOVA install (comma-separated NOVA_ADMIN_EMAILS) can answer reset requests.
export const isAdmin = (user: { email: string }) => (setting("NOVA_ADMIN_EMAILS") || "").toLowerCase().split(",").map((e) => e.trim()).includes(user.email.toLowerCase());

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
