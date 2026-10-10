import { afterEach, describe, expect, it, vi } from "vitest";
import { firstScored, parseNames } from "../src/agent/baseline.ts";
import { completePlan, readIntent } from "../src/agent/intent.ts";
import { NEBIUS_DEFAULTS, pickLlm, stripThinking } from "../src/services/llm.ts";
import { emptyProfile, mergeSeeds, sanitizeText, validProfileId } from "../src/services/profile-store.ts";
import { namesMatch, toLocality } from "../src/services/qloo.ts";

afterEach(() => vi.unstubAllGlobals());

describe("namesMatch", () => {
  it("matches Qloo names that add a prefix or drop the city", () => {
    expect(namesMatch("Cervejaria Ramiro", "Restaurant - Cervejaria Ramiro", "Lisbon")).toBe(true);
    expect(namesMatch("Time Out Market Lisboa", "Time Out Market", "Lisboa")).toBe(true);
    expect(namesMatch("Cafe de l'Ambre", "Cafe De L'ambre", "Tokyo")).toBe(true);
    expect(namesMatch("Musée des Arts Forains", "Les Pavillons de Bercy - Musée des Arts Forains", "Paris")).toBe(true);
  });
  it("keeps the strict rule for loves, so a tribute band is not the band", () => {
    expect(namesMatch("Nick Drake", "Nick Drake Tribute Band")).toBe(false);
  });
  it("rejects a different place that shares one word", () => {
    expect(namesMatch("Cervejaria Ramiro", "Parque Ramiro Ruediger", "Lisbon")).toBe(false);
    expect(namesMatch("Bear Pond Espresso", "Black Bear Espresso", "Tokyo")).toBe(false);
  });
});

describe("toLocality", () => {
  it("keeps the city and its region from a Qloo label that repeats itself", () => {
    const at = { lat: 48.86, lon: 2.35 };
    expect(toLocality({ disambiguation: "Paris, Paris, Paris Police Prefecture, Ile-de-France", location: at })?.name).toBe("Paris, Ile-de-France");
    expect(toLocality({ disambiguation: "Lisbon, Portugal", location: at })?.name).toBe("Lisbon, Portugal");
    expect(toLocality({ disambiguation: "Paris, France (Landmass)", location: at })?.name).toBe("Paris, France");
  });
});

