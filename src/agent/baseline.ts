import { pickLlm } from "../services/llm.ts";
import { QlooClient, QlooError } from "../services/qloo.ts";
import type { Env, TraceStep, Venue } from "../types.ts";
import { LESS_OBVIOUS_MAX, llmLabel } from "./concierge.ts";
import { VENUES } from "./intent.ts";

export interface BaselineRequest {
  seeds: { name: string; entityId: string }[];
  venue: string;
  city: string;
  qlooPickIds: string[];
  /** Set when the Qloo list was capped by popularity; the model then gets the same wish in words, and the fair half uses the same cap. */
  lessObvious?: boolean;
}

export interface ScoredPlace {
  name: string;
  found: boolean;
  entityId?: string;
  popularity?: number;
  affinity?: number;
}

export interface BaselineResult {
  status: "ok" | "unavailable";
  by: string;
  llmOnly: ScoredPlace[];
  /** How many places the model named; llmOnly keeps the first ones Qloo can score. */
  modelNamed?: number;
  qloo: ScoredPlace[];
  summary?: { llmAffinity: number; qlooAffinity: number; llmPopularity: number; qlooPopularity: number; llmFound: number };
  /**
   * The fair fit test. Qloo ranks its picks by affinity, so scoring them on the same seeds favours
   * Qloo by design. Here Qloo ranks with every seed but one, and both lists are scored on that one.
   */
  heldOut?: HeldOutFold[];
  trace: TraceStep[];
}

export interface HeldOutFold {
  seed: string;
  qlooAffinity: number;
  llmAffinity: number;
}

/** The model names more places than are compared, so a closed or unscored place does not leave the test with 2. */
const MODEL_NAMES = 8;
const MODEL_COMPARED = 5;

const BASELINE_PROMPT = `Name ${MODEL_NAMES} real places that exist today. Reply with only a JSON array of ${MODEL_NAMES} place names, nothing else.`;

/**
 * The taste proof: ask the same model with no Qloo data, then score both answers on the same Qloo seeds.
 * A place the model names that Qloo cannot find counts as not found, never as a score.
 */
