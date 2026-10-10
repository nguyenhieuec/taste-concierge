import { pickLlm, type Llm } from "../services/llm.ts";
import { getProfile, mergeSeeds, saveProfile } from "../services/profile-store.ts";
import { ENOUGH_MAIN_KIND, PICKS_SHOWN, QlooClient, QlooError, type InsightsResult } from "../services/qloo.ts";
import { searchLive } from "../services/tavily.ts";
import { getTravelNote } from "../services/travel.ts";
import type { Env, LiveContext, Pick, ResolvedSeed, TastePlan, TraceStep, TravelNote } from "../types.ts";
import { capNote, datedNow, dropShareClaims, fitsLoves, freshItems, plainWording, repeatsReasons, thinNote, WEAK_SHARE, weakLoves, weakNote } from "./answer-checks.ts";
import { readIntent } from "./intent.ts";

export type ConciergeStatus = "ok" | "needs_more" | "not_places" | "no_seeds_found" | "no_matches" | "unavailable";

export interface ConciergeResult {
  status: ConciergeStatus;
  reply: string;
  replyBy: string;
  plan?: TastePlan;
  usedProfile: boolean;
  seeds: ResolvedSeed[];
  picks: Pick[];
  locality?: InsightsResult["locality"];
  /** Ambience and decor words for this taste: predicted by Qloo from the loves, or shared by the picks when Qloo predicts none. */
  taste?: string[];
  tasteFrom?: "loves" | "picks";
  travel?: TravelNote;
  live?: LiveContext;
  trace: TraceStep[];
}

const WRITER_PROMPT = `You are Taste Concierge, a friend who knows the city. Write what the person reads, in plain English, at most 140 words.
Use only the places in PICKS. Never add a place, address, price, opening hour or event that is not in the data.
Start with one sentence that describes the taste in TASTE (ambience words from Qloo), in concrete words.
Then one line per pick: "Name: " and one short reason that links the taste to the place. Use its MATCHES first, then its tags, as you would tell a friend. If a pick has neither, name its KIND in plain words ("a natural wine bar") and say Qloo ranks it high for this taste; never guess its mood. If a pick has OUTSIDE, say it is in that town. If a pick has WELLKNOWN, say it is a well-known place.
Never mention reservations, payment, parking, seating or delivery. Never write the words tag, seed, match or affinity.
Never mention shares, percentages or which love drives a pick; the page shows that.
If TRAVEL has a US level of 3 or more, warn in one sentence first. If LIVE names an event on or after TODAY, end with one sentence about it; otherwise say nothing about events.
No headings, no markdown tables, no emoji.`;

async function timed<T>(trace: TraceStep[], step: string, provider: string, run: () => Promise<T>, detail: (r: T) => string): Promise<T> {
  const started = Date.now();
  const out = await run();
  trace.push({ step, provider, detail: detail(out), ms: Date.now() - started });
  return out;
}

export function llmLabel(llm: Llm, role: "router" | "writer"): string {
  return `${llm.provider === "nebius" ? "Nebius Token Factory" : "Workers AI"} ${llm.modelFor(role)}`;
}

function base(status: ConciergeStatus, reply: string, trace: TraceStep[], extra: Partial<ConciergeResult> = {}): ConciergeResult {
  return { status, reply, replyBy: "Taste Concierge", usedProfile: false, seeds: [], picks: [], trace, ...extra };
}

interface Ctx {
  env: Env;
  llm: Llm;
  qloo: QlooClient;
  trace: TraceStep[];
}

function context(env: Env): Ctx | null {
  const llm = pickLlm(env);
  if (!llm || !env.QLOO_API_KEY) return null;
  return { env, llm, qloo: new QlooClient({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL }), trace: [] };
}

const NOT_CONFIGURED = "The concierge is not configured: it needs a language model and a Qloo key.";

/** A chat message end to end: Nemotron reads the intent, then the plan runs. The browser's profile fills follow-ups. */
export async function runConcierge(message: string, profileId: string, env: Env, opts: { lessObvious?: boolean } = {}): Promise<ConciergeResult> {
  const ctx = context(env);
  if (!ctx) return base("unavailable", NOT_CONFIGURED, []);
  const profile = await getProfile(profileId, env);
  const intent = await timed(ctx.trace, "Read the request", llmLabel(ctx.llm, "router"), () => readIntent(ctx.llm, message, profile), describeIntent);
  if (intent.directReply) return base("not_places", intent.directReply, ctx.trace, { replyBy: llmLabel(ctx.llm, "router") });
  if (!intent.plan) {
    const ask = intent.missing === "city" ? "Which city should I search?" : "Tell me one or two things you love: a film, a band, a book or a chef.";
    return base("needs_more", ask, ctx.trace, { usedProfile: intent.usedProfile });
  }
  const plan: TastePlan = opts.lessObvious ? { ...intent.plan, lessObvious: true } : intent.plan;
  const result = await runPlanWith(ctx, plan);
  if (result.status === "ok" || result.status === "no_matches") {
    await saveProfile({ ...profile, seeds: mergeSeeds(profile.seeds, plan.seeds), city: plan.city, country: plan.country, venue: plan.venue }, env);
  }
  return { ...result, usedProfile: intent.usedProfile };
}

