import { currentUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    return Response.json({ user }, { status: user ? 200 : 401, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "تعذر التحقق من الجلسة." }, { status: 500 }); }
}
