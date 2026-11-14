import { NextResponse } from "next/server";
import { addInquiry, getTalent } from "@/lib/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getTalent(id)) return NextResponse.json({ error: "Talent not found." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const fromName = String(body?.fromName ?? "").trim().slice(0, 80);
  const fromEmail = String(body?.fromEmail ?? "").trim().slice(0, 120);
  const message = String(body?.message ?? "").trim().slice(0, 1500);
  if (!fromName || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    return NextResponse.json(
      { error: "Your name, a valid email and a message are required." },
      { status: 400 }
    );
  }
  addInquiry(id, fromName, fromEmail, message);
  return NextResponse.json({ ok: true });
}
