import type { Env, Seed, TasteProfile } from "../types.ts";

const memoryStore = new Map<string, TasteProfile>();
const MAX_SEEDS = 6;

/** Profile ids come from the browser; only short opaque ids are accepted, so one key cannot read another. */
export function validProfileId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);
}

// Strips emails and phone numbers before anything is stored.
export function sanitizeText(text: string): string {
  return text
    .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, "[redacted-email]")
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[redacted-phone]")
    .slice(0, 200);
}

export function emptyProfile(id: string): TasteProfile {
  return { id, seeds: [], updatedAt: new Date().toISOString() };
}

export async function getProfile(id: string, env: Env): Promise<TasteProfile> {
  if (env.TASTE_DB) {
    const row = await env.TASTE_DB.prepare("SELECT data FROM profiles WHERE id = ?").bind(id).first<{ data: string }>();
    return row ? (JSON.parse(row.data) as TasteProfile) : emptyProfile(id);
  }
  return memoryStore.get(id) ?? emptyProfile(id);
}

export async function saveProfile(profile: TasteProfile, env: Env): Promise<TasteProfile> {
  const clean: TasteProfile = {
    ...profile,
    seeds: mergeSeeds([], profile.seeds),
    city: profile.city ? sanitizeText(profile.city) : undefined,
    country: profile.country ? sanitizeText(profile.country) : undefined,
    updatedAt: new Date().toISOString(),
  };
  if (env.TASTE_DB) {
    await env.TASTE_DB.prepare("INSERT INTO profiles (id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?2, updated_at = ?3")
      .bind(clean.id, JSON.stringify(clean), clean.updatedAt)
      .run();
  } else {
    memoryStore.set(clean.id, clean);
  }
  return clean;
}

/** Newest seeds first, no duplicates by name, capped so the taste signal stays focused. */
export function mergeSeeds(old: Seed[], fresh: Seed[]): Seed[] {
  const out: Seed[] = [];
  for (const s of [...fresh, ...old]) {
    const name = sanitizeText(s.name).trim();
    if (!name || out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue;
    out.push({ name, kind: s.kind });
  }
  return out.slice(0, MAX_SEEDS);
}

export async function deleteProfile(id: string, env: Env): Promise<void> {
  memoryStore.delete(id);
  if (env.TASTE_DB) await env.TASTE_DB.prepare("DELETE FROM profiles WHERE id = ?").bind(id).run();
}
