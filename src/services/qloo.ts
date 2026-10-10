import type { Pick, ResolvedSeed, Seed, SeedKind, Venue } from "../types.ts";

export const QLOO_DEFAULT_BASE_URL = "https://hackathon.api.qloo.com";

/** Qloo search types tried for each seed kind, most specific first. */
const SEED_TYPES: Record<SeedKind, string[]> = {
  // The router sometimes calls a director a movie; a person search before the untyped one stops a
  // namesake music artist from taking the place of the director.
  movie: ["urn:entity:movie", "urn:entity:person"],
  tv_show: ["urn:entity:tv_show", "urn:entity:person"],
  artist: ["urn:entity:artist"],
  person: ["urn:entity:person", "urn:entity:artist"],
  book: ["urn:entity:book"],
  author: ["urn:entity:author", "urn:entity:person"],
  brand: ["urn:entity:brand"],
  place: ["urn:entity:place", "urn:entity:destination"],
  podcast: ["urn:entity:podcast"],
  video_game: ["urn:entity:videogame"],
};

/** Qloo place category tag for each venue the concierge can recommend. */
export const VENUE_TAGS: Record<Venue, string> = {
  restaurant: "urn:tag:category:place:restaurant",
  bar: "urn:tag:category:place:bar",
  cafe: "urn:tag:category:place:cafe",
  hotel: "urn:tag:category:place:hotel",
  bookstore: "urn:tag:category:place:book_store",
  record_store: "urn:tag:category:place:record_store",
  museum: "urn:tag:category:place:museum",
  gallery: "urn:tag:category:place:art_gallery",
  music_venue: "urn:tag:category:place:live_music_venue",
};

/**
 * Words that mark a place's main Qloo category as the venue asked for. Qloo tags a place with
 * every category it has (a coworking space with a kitchen is also a restaurant), and the first
 * category tag is its main one, so picks whose main category fits rank first.
 */
const MAIN_KIND: Record<Venue, RegExp> = {
  restaurant: /restaurant|bistro|brasserie|tavern|eatery|diner|steak|pizz|sushi|grill|taberna|tasca/,
  bar: /bar|pub|lounge|tavern|brewery|wine|cocktail/,
  cafe: /cafe|coffee|tea|bakery|patisserie/,
  hotel: /hotel|hostel|inn|resort|guest|lodg/,
  bookstore: /book/,
  record_store: /record|vinyl|music store/,
  museum: /museum/,
  gallery: /gallery|art/,
  music_venue: /music|concert|jazz|club/,
};

// Seed tags that say nothing about taste (demographics, generic types) are hidden from people.
const NOISE_TAG = /^(place|restaurant|food|\d+\s+\d+|dine in|seating|takeout|delivery)$/i;

/**
 * Place tag types that describe a place's character, in display order. Qloo also tags payments,
 * parking, reservations and opening services; those say nothing about taste, so cards and the
 * writer never see them.
 */
const TASTE_TAG_TYPES = [
  "urn:tag:ambience:qloo",
  "urn:tag:decor:qloo",
  "urn:tag:culinary_style:qloo",
  "urn:tag:setting:qloo",
  "urn:tag:menu_highlight:qloo",
  "urn:tag:cuisine:qloo",
  "urn:tag:view:qloo",
];

/** Tag types Qloo can predict from a person's loves; these become the "taste words" matched to each place. */
const VIBE_TAG_TYPES = ["urn:tag:ambience:qloo", "urn:tag:decor:qloo"];

/** A pick list counts as fitting when at least this many places are mainly the venue asked for. */
export const ENOUGH_MAIN_KIND = 3;

export const RETRY_AFTER_MS = 1500;

export class QlooError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface QlooClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface InsightsResult {
  picks: Pick[];
  /** How many places in the Qloo pool are mainly the venue asked for and inside the city. */
  mainKind: number;
  pool: number;
  locality?: { name: string; lat: number; lon: number };
}

export interface EntityScore {
  name: string;
  affinity: number;
  popularity: number;
}

/** How many places the person sees. */
export const PICKS_SHOWN = 6;