/** A plan given directly, as an MCP client does: no intent step and no saved profile. */
export async function runPlan(plan: TastePlan, env: Env): Promise<ConciergeResult> {
  const ctx = context(env);
  return ctx ? runPlanWith(ctx, plan) : base("unavailable", NOT_CONFIGURED, []);
}

function describeIntent(r: Awaited<ReturnType<typeof readIntent>>): string {
  if (r.plan) return `${r.plan.seeds.map((s) => s.name).join(" + ")} -> ${r.plan.venue} in ${r.plan.city}`;
  const sent = r.reply.toolCalls[0] ? ` (model sent ${JSON.stringify(r.reply.toolCalls[0].arguments).slice(0, 200)})` : "";
  return (r.missing ? `missing ${r.missing}` : "not a place request") + sent;
}

/** Without Qloo there is no taste signal, so the concierge says so instead of letting the model guess places. */
async function runPlanWith(ctx: Ctx, plan: TastePlan): Promise<ConciergeResult> {
  try {
    return await searchPlan(ctx, plan);
  } catch (err) {
    if (!(err instanceof QlooError)) throw err;
    return base("unavailable", `The Qloo taste graph did not answer (HTTP ${err.status}), so I will not guess places. Try again in a minute.`, ctx.trace, { plan });
  }
}

async function searchPlan(ctx: Ctx, asked: TastePlan): Promise<ConciergeResult> {
  const plan = asked;
  const { qloo, trace, llm, env } = ctx;
  const seeds = await timed(trace, "Find your loves in the taste graph", "Qloo /search", () => Promise.all(plan.seeds.map((s) => qloo.resolveSeed(s))), (r) =>
    r.map((s) => (s.found ? `${s.input} = ${s.name}` : `${s.input} not found`)).join("; "),
  );
  const found = seeds.filter((s) => s.found && s.entityId);
  if (found.length === 0) {
    return base("no_seeds_found", `Qloo does not know ${plan.seeds.map((s) => s.name).join(" or ")}. Try another film, artist or book.`, trace, { plan, seeds });
  }
  const seedIds = found.map((s) => s.entityId!);
  const [insights, read, travelFirst, live] = await Promise.all([
    rankPlaces(ctx, asked, seedIds),
    timed(trace, "Read the taste as ambience and decor", "Qloo /v2/insights tags", () => readTaste(qloo, seedIds), (r) => [r.words.slice(0, TASTE_SHOWN).join(", ") || "none", r.note].filter(Boolean).join("; ")),
    plan.country ? timed(trace, "Check official travel advice", "OpenKrill travel MCP", () => getTravelNote(plan.country!, env), describeTravel) : Promise.resolve(undefined),
    // The page and MCP clients get the same checks as the writer: nothing dated in the past, and only
    // results that name the city and one of the loves, so a generic ticket page never shows.
    timed(trace, "Look for what is on now", "Tavily search", () => searchLive(liveQuery(plan, found), env.TAVILY_API_KEY, env.TAVILY_BASE_URL).then((r) => ({ ...r, items: freshItems(r, new Date()).filter((i) => fitsLoves(i, found, plan.city)) })), describeLive),
  ]);
  const predicted = read.words;
  const travel = travelFirst ?? (await travelFromLocality(ctx, insights.locality));
  const tasteFrom = predicted.length ? "loves" : "picks";
  const ranked = predicted.length ? predicted : sharedVibe(insights.picks);
  const picks = matchTaste(nameDrivers(insights.picks, found), ranked);
  const weak = weakLoves(picks, found);
  if (weak.length) flagWeak(trace, weak);
  const taste = ranked.slice(0, TASTE_SHOWN);
  const shared = { plan, seeds: seeds.map((s) => (weak.includes(s) ? { ...s, weak: true } : s)), picks, locality: insights.locality, taste, tasteFrom, travel, live } as const;
  if (picks.length === 0) {
    return base("no_matches", `Qloo found no ${plan.venue.replace("_", " ")} in ${plan.city} for this taste. Try a bigger city or another kind of place.`, trace, shared);
  }
  const writer = llmLabel(llm, "writer");
  const input = { seeds: found, weak, taste, picks, mainKind: insights.mainKind, wellKnown: picks.filter((p) => p.wellKnown).length, travel, live };
  const written = await timed(trace, "Write the answer from the picks", writer, () => writeAnswer(llm, plan, input), (r) => describeAnswer(r, writer, picks));
  return { ...base("ok", written.text, trace, shared), replyBy: written.by };
}