export async function runBaseline(req: BaselineRequest, env: Env): Promise<BaselineResult> {
  const trace: TraceStep[] = [];
  const llm = pickLlm(env);
  if (!llm || !env.QLOO_API_KEY) return { status: "unavailable", by: "", llmOnly: [], qloo: [], trace };
  const qloo = new QlooClient({ apiKey: env.QLOO_API_KEY, baseUrl: env.QLOO_BASE_URL });
  const venue = req.venue.replace("_", " ");

  let started = Date.now();
  const reply = await llm.chat({
    role: "writer",
    messages: [
      { role: "system", content: BASELINE_PROMPT },
      { role: "user", content: `I love ${req.seeds.map((s) => s.name).join(" and ")}. Name ${MODEL_NAMES} ${venue}s in ${req.city} that fit my taste.${req.lessObvious ? " Skip the famous, touristy ones; I want places locals go to." : ""}` },
    ],
    maxTokens: 300,
  });
  const names = parseNames(reply.content);
  trace.push({ step: "Ask the model with no Qloo data", provider: llmLabel(llm, "writer"), detail: names.join("; ") || `no list (the model said: "${reply.content.slice(0, 120)}")`, ms: Date.now() - started });

  started = Date.now();
  // A failed search is counted apart from a miss, so a rate limit never reads as "Qloo does not know it".
  const failed: number[] = [];
  // Two at a time: 5 searches at once, each with a retry, trip Qloo's rate limit.
  const hits = await inPairs(names, (n) =>
    qloo.findPlace(n, req.city).catch((err) => {
      failed.push(err instanceof QlooError ? err.status : 0);
      return null;
    }),
  );
  const named: ScoredPlace[] = names.map((name, i) => ({ name, found: Boolean(hits[i]), entityId: hits[i]?.entity_id, popularity: hits[i]?.popularity }));
  const failNote = failed.length ? `; ${failed.length === 1 ? "1 search" : `${failed.length} searches`} failed (HTTP ${[...new Set(failed)].join(", ")})` : "";
  trace.push({ step: "Find those places in Qloo", provider: "Qloo /search", detail: `${named.filter((p) => p.found).length} of ${names.length} found${failNote}`, ms: Date.now() - started });

  started = Date.now();
  const namedIds = named.flatMap((p) => (p.entityId ? [p.entityId] : []));
  const ids = [...new Set([...namedIds, ...req.qlooPickIds])];
  const seedIds = req.seeds.map((s) => s.entityId);
  const scores = await qloo.scoreEntities(seedIds, ids);
  for (const p of named) if (p.entityId) p.affinity = scores.get(p.entityId)?.affinity;
  const llmOnly = firstScored(named);
  const llmIds = llmOnly.flatMap((p) => (p.entityId ? [p.entityId] : []));
  trace.push({ step: "Score both lists on the same seeds", provider: "Qloo /v2/insights", detail: `${scores.size} places scored${names.length > llmOnly.length ? `; kept ${llmOnly.length} of the model's places, the ones Qloo can score first, in its own order` : ""}`, ms: Date.now() - started });

  const qlooList: ScoredPlace[] = req.qlooPickIds.map((id) => ({
    name: scores.get(id)?.name ?? id,
    found: true,
    entityId: id,
    affinity: scores.get(id)?.affinity,
    popularity: scores.get(id)?.popularity,
  }));
  const venueKind = VENUES.find((v) => v === req.venue);
  // Qloo search knows some places its insights index cannot score; with none scored there is no fair test.
  const anyScored = llmIds.some((id) => scores.has(id));
  const heldOut = venueKind && req.seeds.length >= 2 && anyScored ? await scoreHeldOut(qloo, { ...req, venue: venueKind }, llmIds, trace) : undefined;
  return { status: "ok", by: llmLabel(llm, "writer"), llmOnly, modelNamed: names.length, qloo: qlooList, summary: summarize(llmOnly, qlooList), heldOut, trace };
}

/** One fold per seed: Qloo never sees that seed while ranking, and both lists are scored on it alone. */
async function scoreHeldOut(qloo: QlooClient, req: BaselineRequest & { venue: Venue }, llmIds: string[], trace: TraceStep[]): Promise<HeldOutFold[]> {
  const started = Date.now();
  const folds = await Promise.all(
    req.seeds.map(async (seed) => {
      const rest = req.seeds.filter((s) => s.entityId !== seed.entityId).map((s) => s.entityId);
      const ranked = await qloo.insights(rest, req.venue, req.city, { maxPopularity: req.lessObvious ? LESS_OBVIOUS_MAX : undefined });
      const ids = ranked.picks.map((p) => p.entityId);
      const scores = await qloo.scoreEntities([seed.entityId], [...new Set([...ids, ...llmIds])]);
      const fit = (list: string[]) => mean(list.flatMap((id) => scores.get(id)?.affinity ?? []));
      // A fold where neither list scores above 0 on the love says nothing about either list.
      const fold = { seed: seed.name, qlooAffinity: fit(ids), llmAffinity: fit(llmIds) };
      return llmIds.some((id) => scores.has(id)) && (fold.qlooAffinity > 0 || fold.llmAffinity > 0) ? [fold] : [];
    }),
  ).then((all) => all.flat());
  const wins = folds.filter((f) => f.qlooAffinity > f.llmAffinity).length;
  trace.push({ step: "Score on a taste the ranking never saw", provider: "Qloo /v2/insights", detail: `Qloo wins ${wins} of ${folds.length} held-out seeds${req.lessObvious ? `, each ranked under the popularity cap of ${LESS_OBVIOUS_MAX} without well-known fill` : ""}`, ms: Date.now() - started });
  return folds;
}

export function parseNames(text: string): string[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr)) return arr.map((x) => String(typeof x === "string" ? x : x?.name ?? "").trim()).filter(Boolean).slice(0, MODEL_NAMES);
    } catch {
      // fall through to the line reader
    }
  }
  // A numbered or bulleted list is the answer; the lines around it are the model talking.
  const LIST_ITEM = /^\s*(\d+[.)]|[-*])\s+/;
  const lines = text.split("\n").filter((l) => l.trim() && !l.trim().endsWith(":"));
  const items = lines.filter((l) => LIST_ITEM.test(l));
  return (items.length ? items : lines)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*])\s*/, "").replace(/\*\*/g, "").split(/\s[-–]\s|:\s/)[0]!.trim())
    .filter((l) => l && l.length < 80)
    .slice(0, MODEL_NAMES);
}

/** The model's first places that Qloo can score, then unscored ones if too few, always in the model's order. */
export function firstScored(named: ScoredPlace[]): ScoredPlace[] {
  const scored = named.filter((p) => typeof p.affinity === "number");
  const kept = new Set([...scored, ...named.filter((p) => !scored.includes(p))].slice(0, MODEL_COMPARED));
  return named.filter((p) => kept.has(p));
}

async function inPairs<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += 2) out.push(...(await Promise.all(items.slice(i, i + 2).map(run))));
  return out;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function summarize(llmOnly: ScoredPlace[], qloo: ScoredPlace[]): BaselineResult["summary"] {
  const scored = (list: ScoredPlace[], key: "affinity" | "popularity") => list.flatMap((p) => (typeof p[key] === "number" ? [p[key] as number] : []));
  return {
    llmAffinity: mean(scored(llmOnly, "affinity")),
    qlooAffinity: mean(scored(qloo, "affinity")),
    // Popularity counts the same places as fit, so both averages describe one list.
    llmPopularity: mean(scored(llmOnly.filter((p) => typeof p.affinity === "number"), "popularity")),
    qlooPopularity: mean(scored(qloo, "popularity")),
    // A place Qloo finds but cannot score adds nothing to the averages, so it does not count.
    llmFound: llmOnly.filter((p) => typeof p.affinity === "number").length,
  };
}
