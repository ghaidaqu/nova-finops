import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { passwordResets } from "@/db/schema";
import { readJson, str } from "@/lib/auth";

// Record a reset request for the NOVA owner to answer with a one-time link. Always answers the
// same way, so it doesn't reveal which emails have accounts.
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2_000);
    if (body instanceof Response) return body;
    const email = str(body.email, 200).toLowerCase();
    if (/^\S+@\S+\.\S+$/.test(email)) {
      const db = getDb();
      const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
      const [recent] = await db.select({ id: passwordResets.id }).from(passwordResets).where(and(eq(passwordResets.email, email), isNull(passwordResets.usedAt), gt(passwordResets.requestedAt, hourAgo))).limit(1);
      if (!recent) await db.insert(passwordResets).values({ id: crypto.randomUUID(), email, requestedAt: new Date().toISOString() });
    }
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر إرسال الطلب." }, { status: 500 }); }
}