export class QlooClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: QlooClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || QLOO_DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const send = () => fetch(url.toString(), { headers: { Accept: "application/json", "X-Api-Key": this.apiKey } });
    let res = await send();
    // The hackathon key has a short burst limit; one paced retry covers a page that fires several calls at once.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
      res = await send();
    }
    if (!res.ok) {
      throw new QlooError(res.status, `Qloo ${path} answered HTTP ${res.status}`);
    }
    return res.json();
  }

  async search(query: string, types: string[], extra: Record<string, string> = {}): Promise<any[]> {
    const data = await this.get("/search", { query, types: types.join(","), take: "3", ...extra });
    return Array.isArray(data.results) ? data.results : [];
  }

  /** Finds the Qloo entity for one seed; tries each type for its kind before giving up. */
  async resolveSeed(seed: Seed): Promise<ResolvedSeed> {
    // Search ranks by popularity, so the top hit for "Studio Ghibli" as a brand is a photo studio;
    // a hit whose name matches wins, and the first typed hit is kept only as a last resort.
    let firstTyped: any;
    for (const type of SEED_TYPES[seed.kind] ?? SEED_TYPES.person) {
      const hits = (await this.search(seed.name, [type])).filter((h) => h?.entity_id);
      const named = hits.find((h) => namesMatch(seed.name, h.name));
      if (named) return toResolvedSeed(seed, named);
      firstTyped ??= hits[0];
    }
    const anyHits = (await this.search(seed.name, [])).filter((h) => h?.entity_id);
    const best = anyHits.find((h) => namesMatch(seed.name, h.name)) ?? firstTyped ?? anyHits[0];
    return best ? toResolvedSeed(seed, best) : { input: seed.name, kind: seed.kind, found: false, tags: [] };
  }

  /**
   * Cross-domain affinity: places of one venue type in a city, ranked by fit to the seed entities.
   * Qloo returns a pool twice the size asked for, or opts.pool places when the caller searches deeper. Places in the city whose main category is the venue
   * come first; side-category places and places in nearby towns only fill the list when fewer than
   * ENOUGH_MAIN_KIND of those are left.
   */
  async insights(seedIds: string[], venue: Venue, city: string, opts: { take?: number; maxPopularity?: number; pool?: number } = {}): Promise<InsightsResult> {
    const take = opts.take ?? PICKS_SHOWN;
    const data = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.tags": VENUE_TAGS[venue],
      "filter.location.query": city,
      "signal.interests.entities": seedIds.join(","),
      "feature.explainability": "true",
      take: String(opts.pool ?? take * 2),
      ...(opts.maxPopularity ? { "filter.popularity.max": String(opts.maxPopularity) } : {}),
    });
    const pool = markOutside((data.results?.entities ?? []).map(toPick), data.results?.entities ?? [], city);
    const fits = (p: Pick) => MAIN_KIND[venue].test((p.kind ?? "").toLowerCase()) && !p.outside;
    const main = pool.filter(fits);
    const rest = pool.filter((p) => !fits(p)).sort((a, b) => Number(Boolean(a.outside)) - Number(Boolean(b.outside)));
    const picks = main.length >= ENOUGH_MAIN_KIND ? main : [...main, ...rest];
    return { picks: picks.slice(0, take), mainKind: main.length, pool: pool.length, locality: toLocality(data.query?.localities?.filter?.[0]) };
  }

  /**
   * The ambience and decor words Qloo predicts for people with these loves, strongest first. The list
   * runs deep (about 40 words), so it can rank the words on any place, not only the top few.
   */
  async tasteWords(seedIds: string[]): Promise<string[]> {
    const lists = await Promise.all(
      VIBE_TAG_TYPES.map((type) =>
        this.get("/v2/insights", { "filter.type": "urn:tag", "filter.tag.types": type, "signal.interests.entities": seedIds.join(","), take: "20" }),
      ),
    );
    const tags = lists.flatMap((d) => (d.results?.tags ?? []) as any[]).sort((a, b) => (b.query?.affinity ?? 0) - (a.query?.affinity ?? 0));
    return [...new Set(tags.map((t) => String(t.name ?? "").trim()).filter(Boolean))];
  }

  /** Scores named places against the same seeds, so an answer from any other source can be measured. */
  async scoreEntities(seedIds: string[], entityIds: string[]): Promise<Map<string, EntityScore>> {
    if (entityIds.length === 0) return new Map();
    const data = await this.get("/v2/insights", {
      "filter.type": "urn:entity:place",
      "filter.results.entities": entityIds.join(","),
      "signal.interests.entities": seedIds.join(","),
      take: String(entityIds.length),
    });
    const scores = new Map<string, EntityScore>();
    for (const e of data.results?.entities ?? []) {
      scores.set(e.entity_id, { name: e.name, affinity: e.query?.affinity ?? 0, popularity: e.popularity ?? 0 });
    }
    return scores;
  }

  /** Looks up a place by name in a city; returns null when Qloo has no close name match. */
  async findPlace(name: string, city: string): Promise<any | null> {
    const find = async (query: string) => {
      const hits = await this.search(query, ["urn:entity:place"], { "filter.location.query": city });
      return hits.find((h) => namesMatch(name, h.name, city)) ?? null;
    };
    // Search returns only a few fuzzy hits, and a common word ("Musee", "Bar") can push the right place
    // out of them; one more search on the distinctive words alone finds it.
    const distinct = words(name, new Set(words(city, new Set()))).join(" ");
    return (await find(name)) ?? (distinct && distinct !== name.toLowerCase() ? find(distinct) : null);
  }
}

