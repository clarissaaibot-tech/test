import { NextResponse } from "next/server";
import { deleteTalent, parseDescriptor, setFaceConsent } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);

  let found: boolean;
  switch (body?.action) {
    case "withdrawFaceConsent":
      found = await setFaceConsent(token, null);
      break;
    case "giveFaceConsent": {
      const descriptor = parseDescriptor(body.descriptor);
      if (!descriptor) return NextResponse.json({ error: "Invalid face data." }, { status: 400 });
      found = await setFaceConsent(token, descriptor);
      break;
    }
    case "deleteProfile":
      found = await deleteTalent(token);
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  if (!found) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
