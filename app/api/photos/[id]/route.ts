import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getTalent, UPLOAD_DIR } from "@/lib/db";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const talent = getTalent(id);
  if (!talent) return new Response("Not found", { status: 404 });
  try {
    const file = await readFile(join(UPLOAD_DIR, talent.photo_file));
    const ext = talent.photo_file.split(".").pop() ?? "jpg";
    return new Response(new Uint8Array(file), {
      headers: { "Content-Type": TYPES[ext] ?? "image/jpeg", "Cache-Control": "private, no-cache" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
