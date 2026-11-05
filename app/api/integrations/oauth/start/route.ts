import { currentUser } from "@/lib/auth";
import { providers, type ProviderId } from "@/lib/integrations/providers";
import { oauthClient, originOf } from "@/lib/integrations/sync";
import { sign } from "@/lib/secrets";

const back = (origin: string, query: string) => Response.redirect(`${origin}/app/connections?${query}`, 302);

// Send the signed-in user to the provider to approve access; the signed state ties the
// callback to this workspace.
export async function GET(request: Request) {
  const origin = originOf(request);
  try {
    const user = await currentUser(request);
    if (!user) return Response.redirect(`${origin}/login`, 302);
    const provider = providers[new URL(request.url).searchParams.get("provider") as ProviderId];
    const client = provider?.oauth ? oauthClient(provider.id, origin) : null;
    if (!provider?.oauth || !client) return back(origin, "error=not-configured");
    const state = await sign({ w: user.workspace.id, p: provider.id });
    return Response.redirect(provider.oauth.authorizeUrl(client, state), 302);
  } catch { return back(origin, "error=oauth"); }
}
