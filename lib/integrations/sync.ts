import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrations } from "@/db/schema";
import { setting } from "@/lib/env";
import { importRows } from "@/lib/import-rows";
import { decryptJson, encryptJson } from "@/lib/secrets";
import { providers, ProviderError, type Creds, type OAuthClient, type ProviderId } from "./providers";

type Integration = typeof integrations.$inferSelect;

const DAY = 86_400_000;
const FIRST_SYNC_DAYS = 90;
// Re-read a few days before the last sync to catch late settlements and edits; the import
// fingerprint makes repeated rows harmless.
const OVERLAP_DAYS = 7;
export const STALE_HOURS = 6;

const day = (t: number) => new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);

export function oauthClient(provider: ProviderId, origin: string): OAuthClient | null {
  const prefix = provider.toUpperCase() as "SALLA" | "ZID" | "FOODICS";
  const clientId = setting(`${prefix}_CLIENT_ID`);
  const clientSecret = setting(`${prefix}_CLIENT_SECRET`);
  return clientId && clientSecret ? { clientId, clientSecret, redirectUri: `${origin}/api/integrations/oauth/callback` } : null;
}

export const sourceName = (provider: ProviderId, label: string) => `${providers[provider].name} · ${label}`;

export async function syncIntegration(row: Integration, origin: string) {
  const provider = providers[row.provider as ProviderId];
  const db = getDb();
  const now = Date.now();
  const since = row.syncedThrough ? day(Date.parse(`${row.syncedThrough}T00:00:00Z`) - OVERLAP_DAYS * DAY) : day(now - FIRST_SYNC_DAYS * DAY);
  const until = day(now);
  try {
    let creds = await decryptJson<Creds>(row.credentials);
    // Refresh OAuth tokens a day before they expire.
    const client = provider.oauth?.refresh ? oauthClient(provider.id, origin) : null;
    if (client && provider.oauth?.refresh && typeof creds.expires_at === "number" && creds.expires_at && creds.expires_at - now < DAY) {
      creds = { ...creds, ...(await provider.oauth.refresh(creds, client)) };
      await db.update(integrations).set({ credentials: await encryptJson(creds) }).where(eq(integrations.id, row.id));
    }
    const { batches } = await provider.pull(creds, since, until);
    let imported = 0;
    for (const batch of batches) {
      if (!batch.rows.length) continue;
      const result = await importRows(row.workspaceId, sourceName(provider.id, batch.label), batch.kind, batch.rows, { system: provider.id, origin: "api" });
      imported += result.imported;
    }
    await db.update(integrations).set({ status: "connected", lastError: null, lastSyncAt: new Date(now).toISOString(), syncedThrough: until }).where(eq(integrations.id, row.id));
    return { ok: true as const, imported };
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : "تعذرت المزامنة. سنحاول لاحقًا.";
    await db.update(integrations).set({ status: "error", lastError: message, lastSyncAt: new Date(now).toISOString() }).where(eq(integrations.id, row.id));
    return { ok: false as const, error: message };
  }
}

export async function syncWorkspace(workspaceId: string, origin: string, options: { provider?: string; staleOnly?: boolean } = {}) {
  const db = getDb();
  const rows = await db.select().from(integrations).where(options.provider ? and(eq(integrations.workspaceId, workspaceId), eq(integrations.provider, options.provider)) : eq(integrations.workspaceId, workspaceId));
  const due = options.staleOnly ? rows.filter((r) => !r.lastSyncAt || Date.now() - Date.parse(r.lastSyncAt) > STALE_HOURS * 3_600_000) : rows;
  let imported = 0;
  const errors: string[] = [];
  for (const row of due) {
    const result = await syncIntegration(row, origin);
    if (result.ok) imported += result.imported;
    else errors.push(`${providers[row.provider as ProviderId]?.name}: ${result.error}`);
  }
  return { synced: due.length, imported, errors };
}

// The public origin, honouring the proxy in front of the app.
export function originOf(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
