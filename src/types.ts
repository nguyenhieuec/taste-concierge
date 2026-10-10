export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<any>;
}

export interface Env {
  AI?: AiBinding;
  TASTE_DB?: D1Database;
  QLOO_API_KEY?: string;
  QLOO_BASE_URL?: string;
  NEBIUS_API_KEY?: string;
  NEBIUS_BASE_URL?: string;
  NEBIUS_ROUTER_MODEL?: string;
  NEBIUS_ROUTER_BASE_URL?: string;
  NEBIUS_WRITER_MODEL?: string;
  NEBIUS_WRITER_BASE_URL?: string;
  WORKERS_AI_MODEL?: string;
  TAVILY_API_KEY?: string;
  TAVILY_BASE_URL?: string;
  OPENKRILL_TRAVEL_URL?: string;
}

/** A thing the user already loves, as the router model read it from the message. */
export interface Seed {
  name: string;
  kind: SeedKind;
}

export type SeedKind =
  | "movie"
  | "tv_show"
  | "artist"
  | "person"
  | "book"
  | "author"
  | "brand"
  | "place"
  | "podcast"
  | "video_game";

/** A seed after Qloo resolved it to a real entity in its taste graph. */
export interface ResolvedSeed {
  input: string;
  kind: SeedKind;
  found: boolean;
  entityId?: string;
  name?: string;
  type?: string;
  popularity?: number;
  image?: string;
  tags: string[];
  /** True when this love carries almost no share on any pick, so the list follows the other loves. */
  weak?: boolean;
}

export type Venue =
  | "restaurant"
  | "bar"
  | "cafe"
  | "hotel"
  | "bookstore"
  | "record_store"
  | "museum"
  | "gallery"
  | "music_venue";

export interface TastePlan {
  seeds: Seed[];
  venue: Venue;
  city: string;
  country?: string;
  /** Skip places Qloo rates as widely known, so the list is not the one every guide gives. */
  lessObvious?: boolean;
}

export interface SeedContribution {
  entityId: string;
  name: string;
  share: number;
}

export interface Pick {
  entityId: string;
  name: string;
  address?: string;
  /** Qloo's main category for the place, such as "Seafood restaurant" or "Coworking space". */
  kind?: string;
  affinity: number;
  popularity: number;
  tags: string[];
  /** Every Qloo ambience and decor word on the place. */
  vibe: string[];
  /** The person's Qloo taste words that this place also carries. */
  matches?: string[];
  drivenBy: SeedContribution[];
  image?: string;
  mapUrl?: string;
  website?: string;
  /** The town Qloo files the place under, set only when it is outside the city asked for (Sintra for Lisbon). */
  outside?: string;
  /** Set when "less obvious" was asked but the place is above the popularity cap, added only because too few lesser-known places fit. */
  wellKnown?: boolean;
}

export interface TravelNote {
  status: "ok" | "unavailable";
  country: string;
  usLevel?: number;
  usLevelText?: string;
  usUrl?: string;
  ukText?: string;
  ukUrl?: string;
}

export interface LiveItem {
  title: string;
  url: string;
  snippet: string;
}

export interface LiveContext {
  status: "ok" | "unavailable";
  query: string;
  items: LiveItem[];
  note?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface TraceStep {
  step: string;
  provider: string;
  detail: string;
  ms: number;
}

/** What the concierge remembers for one browser: the seeds, so a follow-up only names a new city or venue. */
export interface TasteProfile {
  id: string;
  seeds: Seed[];
  city?: string;
  country?: string;
  venue?: Venue;
  updatedAt: string;
}
