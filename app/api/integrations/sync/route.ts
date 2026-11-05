import { currentUser, readJson, str } from "@/lib/auth";
import { originOf, syncWorkspace } from "@/lib/integrations/sync";

// Pull new data now. `stale: true` only syncs connections not refreshed in the last few hours
// (the app calls this when a user opens it).
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    const body = await readJson(request, 2_000);
    if (body instanceof Response) return body;
    const result = await syncWorkspace(user.workspace.id, originOf(request), { provider: str(body.provider, 20) || undefined, staleOnly: body.stale === true });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "تعذرت المزامنة." }, { status: 500 }); }
}