/** Names the loves that did not shape the picks on the step that found them, so the trace shows it. */
function flagWeak(trace: TraceStep[], weak: ResolvedSeed[]): void {
  const step = trace.find((t) => t.step === "Find your loves in the taste graph");
  if (step) step.detail += `; ${weak.map((s) => s.name).join(" and ")} had under ${WEAK_SHARE * 100}% pull on every pick`;
}

/**
 * Ranks places once. When "less obvious" leaves too few places of the kind asked for, the agent asks
 * again without the popularity cap and tops up the lesser-known places with well-known ones of the
 * right kind, so a small city does not get a list padded with bars for a bookstore request, and the
 * lesser-known places the person asked for still come first.
 */
async function rankPlaces(ctx: Ctx, plan: TastePlan, seedIds: string[]): Promise<InsightsResult & { capLifted?: boolean }> {
  const venue = plan.venue.replace("_", " ");
  const maxPopularity = plan.lessObvious ? LESS_OBVIOUS_MAX : undefined;
  const cap = maxPopularity ? `, popularity under ${maxPopularity}` : "";
  const thin = (r: InsightsResult) => r.mainKind < ENOUGH_MAIN_KIND;
  const rank: Rank = (opts = {}) => ctx.qloo.insights(seedIds, plan.venue, plan.city, { maxPopularity, ...opts });
  // A pool smaller than asked for is all Qloo has, so a deeper search would find nothing new.
  const deeper = (r: InsightsResult) => thin(r) && r.pool >= FIRST_POOL;
  const first = await timed(ctx.trace, "Rank places by taste affinity", "Qloo /v2/insights", () => rank(), (r) =>
    `${r.mainKind} of ${r.pool} are mainly a ${venue} in ${plan.city}${cap}; ${deeper(r) ? "too few, so search deeper" : `kept ${r.picks.length}${thin(r) && !maxPopularity ? ", the answer says so" : ""}`}`,
  );
  if (!thin(first)) return first;
  if (!deeper(first)) return maxPopularity ? liftCap(ctx, plan, first, rank) : first;
  // The first pool is small; a rare kind of place often sits further down Qloo's ranking.
  const deep = await timed(ctx.trace, "Search deeper for the kind asked for", "Qloo /v2/insights", () => rank({ pool: DEEP_POOL }), (r) =>
    `${r.mainKind} of ${r.pool} are mainly a ${venue} in ${plan.city}${cap}; kept ${r.picks.length}${thin(r) && !maxPopularity ? ", the answer says so" : ""}`,
  );
  const capped = deep.mainKind >= first.mainKind ? deep : first;
  return maxPopularity && thin(capped) ? liftCap(ctx, plan, capped, rank) : capped;
}

/** Ranks once more without the popularity cap and tops up the lesser-known places when that finds more. */
type Rank = (opts?: { pool?: number; take?: number; maxPopularity?: number }) => Promise<InsightsResult>;

async function liftCap(ctx: Ctx, plan: TastePlan, capped: InsightsResult, rank: Rank) {
  const venue = plan.venue.replace("_", " ");
  const open = await timed(ctx.trace, "Too few fit under the cap, rank again without it", "Qloo /v2/insights", () => rank({ pool: DEEP_POOL, take: DEEP_POOL, maxPopularity: undefined }), (r) =>
    `${r.mainKind} of ${r.pool} are mainly a ${venue} without the cap; ${r.mainKind > capped.mainKind ? `kept the ${capped.mainKind} lesser-known first, then well-known ones` : "kept the capped list"}; the answer says so`,
  );
  return open.mainKind > capped.mainKind ? topUp(capped, open) : capped;
}

/** Among the best-fitting places above the cap, the least famous fill the list first. */
const KNOWN_FIT_POOL = 12;

/**
 * The capped places of the right kind first, then well-known places of that kind from the open list.
 * The person asked for less obvious places, so the fill takes the least famous of the best fits, not the top fits.
 */