describe("firstScored", () => {
  it("keeps 5 model places, the ones Qloo can score first, in the model's order", () => {
    const named = ["A", "Closed", "B", "C", "Missing", "D", "E", "F"].map((name) => ({ name, found: name !== "Missing", affinity: ["Closed", "Missing"].includes(name) ? undefined : 0.5 }));
    expect(firstScored(named).map((p) => p.name)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("keeps unscored places when fewer than 5 can be scored", () => {
    const named = ["A", "Closed", "B"].map((name) => ({ name, found: true, affinity: name === "Closed" ? undefined : 0.5 }));
    expect(firstScored(named).map((p) => p.name)).toEqual(["A", "Closed", "B"]);
  });
});

describe("parseNames", () => {
  it("reads only the list items, not the model's intro line", () => {
    expect(parseNames("You might enjoy these museums:\n1. Musée Galliera\n2. Musée de Montmartre - a hilltop house\nEnjoy!")).toEqual(["Musée Galliera", "Musée de Montmartre"]);
  });

  it("reads a JSON array, even inside prose", () => {
    expect(parseNames('Sure: ["A Cevicheria", "Prado"]')).toEqual(["A Cevicheria", "Prado"]);
  });
  it("reads a numbered list when the model ignores the format", () => {
    expect(parseNames("1. **Prado** - farm to table\n2. Cervejaria Ramiro: seafood")).toEqual(["Prado", "Cervejaria Ramiro"]);
  });
});

describe("completePlan", () => {
  const saved = { ...emptyProfile("p-12345678"), seeds: [{ name: "Khruangbin", kind: "artist" as const }], city: "Lisbon", country: "Portugal" };
  it("reuses remembered seeds and city when a follow-up names only a venue", () => {
    expect(completePlan({ seeds: [], venue: "bar", city: "" }, saved)).toEqual({
      plan: { seeds: saved.seeds, venue: "bar", city: "Lisbon", country: "Portugal" },
      usedProfile: true,
    });
  });
  it("reads seeds and flags sent as JSON strings", () => {
    const r = completePlan({ seeds: '[{"name":"Dune","kind":"movie"}]', venue: "bar", city: "Paris", less_obvious: "true" }, emptyProfile("p-12345678"));
    expect(r.plan).toEqual({ seeds: [{ name: "Dune", kind: "movie" }], venue: "bar", city: "Paris", country: undefined, lessObvious: true });
  });
  it("asks for less obvious places when the words say so, even if the model leaves the flag off", () => {
    const args = { seeds: [{ name: "Spirited Away", kind: "movie" }], venue: "bookstore", city: "Mexico City", country: "Mexico" };
    expect(completePlan(args, emptyProfile("p-1"), "Any good bookstores in Mexico City that are not touristy?").plan?.lessObvious).toBe(true);
    expect(completePlan(args, emptyProfile("p-1"), "Any good bookstores in Mexico City?").plan?.lessObvious).toBeUndefined();
  });

  it("asks for seeds when nothing is known", () => {
    expect(completePlan({ seeds: [], venue: "bar", city: "Paris" }, emptyProfile("p-12345678")).missing).toBe("seeds");
  });
  it("asks for a city when none is named or remembered", () => {
    expect(completePlan({ seeds: [{ name: "Bjork", kind: "artist" }], venue: "bar" }, emptyProfile("p-12345678")).missing).toBe("city");
  });
});

describe("readIntent", () => {
  const llmWith = (toolCalls: any[]) => ({ provider: "workers-ai" as const, modelFor: () => "m", chat: async () => ({ content: "", toolCalls, provider: "workers-ai" as const, model: "m", ms: 1 }) });
  it("answers off-topic messages without a search", async () => {
    const r = await readIntent(llmWith([{ id: "1", name: "reply_without_search", arguments: { text: "Paris" } }]), "capital of France?", emptyProfile("p-12345678"));
    expect(r.directReply).toMatch(/find places that fit your taste/);
    expect(r.plan).toBeUndefined();
  });
  it("marks a follow-up as memory even when the model copies the saved seeds", async () => {
    const saved = { ...emptyProfile("p-12345678"), seeds: [{ name: "Khruangbin", kind: "artist" as const }], city: "Lisbon" };
    const r = await readIntent(llmWith([{ id: "1", name: "plan_taste_search", arguments: { seeds: [{ name: "Khruangbin", kind: "artist" }], venue: "record_store", city: "Lisbon" } }]), "Now record stores there.", saved);
    expect(r.usedProfile).toBe(true);
  });
});

describe("profile store", () => {
  it("accepts only opaque ids", () => {
    expect(validProfileId("p-0123456789abcdef")).toBe(true);
    expect(validProfileId("../x")).toBe(false);
    expect(validProfileId("short")).toBe(false);
  });
  it("puts new seeds first and drops duplicates", () => {
    expect(mergeSeeds([{ name: "Bjork", kind: "artist" }], [{ name: "bjork", kind: "artist" }, { name: "Dune", kind: "movie" }]).map((s) => s.name)).toEqual(["bjork", "Dune"]);
  });
  it("redacts emails and phone numbers", () => {
    expect(sanitizeText("me@example.com or 555-123-4567")).toBe("[redacted-email] or [redacted-phone]");
  });
});

describe("Nebius Token Factory client", () => {
  it("sends the router to Nemotron Nano and the writer to Nemotron Ultra on their own regions", async () => {
    const sent: { url: string; body: any; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as any).Authorization });
      return Response.json({ model: JSON.parse(String(init.body)).model, choices: [{ message: { content: "<think>plan</think>ok" } }] });
    });
    const llm = pickLlm({ NEBIUS_API_KEY: "k" })!;
    const router = await llm.chat({ role: "router", messages: [{ role: "user", content: "hi" }], tools: [] });
    await llm.chat({ role: "writer", messages: [{ role: "user", content: "hi" }] });
    expect(router.content).toBe("ok");
    expect(sent[0]).toMatchObject({ url: `${NEBIUS_DEFAULTS.router.baseUrl}/chat/completions`, auth: "Bearer k", body: { model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" } });
    expect(sent[1]).toMatchObject({ url: `${NEBIUS_DEFAULTS.writer.baseUrl}/chat/completions`, body: { model: "nvidia/Nemotron-3-Ultra-550b-a55b" } });
  });
  it("reads tool calls with JSON string arguments", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "plan_taste_search", arguments: '{"city":"Lisbon"}' } }] } }] }),
    );
    const r = await pickLlm({ NEBIUS_API_KEY: "k" })!.chat({ role: "router", messages: [] });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "plan_taste_search", arguments: { city: "Lisbon" } }]);
  });
  it("prefers Nebius over Workers AI when both are set", () => {
    expect(pickLlm({ NEBIUS_API_KEY: "k", AI: { run: async () => ({}) } })!.provider).toBe("nebius");
    expect(pickLlm({ AI: { run: async () => ({}) } })!.provider).toBe("workers-ai");
  });
  it("keeps a Workers AI reply that comes back already parsed as JSON", async () => {
    const llm = pickLlm({ AI: { run: async () => ({ response: ["Holz-Kohlen", "Loophole"] }) } })!;
    expect((await llm.chat({ role: "writer", messages: [] })).content).toBe('["Holz-Kohlen","Loophole"]');
  });
  it("strips reasoning text", () => {
    expect(stripThinking("<think>a</think> b")).toBe("b");
  });
});
