import { NextResponse } from "next/server";
import { deleteTalent, getTalentByToken, parseDescriptor, setFaceConsent } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const talent = getTalentByToken(token);
  if (!talent) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  const body = await req.json().catch(() => null);
  switch (body?.action) {
    case "withdrawFaceConsent":
      setFaceConsent(talent.id, null);
      return NextResponse.json({ ok: true });
    case "giveFaceConsent": {
      const descriptor = parseDescriptor(body.descriptor);
      if (!descriptor) return NextResponse.json({ error: "Invalid face data." }, { status: 400 });
      setFaceConsent(talent.id, descriptor);
      return NextResponse.json({ ok: true });
    }
    case "deleteProfile":
      deleteTalent(talent);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