export function topUp(capped: InsightsResult, open: InsightsResult): InsightsResult & { capLifted: true } {
  const lesser = capped.picks.slice(0, capped.mainKind);
  const have = new Set(lesser.map((p) => p.entityId));
  const known = open.picks
    .slice(0, open.mainKind)
    .filter((p) => !have.has(p.entityId))
    .slice(0, KNOWN_FIT_POOL)
    .sort((a, b) => a.popularity - b.popularity)
    .map((p) => ({ ...p, wellKnown: p.popularity > LESS_OBVIOUS_MAX }));
  const picks = [...lesser, ...known].slice(0, Math.max(capped.picks.length, PICKS_SHOWN));
  return { ...open, picks, mainKind: lesser.length + known.length, capLifted: true };
}

/**
 * Qloo predicts no taste words for some pairs of loves. Then each love is read alone and the lists are
 * interleaved, so both loves still shape the words. A failed call is named in the trace, not hidden.
 */
async function readTaste(qloo: Ctx["qloo"], seedIds: string[]): Promise<{ words: string[]; note?: string }> {
  try {
    const words = await qloo.tasteWords(seedIds);
    if (words.length || seedIds.length < 2) return { words };
    const each = await Promise.all(seedIds.map((id) => qloo.tasteWords([id])));
    const rows = Array.from({ length: Math.max(...each.map((list) => list.length)) }, (_, i) => each.map((list) => list[i]));
    const mixed = [...new Set(rows.flat().filter((w): w is string => Boolean(w)))];
    return { words: mixed, note: "none for all loves together, so each love was read alone" };
  } catch (err) {
    return { words: [], note: `Qloo did not answer${err instanceof QlooError ? ` (HTTP ${err.status})` : ""}` };
  }
}

