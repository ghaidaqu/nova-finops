import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, integrations } from "@/db/schema";
import { providers, type ProviderId } from "@/lib/integrations/providers";

// Each outside system reaches a workspace through one path only, file uploads or the API
// connection, so the same payments are never counted twice. To switch, remove the other path.
export const isSystem = (value: unknown): value is ProviderId => typeof value === "string" && value in providers;

export async function fileSourcesOf(workspaceId: string, system: ProviderId) {
  const rows = await getDb().select({ source: connections.source }).from(connections)
    .where(and(eq(connections.workspaceId, workspaceId), eq(connections.system, system), eq(connections.origin, "file")));
  return rows.map((r) => r.source);
}

export async function pathConflict(workspaceId: string, system: ProviderId, wanted: "file" | "api"): Promise<string | null> {
  const name = providers[system].name;
  if (wanted === "api") {
    const files = await fileSourcesOf(workspaceId, system);
    return files.length
      ? `عندك ملفات من ${name} في: ${files.map((f) => `«${f}»`).join("، ")}. لا يمكن استخدام الملفات والربط التلقائي لنفس النظام حتى لا تتضاعف الأرقام. احذف هذه المصادر أولًا ثم اربط.`
      : null;
  }
  const db = getDb();
  const [linked] = await db.select({ id: integrations.id }).from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, system))).limit(1);
  const [synced] = await db.select({ id: connections.id }).from(connections).where(and(eq(connections.workspaceId, workspaceId), eq(connections.system, system), eq(connections.origin, "api"))).limit(1);
  return linked || synced
    ? `${name} مربوط تلقائيًا. لا يمكن استخدام الملفات والربط التلقائي لنفس النظام حتى لا تتضاعف الأرقام. افصل الربط أولًا من صفحة المصادر إذا أردت رفع ملفات بدلًا منه.`
    : null;
}
