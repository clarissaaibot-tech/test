import { NextResponse } from "next/server";
import { createTalent, parseDescriptor } from "@/lib/db";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function POST(req: Request) {
  const form = await req.formData();
  const text = (key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

  const name = text("name", 80);
  const category = text("category", 40);
  const city = text("city", 60);
  const bio = text("bio", 600);
  if (!name || !category || !city) return bad("Name, category and city are required.");

  if (form.get("confirmAdultOwnPhoto") !== "yes") {
    return bad("You must confirm you are 18 or older and that the photo is of you.");
  }

  const heightRaw = text("heightCm", 5);
  const heightCm = heightRaw ? Number(heightRaw) : null;
  if (heightCm !== null && !(Number.isInteger(heightCm) && heightCm >= 100 && heightCm <= 230)) {
    return bad("Height must be between 100 and 230 cm.");
  }

  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return bad("A photo is required.");
  const photoExt = EXT[photo.type];
  if (!photoExt) return bad("Photo must be a JPG, PNG or WebP.");
  if (photo.size > MAX_PHOTO_BYTES) return bad("Photo must be 5 MB or smaller.");

  // The face descriptor is stored only when the talent ticked the separate face-search consent.
  let descriptor: number[] | null = null;
  if (form.get("faceConsent") === "yes") {
    try {
      descriptor = parseDescriptor(JSON.parse(String(form.get("descriptor") ?? "null")));
    } catch {
      descriptor = null;
    }
    if (!descriptor) return bad("Face search was selected but no valid face data was sent.");
  }

  const { id, token } = createTalent({
    name,
    category,
    city,
    heightCm,
    bio,
    photo: Buffer.from(await photo.arrayBuffer()),
    photoExt,
    descriptor,
  });
  return NextResponse.json({ id, token });
}