/** The ambience and decor words that at least 2 picks carry, most common first. */
export function sharedVibe(picks: Pick[]): string[] {
  const counts = new Map<string, number>();
  for (const p of picks) for (const w of new Set(p.vibe)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
}

const TASTE_SHOWN = 8;
const MATCHES_SHOWN = 3;

/**
 * Picks each place's own ambience and decor words that rank highest for the person's taste, so every
 * reason is tied to the taste. The words come from the place, in the order Qloo ranks them for the loves.
 */
export function matchTaste(picks: Pick[], ranked: string[]): Pick[] {
  const stem = (w: string) => w.toLowerCase().replace(/(ical|ic|al|y)$/, "");
  return picks.map((p) => {
    const own = new Map(p.vibe.map((w) => [stem(w), w]));
    const matches = [...new Set(ranked.flatMap((w) => own.get(stem(w)) ?? []))].slice(0, MATCHES_SHOWN);
    // The card shows the matches on their own line, so the tag chips list only the other qualities.
    const shown = new Set(matches.map((m) => m.toLowerCase()));
    return { ...p, matches, tags: p.tags.filter((t) => !shown.has(t.toLowerCase())) };
  });
}

/** When the model gave no country, Qloo's city match ("Lisbon, Portugal") still names it. */
function travelFromLocality(ctx: Ctx, locality: InsightsResult["locality"]): Promise<TravelNote | undefined> {
  const country = locality?.name.split(",").at(-1)?.trim();
  if (!country || !locality?.name.includes(",")) return Promise.resolve(undefined);
  return timed(ctx.trace, "Check official travel advice", "OpenKrill travel MCP", () => getTravelNote(country, ctx.env), describeTravel);
}

const describeTravel = (r: TravelNote) => (r.status === "ok" ? r.usLevelText ?? "UK advice only" : "unavailable");
const describeLive = (r: LiveContext) => (r.status === "ok" ? `${r.items.length} fresh results that name the city and a love` : r.note ?? "unavailable");

export const LESS_OBVIOUS_MAX = 0.7;
/** How many places the agent asks Qloo for when the first, small pool holds too few of the kind asked for. */
const DEEP_POOL = 50;
/** The first pool: Qloo is asked for twice the 6 picks shown. */
const FIRST_POOL = 12;

const INTEREST_BY_KIND: Partial<Record<ResolvedSeed["kind"], string>> = {
  artist: "live music",
  movie: "film screenings",
  tv_show: "film screenings",
  book: "book readings",
  author: "book readings",
  podcast: "talks",
  video_game: "gaming events",
};

/** Tavily looks for events of the same kinds the person loves, in the same city and month. */
export function liveQuery(plan: TastePlan, seeds: ResolvedSeed[]): string {
  const month = new Date().toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  const interests = [...new Set(seeds.flatMap((s) => INTEREST_BY_KIND[s.kind] ?? []))].slice(0, 2);
  return `${plan.city} ${interests.length ? interests.join(" and ") : "culture"} events ${month}`;
}

/** Qloo explains each pick by seed id; people need the seed names. */
export function nameDrivers(picks: Pick[], seeds: ResolvedSeed[]): Pick[] {
  const names = new Map(seeds.map((s) => [s.entityId, s.name ?? s.input]));
  return picks.map((p) => ({
    ...p,
    drivenBy: p.drivenBy
      .map((d) => ({ ...d, name: names.get(d.entityId) ?? "" }))
      .filter((d) => d.name)
      .sort((a, b) => b.share - a.share),
  }));
}

interface WriterInput {
  seeds: ResolvedSeed[];
  /** Loves with almost no pull on any pick; the answer names them. */
  weak: ResolvedSeed[];
  taste: string[];
  picks: Pick[];
  /** How many picks are mainly the venue asked for; the rest only carry it as a side category. */
  mainKind: number;
  /** How many picks are above the popularity cap, added because too few lesser-known places fit. */
  wellKnown: number;
  travel?: TravelNote;
  live?: LiveContext;
}

async function writeAnswer(llm: Llm, plan: TastePlan, input: WriterInput) {
  const { seeds, weak, taste, picks, mainKind, wellKnown, travel, live } = input;
  const now = new Date();
  const venue = plan.venue.replace("_", " ");
  const kindNote = mainKind < ENOUGH_MAIN_KIND ? thinNote(mainKind, venue, plan.city) : wellKnown ? capNote(picks.length - wellKnown, wellKnown, venue, plan.city) : "";
  const note = [kindNote, weakNote(weak, seeds)].filter(Boolean).join(" ");
  const data = {
    REQUEST: { venue: plan.venue, city: plan.city },
    TODAY: now.toISOString().slice(0, 10),
    LOVES: seeds.map((s) => ({ name: s.name, tags: s.tags })),
    TASTE: taste,
    PICKS: picks.map((p) => ({ name: p.name, kind: p.kind, address: p.address, outside: p.outside, matches: p.matches ?? [], tags: p.tags, wellKnown: p.wellKnown })),
    TRAVEL: travel?.status === "ok" ? { usLevel: travel.usLevel, uk: travel.ukText } : null,
    // The writer only hears of events with a date, so it never writes a vague "there is a festival".
    LIVE: freshItems(live, now).filter((i) => fitsLoves(i, seeds, plan.city) && datedNow(`${i.title} ${i.snippet}`, now)).slice(0, 3).map((i) => `${i.title}: ${i.snippet.slice(0, 160)}`),
  };
  const withNote = (text: string) => (note ? `${note}\n\n${text}` : text);
  try {
    const reply = await llm.chat({
      role: "writer",
      messages: [
        { role: "system", content: WRITER_PROMPT },
        { role: "user", content: JSON.stringify(data) },
      ],
      maxTokens: 450,
    });
    const text = dropShareClaims(plainWording(reply.content ?? ""));
    if (text && !repeatsReasons(text, picks)) return { text: withNote(text), by: llmLabel(llm, "writer") };
    if (text) return { text: withNote(plainAnswer(plan, picks)), by: "Plain summary (the writer model gave every pick the same reason)" };
  } catch (err) {
    console.warn("writer failed", err);
  }
  return { text: withNote(plainAnswer(plan, picks)), by: "Plain summary (the writer model did not answer)" };
}

/** Shows in the trace how many Qloo picks the writer actually named, so a drifting answer is visible. */
function describeAnswer(answer: { text: string; by: string }, writer: string, picks: Pick[]): string {
  const text = answer.text.toLowerCase();
  const named = picks.filter((p) => text.includes(p.name.toLowerCase())).length;
  const fallback = answer.by === writer ? "" : `${answer.by}. `;
  return `${fallback}Names ${named} of ${picks.length} Qloo picks`;
}

/** Used when the writer model is down, so the person still gets the Qloo picks. */
export function plainAnswer(plan: TastePlan, picks: Pick[]): string {
  const reason = (p: Pick) => (p.matches?.length ? p.matches.slice(0, 2).join(" and ").toLowerCase() : `fits ${p.drivenBy[0]?.name ?? "your taste"}`);
  const lines = picks.map((p) => `${p.name}: ${reason(p)}${p.tags.length ? `, ${p.tags.slice(0, 2).join(", ")}` : ""}.`);
  return [`${picks.length} ${plan.venue.replace("_", " ")} picks in ${plan.city} for your taste.`, ...lines].join("\n");
}
