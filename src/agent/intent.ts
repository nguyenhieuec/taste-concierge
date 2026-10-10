import type { Llm, LlmReply, ToolDefinition } from "../services/llm.ts";
import type { Seed, SeedKind, TastePlan, TasteProfile, Venue } from "../types.ts";

const SEED_KINDS: SeedKind[] = ["movie", "tv_show", "artist", "person", "book", "author", "brand", "place", "podcast", "video_game"];
export const VENUES: Venue[] = ["restaurant", "bar", "cafe", "hotel", "bookstore", "record_store", "museum", "gallery", "music_venue"];

export const PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "plan_taste_search",
    description:
      "Plan a taste-based place search. Call it whenever the person wants places (food, drinks, hotels, shops, culture) in a city.",
    parameters: {
      type: "object",
      properties: {
        seeds: {
          type: "array",
          description: "Things the person says they love, exactly as named. Empty when they name none.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              kind: { type: "string", enum: SEED_KINDS },
            },
            required: ["name", "kind"],
          },
        },
        venue: { type: "string", enum: VENUES, description: "The kind of place wanted." },
        city: { type: "string", description: "City for the search, in English. Empty when not named." },
        country: { type: "string", description: "Country of that city, in English." },
        less_obvious: { type: "boolean", description: "True when they want local, hidden or not touristy places." },
      },
      required: ["seeds", "venue", "city", "country"],
    },
  },
};

export const REPLY_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "reply_without_search",
    description: "Use for anything that is not a request for places: trivia, chat, coding, or a question about the service.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "One short sentence that says what Taste Concierge can do." } },
      required: ["text"],
    },
  },
};

const ROUTER_PROMPT = `You route requests for Taste Concierge, which finds real places that fit what a person already loves.
If the message asks for places, call plan_taste_search. Read seeds only from what the person says they love; never invent one.
Pick the seed kind with care: a film is movie, a band or singer is artist, a director or chef is person, a novel is book.
If the message is not about finding places to go, call reply_without_search instead.`;

const OFF_TOPIC = "I find places that fit your taste. Tell me a film, band or book you love and a city.";

export interface IntentResult {
  plan?: TastePlan;
  directReply?: string;
  missing?: "seeds" | "city";
  usedProfile: boolean;
  reply: LlmReply;
}

/** Nemotron reads the message and fills the plan tool; saved seeds and city fill any gap in a follow-up. */
export async function readIntent(llm: Llm, message: string, profile: TasteProfile): Promise<IntentResult> {
  const memory = profile.seeds.length
    ? `\nSaved taste for this person: ${profile.seeds.map((s) => `${s.name} (${s.kind})`).join(", ")}; last city ${profile.city ?? "none"}. Leave seeds empty if they add none.`
    : "";
  const reply = await llm.chat({
    role: "router",
    messages: [
      { role: "system", content: ROUTER_PROMPT + memory },
      { role: "user", content: message },
    ],
    tools: [PLAN_TOOL, REPLY_TOOL],
    maxTokens: 400,
    temperature: 0,
  });
  const direct = reply.toolCalls.find((c) => c.name === REPLY_TOOL.function.name);
  const args = direct ? undefined : (reply.toolCalls.find((c) => c.name === PLAN_TOOL.function.name)?.arguments ?? jsonFromText(reply.content));
  if (!args) return { directReply: OFF_TOPIC, usedProfile: false, reply };
  const intent = completePlan(args, profile, message);
  return { ...intent, usedProfile: intent.usedProfile || echoedMemory(intent.plan?.seeds ?? [], profile, message), reply };
}

/** The model often copies saved seeds back into the plan; that still means the answer came from memory. */
function echoedMemory(seeds: Seed[], profile: TasteProfile, message: string): boolean {
  const saved = new Set(profile.seeds.map((s) => s.name.toLowerCase()));
  const text = message.toLowerCase();
  return seeds.length > 0 && seeds.every((s) => saved.has(s.name.toLowerCase()) && !text.includes(s.name.toLowerCase()));
}

/** Some models write the tool arguments as plain JSON text instead of a tool call. */
function jsonFromText(text: string): Record<string, unknown> | undefined {
  const m = text.match(/\{[\s\S]*"venue"[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const parsed = JSON.parse(m[0]);
    return parsed.parameters ?? parsed.arguments ?? parsed;
  } catch {
    return undefined;
  }
}

// Small models often leave less_obvious unset even when the words are plain, so the words also count.
const LESS_OBVIOUS_WORDS = /not (too )?touristy|not (the )?famous|off the beaten|hidden gem|less obvious|less known|like a local|locals go|under the radar/i;

export function completePlan(args: Record<string, unknown>, profile: TasteProfile, message = ""): Omit<IntentResult, "reply"> {
  const fresh = cleanSeeds(args.seeds);
  const seeds = fresh.length ? fresh : profile.seeds;
  const city = cleanText(args.city) || profile.city || "";
  const venue = VENUES.includes(args.venue as Venue) ? (args.venue as Venue) : (profile.venue ?? "restaurant");
  const usedProfile = fresh.length === 0 && seeds.length > 0;
  if (seeds.length === 0) return { missing: "seeds", usedProfile };
  if (!city) return { missing: "city", usedProfile };
  const country = cleanText(args.country) || (city === profile.city ? profile.country : undefined);
  const lessObvious = unwrap(args.less_obvious) === true || LESS_OBVIOUS_WORDS.test(message) || undefined;
  return { plan: { seeds, venue, city, country, ...(lessObvious ? { lessObvious } : {}) }, usedProfile };
}

// Some models send a nested array or a boolean as a JSON string inside the tool arguments.
function unwrap(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function cleanSeeds(value: unknown): Seed[] {
  const raw = unwrap(value);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s: any) => ({
      name: cleanText(s?.name),
      kind: SEED_KINDS.includes(s?.kind) ? (s.kind as SeedKind) : "person",
    }))
    .filter((s) => s.name)
    .slice(0, 5);
}

function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 80) : "";
}
