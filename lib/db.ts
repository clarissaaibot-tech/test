import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

// All data lives in Supabase. The tables have row level security with no policies,
// so every read and write goes through the tab_* database functions called here.

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
  is_sample: boolean;
  created_at: string;
  face_consent: boolean;
  face_consent_at: string | null;
};

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A face descriptor is exactly 128 finite numbers. Anything else is rejected. */
export function parseDescriptor(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 128) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return value as number[];
}

export async function createTalent(input: {
  name: string;
  headline: string;
  category: string;
  city: string;
  yearsExp: number | null;
  skills: string[];
  openTo: string[];
  bio: string;
  photoBase64: string;
  descriptor: number[] | null;
}): Promise<{ id: string; token: string }> {
  const token = randomBytes(24).toString("base64url");
  const id = await rpc<string>("tab_create_talent", {
    p_token_hash: hashToken(token),
    p_name: input.name,
    p_headline: input.headline,
    p_category: input.category,
    p_city: input.city,
    p_years_exp: input.yearsExp,
    p_skills: input.skills,
    p_open_to: input.openTo,
    p_bio: input.bio,
    p_photo: input.photoBase64,
    p_embedding: input.descriptor,
  });
  return { id, token };
}

/** Keyword matches name, headline, skills or bio; industry and city narrow the list. */
export async function listTalents(
  filter: { q?: string; industry?: string; city?: string } = {}
): Promise<Talent[]> {
  // Escape LIKE wildcards so a search for "100%" means the literal text.
  const esc = (v = "") => v.replace(/[\\%_]/g, "\\$&");
  return rpc<Talent[]>("tab_list_talents", {
    p_q: esc(filter.q),
    p_industry: filter.industry ?? "",
    p_city: esc(filter.city),
  });
}

export async function getTalent(id: string): Promise<Talent | null> {
  if (!UUID.test(id)) return null;
  return rpc<Talent | null>("tab_get_talent", { p_id: id });
}

export async function getPhoto(id: string): Promise<Buffer | null> {
  if (!UUID.test(id)) return null;
  const base64 = await rpc<string | null>("tab_get_photo", { p_id: id });
  return base64 ? Buffer.from(base64, "base64") : null;
}

export async function getTalentByToken(token: string): Promise<Talent | null> {
  return rpc<Talent | null>("tab_get_by_token", { p_token_hash: hashToken(token) });
}

/** Passing null withdraws consent, which deletes the stored face descriptor. */
export async function setFaceConsent(token: string, descriptor: number[] | null): Promise<boolean> {
  return rpc<boolean>("tab_set_face_consent", {
    p_token_hash: hashToken(token),
    p_embedding: descriptor,
  });
}

export async function deleteTalent(token: string): Promise<boolean> {
  return rpc<boolean>("tab_delete_talent", { p_token_hash: hashToken(token) });
}

export type Match = { talent: Talent; score: number };

/**
 * Ranks only talents who opted in to face search. The score maps descriptor distance
 * to 0-100: two photos of the same person usually sit under 0.5 (score 64+),
 * unrelated faces around 0.8-1.0.
 */
export async function findLookalikes(query: number[], limit = 12): Promise<Match[]> {
  const rows = await rpc<(Talent & { distance: number })[]>("tab_find_lookalikes", {
    p_embedding: query,
    p_limit: limit,
  });
  return rows.map(({ distance, ...talent }) => ({
    talent,
    score: Math.round(Math.max(0, 1 - distance / 1.4) * 100),
  }));
}

export type Inquiry = {
  id: string;
  from_name: string;
  from_email: string;
  message: string;
  created_at: string;
};

export async function addInquiry(talentId: string, fromName: string, fromEmail: string, message: string) {
  await rpc<boolean>("tab_add_inquiry", {
    p_talent_id: talentId,
    p_from_name: fromName,
    p_from_email: fromEmail,
    p_message: message,
  });
}

export async function listInquiries(token: string): Promise<Inquiry[]> {
  return rpc<Inquiry[]>("tab_list_inquiries", { p_token_hash: hashToken(token) });
}
