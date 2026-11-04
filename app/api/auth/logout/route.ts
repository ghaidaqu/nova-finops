import { endSession, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try { await endSession(request); } catch {}
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", request, 0) } });
}
