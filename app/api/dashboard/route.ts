import { currentUser } from "@/lib/auth";
import { workspaceData } from "@/lib/workspace-data";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    return Response.json(await workspaceData(user));
  } catch { return Response.json({ error: "تعذر تحميل البيانات." }, { status: 500 }); }
}
