import type { LiveContext, Pick, ResolvedSeed } from "../types.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_YEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(20\d\d)\b/gi;
const DAY_MONTH_YEAR = /\b\d{1,2}(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/gi;
const YEAR = /\b(20\d\d)\b/g;

/**
 * True when the text dates itself before this month: a past month and year ("August 2026" seen in
 * October 2026), or only past years. Web results often describe last season's festival.
 */
export function datedBefore(text: string, now: Date): boolean {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const months = [...text.matchAll(MONTH_YEAR), ...text.matchAll(DAY_MONTH_YEAR)].map((m) => Number(m[2]) * 12 + MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)));
  if (months.length) return Math.max(...months) < current;
  const years = [...text.matchAll(YEAR)].map((m) => Number(m[1]));
  return years.length > 0 && Math.max(...years) < now.getUTCFullYear();
}

/** True when the text names a month and year from this month on, so a sentence about it can say when. */
export function datedNow(text: string, now: Date): boolean {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return [...text.matchAll(MONTH_YEAR), ...text.matchAll(DAY_MONTH_YEAR)].some((m) => Number(m[2]) * 12 + MONTHS.indexOf(m[1]!.toLowerCase().slice(0, 3)) >= current);
}

/** Keeps only the fresh results that do not date themselves in the past, so the writer cannot send someone to last month's event. */
export function freshItems(live: LiveContext | undefined, now: Date): LiveContext["items"] {
  return (live?.items ?? []).filter((i) => !datedBefore(`${i.title} ${i.snippet}`, now));
}

/** The honest note when Qloo has too few places of the kind asked for; code puts it first, not the model. */
export function thinNote(mainKind: number, venue: string, city: string): string {
  const count = mainKind === 0 ? "no places" : mainKind === 1 ? "only 1 place" : `only ${mainKind} places`;
  const verb = mainKind === 1 ? "is" : "are";
  return `Qloo has ${count} in ${city} that ${verb} mainly a ${venue} for this taste, so some picks below only sell or host it on the side.`;
}

/** The writer is told not to say "seed"; this catches the times it still does. */
export function plainWording(text: string): string {
  return text.replace(/\b(?:the|these|both|your)\s+seeds\b/gi, "your loves").replace(/\bseeds\b/gi, "loves").replace(/\bseed\b/gi, "love");
}

/** The honest note when the popularity cap left too few places and well-known ones fill the list. */
export function capNote(lesser: number, known: number, venue: string, city: string): string {
  const count = lesser === 0 ? "no lesser-known places" : lesser === 1 ? "only 1 lesser-known place" : `only ${lesser} lesser-known places`;
  return `Qloo has ${count} in ${city} that ${lesser === 1 ? "is" : "are"} mainly a ${venue} for this taste, so ${known === 1 ? "1 pick below is" : `${known} picks below are`} well known.`;
}

const SHARE_CLAIM = /\d+\s*%|\bshares?\b|\bdriver\b|\bdrives\b|\bdriven\b/i;

/** The page shows each love's share from Qloo; a model sentence about shares can only disagree with it. */
export function dropShareClaims(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [line];
      const kept = line.split(/(?<=[.!?])\s+/).filter((s) => !SHARE_CLAIM.test(s)).join(" ");
      return kept ? [kept] : [];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FILLER = new Set(["a", "an", "the", "it", "is", "has", "and", "that", "this", "with", "for", "to", "of", "its", "taste", "fits", "matches", "suits", "place", "spot", "style"]);
const reasonWords = (reason: string) => new Set(reason.split(/\s+/).filter((w) => w && !FILLER.has(w)));
const nearSame = (a: Set<string>, b: Set<string>) => {
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / (new Set([...a, ...b]).size || 1) >= 0.7;
};

/** True when the model gave most picks the same or nearly the same reason, which tells the person nothing. */
export function repeatsReasons(text: string, picks: Pick[]): boolean {
  const reasons = text.split("\n").flatMap((line) => {
    const pick = picks.find((p) => line.startsWith(`${p.name}:`));
    return pick ? [reasonWords(line.slice(pick.name.length + 1).toLowerCase().replace(/[^a-z ]/g, " "))] : [];
  });
  const echoed = reasons.filter((r, i) => reasons.some((o, j) => j !== i && nearSame(r, o))).length;
  return reasons.length >= 3 && echoed >= (reasons.length * 2) / 3;
}

/** Below this share on every pick, a love did not shape the list. */
export const WEAK_SHARE = 0.1;

/** The loves Qloo gave almost no pull on any pick, when at least one other love did shape the list. */
export function weakLoves(picks: Pick[], seeds: ResolvedSeed[]): ResolvedSeed[] {
  const explained = picks.filter((p) => p.drivenBy.length);
  if (seeds.length < 2 || explained.length === 0) return [];
  const share = (p: Pick, s: ResolvedSeed) => p.drivenBy.find((d) => d.entityId === s.entityId)?.share ?? 0;
  const weak = seeds.filter((s) => explained.every((p) => share(p, s) < WEAK_SHARE));
  return weak.length < seeds.length ? weak : [];
}

/** Says which loves the picks follow when Qloo has too little taste data on the others. */
export function weakNote(weak: ResolvedSeed[], seeds: ResolvedSeed[]): string {
  if (weak.length === 0) return "";
  const names = (list: ResolvedSeed[]) => list.map((s) => s.name ?? s.input).join(" and ");
  const strong = seeds.filter((s) => !weak.includes(s));
  return `Qloo has little taste data on ${names(weak)}, so these picks follow ${names(strong)}. Name a film, album or book of theirs for a better mix.`;
}

const EVENT_WORDS: Partial<Record<ResolvedSeed["kind"], RegExp>> = {
  movie: /\b(film|cinema|screening|movie)s?\b/i,
  tv_show: /\b(film|cinema|screening|series)s?\b/i,
  book: /\b(book|literary|reading|author)s?\b/i,
  author: /\b(book|literary|reading|author)s?\b/i,
};

/** Titles of pages that list every event in a country or city, which say nothing about this taste. */
const LISTING_TITLE = /\b(popular events|things to do|events in|what'?s on|top \d+|best events|event calendar|concerts in|ultimate guide|guide to|activities)\b/i;

/**
 * Keeps web results that name the city and a love, one of its Qloo genre tags, or (for films and books)
 * the kind of event. Music events must name the artist or a genre, because "a concert" can be any music at all.
 * Short tags ("Love") and the city itself (Amélie carries a "Paris" tag) would match almost anything.
 * Pages that list every event in a place ("Popular Events in Portugal") are dropped too.
 */
export function fitsLoves(item: { title: string; snippet: string }, seeds: ResolvedSeed[], city: string): boolean {
  const text = `${item.title} ${item.snippet}`.toLowerCase();
  const place = city.toLowerCase();
  if (!text.includes(place) || LISTING_TITLE.test(item.title)) return false;
  return seeds.some((s) => {
    const words = [s.name ?? s.input, ...s.tags].map((w) => w.toLowerCase()).filter((w) => w.length >= 5 && !place.includes(w));
    return words.some((w) => text.includes(w)) || Boolean(EVENT_WORDS[s.kind]?.test(text));
  });
}
