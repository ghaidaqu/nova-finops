import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { integrations } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { providers, type ProviderId } from "@/lib/integrations/providers";
import { oauthClient, originOf, syncIntegration } from "@/lib/integrations/sync";
import { encryptJson, verify } from "@/lib/secrets";
import { pathConflict } from "@/lib/source-paths";

const back = (origin: string, query: string) => Response.redirect(`${origin}/app/connections?${query}`, 302);

export async function GET(request: Request) {
  const origin = originOf(request);
  try {
    const params = new URL(request.url).searchParams;
    const state = await verify<{ w: string; p: ProviderId }>(params.get("state") || "");
    const user = await currentUser(request);
    // The approval must come back to the same signed-in workspace that started it.
    if (!state || !user || user.workspace.id !== state.w) return back(origin, "error=state");
    const provider = providers[state.p];
    const client = provider?.oauth ? oauthClient(provider.id, origin) : null;
    const code = params.get("code");
    if (!provider?.oauth || !client || !code) return back(origin, "error=oauth");
    if (await pathConflict(user.workspace.id, provider.id, "api")) return back(origin, `error=files&provider=${provider.id}`);
    const creds = await provider.oauth.exchange(code, client);
    const db = getDb();
    const credentials = await encryptJson(creds);
    await db.insert(integrations).values({ id: crypto.randomUUID(), workspaceId: user.workspace.id, provider: provider.id, source: provider.name, credentials })
      .onConflictDoUpdate({ target: [integrations.workspaceId, integrations.provider], set: { credentials, status: "connected", lastError: null } });
    const [row] = await db.select().from(integrations).where(and(eq(integrations.workspaceId, user.workspace.id), eq(integrations.provider, provider.id))).limit(1);
    await syncIntegration(row, origin);
    return back(origin, `connected=${provider.id}`);
  } catch { return back(origin, "error=oauth"); }
}
