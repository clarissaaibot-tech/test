import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = join(process.cwd(), "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");

export type Talent = {
  id: string;
  name: string;
  headline: string;
  category: string;
  city: string;
  years_exp: number | null;
  skills: string[];
  open_to: string[];
  bio: string;
  photo_file: string;
  created_at: string;
  face_consent: number;
  face_consent_at: string | null;
};

const PUBLIC_COLS =
  "id, name, headline, category, city, years_exp, skills, open_to, bio, photo_file, created_at, face_consent, face_consent_at";

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
        headline TEXT NOT NULL,
        category TEXT NOT NULL,
        city TEXT NOT NULL,
        years_exp INTEGER,
        skills TEXT NOT NULL DEFAULT '[]',
        open_to TEXT NOT NULL DEFAULT '[]',
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

type RawTalent = Omit<Talent, "skills" | "open_to"> & { skills: string; open_to: string };

/** Skills and open-to lists are stored as JSON text. */
function hydrate<T extends RawTalent>(row: T | undefined): (Omit<T, "skills" | "open_to"> & Pick<Talent, "skills" | "open_to">) | null {
  if (!row) return null;
  return { ...row, skills: JSON.parse(row.skills), open_to: JSON.parse(row.open_to) };
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
  headline: string;
  category: string;
  city: string;
  yearsExp: number | null;
  skills: string[];
  openTo: string[];
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
      `INSERT INTO talents (id, token_hash, name, headline, category, city, years_exp, skills, open_to, bio, photo_file, created_at, face_consent, face_consent_at, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      hashToken(token),
      input.name,
      input.headline,
      input.category,
      input.city,
      input.yearsExp,
      JSON.stringify(input.skills),
      JSON.stringify(input.openTo),
      input.bio,
      photoFile,
      now,
      input.descriptor ? 1 : 0,
      input.descriptor ? now : null,
      input.descriptor ? JSON.stringify(input.descriptor) : null
    );
  return { id, token };
}

/** Keyword matches name, headline, skills or bio; industry and city narrow the list. */
export function listTalents(filter: { q?: string; industry?: string; city?: string } = {}): Talent[] {
  const where: string[] = [];
  const args: string[] = [];
  const like = (v: string) => `%${v.replace(/[\\%_]/g, "\\$&")}%`;
  if (filter.q) {
    where.push(
      `(name LIKE ? ESCAPE '\\' OR headline LIKE ? ESCAPE '\\' OR skills LIKE ? ESCAPE '\\' OR bio LIKE ? ESCAPE '\\')`
    );
    args.push(like(filter.q), like(filter.q), like(filter.q), like(filter.q));
  }
  if (filter.industry) {
    where.push(`category = ?`);
    args.push(filter.industry);
  }
  if (filter.city) {
    where.push(`city LIKE ? ESCAPE '\\'`);
    args.push(like(filter.city));
  }
  const rows = db()
    .prepare(
      `SELECT ${PUBLIC_COLS} FROM talents ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`
    )
    .all(...args) as unknown as RawTalent[];
  return rows.map((r) => hydrate(r) as Talent);
}

export function getTalent(id: string): Talent | null {
  return hydrate(
    db().prepare(`SELECT ${PUBLIC_COLS} FROM talents WHERE id = ?`).get(id) as unknown as RawTalent
  );
}

export function getTalentByToken(token: string): Talent | null {
  return hydrate(
    db()
      .prepare(`SELECT ${PUBLIC_COLS} FROM talents WHERE token_hash = ?`)
      .get(hashToken(token)) as unknown as RawTalent
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
    .all() as unknown as (RawTalent & { embedding: string })[];
  return rows
    .map(({ embedding, ...raw }) => {
      const talent = hydrate(raw) as Talent;
      const e = JSON.parse(embedding) as number[];
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
