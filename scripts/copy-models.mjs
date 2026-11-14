// Copies the face-api model weights we use into public/models so the browser can load them.
import { cpSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "@vladmandic", "face-api", "model");
const dest = join("public", "models");
if (existsSync(src)) {
  mkdirSync(dest, { recursive: true });
  const wanted = ["ssd_mobilenetv1", "face_landmark_68_model", "face_recognition_model"];
  for (const f of readdirSync(src)) {
    if (wanted.some((w) => f.startsWith(w))) cpSync(join(src, f), join(dest, f));
  }
}
