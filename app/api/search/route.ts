import { NextResponse } from "next/server";
import { findLookalikes, parseDescriptor } from "@/lib/db";

// Receives only a face descriptor computed in the browser. Nothing from a search is stored.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const descriptor = parseDescriptor(body?.descriptor);
  if (!descriptor) return NextResponse.json({ error: "Invalid face data." }, { status: 400 });
  const matches = findLookalikes(descriptor).map(({ talent, score }) => ({
    id: talent.id,
    name: talent.name,
    category: talent.category,
    city: talent.city,
    score,
  }));
  return NextResponse.json({ matches });
}
