import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrations } from "@/db/schema";
import { currentUser, readJson, str } from "@/lib/auth";
import { providerList, providers, ProviderError, type ProviderId } from "@/lib/integrations/providers";
import { oauthClient, originOf, syncIntegration } from "@/lib/integrations/sync";
import { setting } from "@/lib/env";
import { encryptJson } from "@/lib/secrets";
import { fileSourcesOf, pathConflict } from "@/lib/source-paths";
import { connections, transactions } from "@/db/schema";

const noStore = { "Cache-Control": "no-store" };

// Providers with this workspace's connection state. Credentials never leave the server.
export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const rows = await getDb().select().from(integrations).where(eq(integrations.workspaceId, user.workspace.id));
    const files = await Promise.all(providerList.map((p) => fileSourcesOf(user.workspace.id, p.id)));
    const origin = originOf(request);
    const encryption = Boolean(setting("NOVA_SECRET_KEY"));
    return Response.json({
      encryption,
      providers: providerList.map((p, i) => {
        const row = rows.find((r) => r.provider === p.id);
        return {
          id: p.id, name: p.name, category: p.category, auth: p.auth, keyLabel: p.keyLabel, keyHelp: p.keyHelp, maturity: p.maturity,
          available: encryption && (p.auth === "key" || Boolean(oauthClient(p.id, origin))),
          connection: row ? { status: row.status, lastSyncAt: row.lastSyncAt, lastError: row.lastError } : null,
          fileSources: files[i],
        };
      }),
    }, { headers: noStore });
  } catch { return Response.json({ error: "تعذر تحميل الربط." }, { status: 500 }); }
}

// Connect a key-based provider: check the key, store it encrypted, then pull the last 90 days.
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await readJson(request, 10_000);
    if (body instanceof Response) return body;
    const provider = providers[str(body.provider, 20) as ProviderId];
    const key = str(body.key, 500);
    if (!provider || provider.auth !== "key") return Response.json({ error: "مزود غير معروف." }, { status: 400 });
    if (!key) return Response.json({ error: "أدخل المفتاح." }, { status: 400 });
    if (!setting("NOVA_SECRET_KEY")) return Response.json({ error: "الربط غير مفعّل على الخادم بعد (مفتاح التشفير غير مضبوط)." }, { status: 503 });
    const conflict = await pathConflict(user.workspace.id, provider.id, "api");
    if (conflict) return Response.json({ error: conflict }, { status: 409 });
    const today = new Date().toISOString().slice(0, 10);
    try {
      await provider.pull({ key }, today, today);
    } catch (e) {
      return Response.json({ error: e instanceof ProviderError ? e.message : "تعذر التحقق من المفتاح." }, { status: 400 });
    }
    const db = getDb();
    const credentials = await encryptJson({ key });
    await db.insert(integrations).values({ id: crypto.randomUUID(), workspaceId: user.workspace.id, provider: provider.id, source: provider.name, credentials })
      .onConflictDoUpdate({ target: [integrations.workspaceId, integrations.provider], set: { credentials, status: "connected", lastError: null } });
    const [row] = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspace.id), eq(integrations.provider, provider.id))).limit(1);
    const result = await syncIntegration(row, originOf(request));
    return Response.json(result.ok ? { ok: true, imported: result.imported } : { ok: true, imported: 0, warning: result.error });
  } catch { return Response.json({ error: "تعذر الربط الآن." }, { status: 500 }); }
}

// Disconnect: forget the credentials and remove the data pulled through the API, so the
// system can be fed by files instead without counting anything twice.
export async function DELETE(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const provider = new URL(request.url).searchParams.get("provider") || "";
    const db = getDb();
    const id = user.workspace.id;
    const synced = (await db.select({ source: connections.source }).from(connections).where(and(eq(connections.workspaceId, id), eq(connections.system, provider), eq(connections.origin, "api")))).map((r) => r.source);
    await db.batch([
      db.delete(integrations).where(and(eq(integrations.workspaceId, id), eq(integrations.provider, provider))),
      ...synced.map((source) => db.delete(transactions).where(and(eq(transactions.workspaceId, id), eq(transactions.source, source)))),
      db.delete(connections).where(and(eq(connections.workspaceId, id), eq(connections.system, provider), eq(connections.origin, "api"))),
    ]);
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "تعذر فصل الربط." }, { status: 500 }); }
}