function toResolvedSeed(seed: Seed, hit: any): ResolvedSeed {
  return {
    input: seed.name,
    kind: seed.kind,
    found: true,
    entityId: hit.entity_id,
    name: hit.name,
    type: hit.types?.[0] ?? hit.subtype,
    popularity: hit.popularity,
    image: hit.properties?.image?.url,
    tags: (hit.tags ?? [])
      .map((t: any) => t.name)
      .filter((n: string) => n && !NOISE_TAG.test(n))
      .slice(0, 6),
  };
}

function toPick(e: any): Pick {
  const contributions = e.query?.explainability?.["signal.interests.entities"] ?? [];
  return {
    entityId: e.entity_id,
    name: e.name,
    address: e.properties?.address ?? e.disambiguation,
    kind: (e.tags ?? []).find((t: any) => t.type === "urn:tag:category:place")?.name,
    affinity: e.query?.affinity ?? 0,
    popularity: e.popularity ?? 0,
    tags: uniqueTasteTags(e.tags ?? []),
    vibe: vibeTags(e.tags ?? []),
    drivenBy: contributions.map((c: any) => ({ entityId: c.entity_id, name: "", share: c.score })),
    image: e.properties?.images?.[0]?.url,
    website: e.properties?.website ?? undefined,
    mapUrl: e.location
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.name)}&query_place_id=${e.external?.google_place?.[0]?.place_id ?? ""}`
      : undefined,
  };
}

function uniqueTasteTags(tags: any[]): string[] {
  const seen = new Set<string>();
  for (const type of TASTE_TAG_TYPES) {
    for (const t of tags) {
      const name = String(t.name ?? "").trim();
      if (t.type === type && name) seen.add(name);
    }
  }
  return [...seen].slice(0, 6);
}

/**
 * Qloo's city filter reaches into the metro area, so a Lisbon list can hold Sintra or Cascais.
 * A place is outside when neither its town nor its metro is the city. When no place in the pool
 * names the city (a local spelling such as "Ciudad de México"), nothing is marked.
 */
function markOutside(picks: Pick[], entities: any[], city: string): Pick[] {
  const want = plainWords(city);
  const town = (e: any) => [e.properties?.geocode?.city, e.properties?.geocode?.metro].map((n) => plainWords(String(n ?? "")));
  const inside = entities.map((e) => !e.properties?.geocode || town(e).some((n) => n.startsWith(want) || (n !== "" && want.startsWith(n))));
  if (!inside.some(Boolean)) return picks;
  return picks.map((p, i) => (inside[i] ? p : { ...p, outside: String(entities[i].properties.geocode.city ?? "").split(" (")[0] }));
}

const plainWords = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Every ambience and decor word on a place, used to match it to the person's taste words. */
function vibeTags(tags: any[]): string[] {
  return tags.filter((t) => VIBE_TAG_TYPES.includes(t.type)).map((t) => String(t.name ?? "").trim()).filter(Boolean);
}

export function toLocality(l: any): InsightsResult["locality"] {
  if (!l?.location) return undefined;
  // Qloo's label can repeat the city, name admin areas and add notes ("Paris, Paris, Paris Police Prefecture, Ile-de-France", "Paris, France (Landmass)").
  const parts = [...new Set(String(l.disambiguation ?? l.name).replace(/\s*\([^)]*\)/g, "").split(",").map((s) => s.trim()).filter(Boolean))];
  return { name: parts.length > 2 ? `${parts[0]}, ${parts.at(-1)}` : parts.join(", "), lat: l.location.lat, lon: l.location.lon };
}

const GENERIC_WORDS = new Set(["the", "and", "restaurant", "restaurante", "bar", "cafe", "hotel", "shop", "store", "musee", "museum", "museo", "des", "les"]);

const words = (s: string, skip: Set<string>) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !GENERIC_WORDS.has(w) && !skip.has(w));

/** True when a place name holds all of 2 or more asked words, or the names share most distinctive words (Jaccard 0.6 or more); city words do not count. */
export function namesMatch(asked: string, found: string, city = ""): boolean {
  const skip = new Set(words(city, new Set()));
  const a = words(asked, skip);
  const f = new Set(words(found, skip));
  if (a.length === 0) return asked.trim().toLowerCase() === found.trim().toLowerCase();
  const shared = new Set(a.filter((w) => f.has(w))).size;
  // A place has a longer official name ("Les Pavillons de Bercy - Musee des Arts Forains") that holds every asked word; seeds keep the strict rule, so a tribute band never stands in for the band.
  if (city && a.length >= 2 && shared === new Set(a).size) return true;
  return shared / new Set([...a, ...f]).size >= 0.6;
}
