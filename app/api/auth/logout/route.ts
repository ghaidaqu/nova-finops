import { endSession, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  await endSession(request);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", request, 0) } });
}
