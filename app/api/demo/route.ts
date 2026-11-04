import { currentUser } from "@/lib/auth";
import { demoSources } from "@/lib/demo-data";
import { importRows } from "@/lib/import-rows";

// Load the sample business into the signed-in workspace, ending today.
export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    if (!user) return Response.json({ error: "غير مصرح" }, { status: 401 });
    let imported = 0;
    for (const source of demoSources(new Date().toISOString().slice(0, 10))) {
      const result = await importRows(user.workspace.id, source.name, source.kind, source.rows, source);
      imported += result.imported;
    }
    return Response.json({ imported });
  } catch { return Response.json({ error: "تعذر تحميل البيانات التجريبية." }, { status: 500 }); }
}
