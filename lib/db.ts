import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = join(process.cwd(), "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");

export type Talent = {
  id: string;
  name: string;
  category: string;
  city: string;
  height_cm: number | null;
  bio: string;
  photo_file: string;
  created_at: string;
  face_consent: number;
  face_consent_at: string | null;
};

type TalentRow = Talent & { embedding: string | null };

const PUBLIC_COLS =
  "id, name, category, city, height_cm, bio, photo_file, created_at, face_consent, face_consent_at";

const g = globalThis as unknown as { __talentDb?: DatabaseSync };

function db(): DatabaseSync {
  if (!g.__talentDb) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const d = new DatabaseSync(join(DATA_DIR, "app.db"));
    d.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS talents (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        city TEXT NOT NULL,
        height_cm INTEGER,
        bio TEXT NOT NULL DEFAULT '',
        photo_file TEXT NOT NULL,
        created_at TEXT NOT NULL,
        face_consent INTEGER NOT NULL DEFAULT 0,
        face_consent_at TEXT,
        embedding TEXT
      );
      CREATE TABLE IF NOT EXISTS inquiries (
        id TEXT PRIMARY KEY,
        talent_id TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      PRAGMA foreign_keys = ON;
    `);
    g.__talentDb = d;
  }
  return g.__talentDb;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A face descriptor is exactly 128 finite numbers. Anything else is rejected. */
export function parseDescriptor(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 128) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return value as number[];
}

export function createTalent(input: {
  name: string;
  category: string;
  city: string;
  heightCm: number | null;
  bio: string;
  photo: Buffer;
  photoExt: string;
  descriptor: number[] | null;
}): { id: string; token: string } {
  const id = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const photoFile = `${id}.${input.photoExt}`;
  const now = new Date().toISOString();
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(join(UPLOAD_DIR, photoFile), input.photo);
  db()
    .prepare(
      `INSERT INTO talents (id, token_hash, name, category, city, height_cm, bio, photo_file, created_at, face_consent, face_consent_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      hashToken(token),
      input.name,
      input.category,
      input.city,
      input.heightCm,
      input.bio,
      photoFile,
      now,
      input.descriptor ? 1 : 0,
      input.descriptor ? now : null,
      input.descriptor ? JSON.stringify(input.descriptor) : null
    );
  return { id, token };
}

export function listTalents(): Talent[] {
  return db()
    .prepare(`SELECT ${PUBLIC_COLS} FROM talents ORDER BY created_at DESC`)
    .all() as unknown as Talent[];
}

export function getTalent(id: string): Talent | null {
  return (
    (db().prepare(`SELECT ${PUBLIC_COLS} FROM talents WHERE id = ?`).get(id) as unknown as Talent) ??
    null
  );
}

export function getTalentByToken(token: string): Talent | null {
  return (
    (db()
      .prepare(`SELECT ${PUBLIC_COLS} FROM talents WHERE token_hash = ?`)
      .get(hashToken(token)) as unknown as Talent) ?? null
  );
}

/** Turning consent off deletes the stored face descriptor, not just a flag. */
export function setFaceConsent(id: string, descriptor: number[] | null) {
  db()
    .prepare(
      `UPDATE talents SET face_consent = ?, face_consent_at = ?, embedding = ? WHERE id = ?`
    )
    .run(
      descriptor ? 1 : 0,
      descriptor ? new Date().toISOString() : null,
      descriptor ? JSON.stringify(descriptor) : null,
      id
    );
}

export function deleteTalent(talent: Talent) {
  const d = db();
  d.prepare(`DELETE FROM inquiries WHERE talent_id = ?`).run(talent.id);
  d.prepare(`DELETE FROM talents WHERE id = ?`).run(talent.id);
  rmSync(join(UPLOAD_DIR, talent.photo_file), { force: true });
}

export type Match = { talent: Talent; distance: number; score: number };

/**
 * Maps descriptor distance to a 0-100 display score. Two photos of the same person
 * usually sit under 0.5 (score 64+); unrelated faces sit around 0.8-1.0.
 */
function similarityScore(distance: number): number {
  return Math.round(Math.max(0, 1 - distance / 1.4) * 100);
}

/** Ranks only talents who opted in to face search, by Euclidean distance between descriptors. */
export function findLookalikes(query: number[], limit = 12): Match[] {
  const rows = db()
    .prepare(
      `SELECT ${PUBLIC_COLS}, embedding FROM talents WHERE face_consent = 1 AND embedding IS NOT NULL`
    )
    .all() as unknown as TalentRow[];
  return rows
    .map(({ embedding, ...talent }) => {
      const e = JSON.parse(embedding as string) as number[];
      let sum = 0;
      for (let i = 0; i < 128; i++) sum += (e[i] - query[i]) ** 2;
      const distance = Math.sqrt(sum);
      return { talent, distance, score: similarityScore(distance) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export type Inquiry = {
  id: string;
  from_name: string;
  from_email: string;
  message: string;
  created_at: string;
};

export function addInquiry(talentId: string, fromName: string, fromEmail: string, message: string) {
  db()
    .prepare(
      `INSERT INTO inquiries (id, talent_id, from_name, from_email, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), talentId, fromName, fromEmail, message, new Date().toISOString());
}

export function listInquiries(talentId: string): Inquiry[] {
  return db()
    .prepare(
      `SELECT id, from_name, from_email, message, created_at FROM inquiries WHERE talent_id = ? ORDER BY created_at DESC`
    )
    .all(talentId) as unknown as Inquiry[];
}
