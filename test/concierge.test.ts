import { afterEach, describe, expect, it, vi } from "vitest";
import { runBaseline } from "../src/agent/baseline.ts";
import { runConcierge, runPlan } from "../src/agent/concierge.ts";
import { getProfile } from "../src/services/profile-store.ts";
import type { TastePlan } from "../src/types.ts";
import { loadScenario } from "./support/load-scenario.ts";
import { scriptedAi } from "./support/scripted-ai.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a chat request on recorded live data", () => {
  it("turns two loves into ranked Lisbon restaurants with the share each love had", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-1", env);

    expect(r.status).toBe("ok");
    expect(r.seeds.map((s) => s.name)).toEqual(["Khruangbin", "The Grand Budapest Hotel"]);
    expect(r.picks).toHaveLength(6);
    expect(r.picks.map((p) => p.name)).toContain("Barbica");
    for (const p of r.picks) {
      expect(p.affinity).toBeGreaterThan(0.5);
      expect(p.drivenBy.map((d) => d.name).sort()).toEqual(["Khruangbin", "The Grand Budapest Hotel"]);
      expect(p.drivenBy[0]!.share).toBeGreaterThanOrEqual(p.drivenBy[1]!.share);
    }
    expect(r.travel).toMatchObject({ status: "ok", country: "Portugal", usLevel: 1 });
    expect(r.live?.status).toBe("ok");
    expect(r.live?.items.length).toBeGreaterThan(0);
    expect(r.reply).toBe(scenario.answers.writer);
    // The middle steps run in parallel and enter the trace as they finish, so only the ends are fixed.
    const steps = r.trace.map((t) => t.step);
    expect(steps[0]).toBe("Read the request");
    expect(steps[1]).toBe("Find your loves in the taste graph");
    expect(steps.at(-1)).toBe("Write the answer from the picks");
    expect(steps.slice(2, -1).sort()).toEqual(["Check official travel advice", "Look for what is on now", "Rank places by taste affinity", "Read the taste as ambience and decor"].sort());
    expect(r.trace).toHaveLength(7);
    const named = r.picks.filter((p) => r.reply.includes(p.name)).length;
    expect(r.trace.at(-1)?.detail).toBe(`Names ${named} of ${r.picks.length} Qloo picks`);
  });

  it("ranks places whose main Qloo category is the venue ahead of places that only carry the tag", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-kind", env);
    // Qloo returns Village Underground (a coworking space) and Lisboa Rio (a disco club) in its top 6 restaurants.
    expect(r.picks.map((p) => p.kind)).toEqual(Array(6).fill("Restaurant"));
    expect(r.picks.map((p) => p.name)).not.toContain("Village Underground Lisboa");
  });

  it("keeps Lisbon picks in Lisbon, not in Sintra or Cascais", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-town", env);
    // Qloo's Lisbon filter also returns Restaurante Palacio de Seteais, which is in Sintra, 25 km away.
    expect(r.picks.map((p) => p.name).join()).not.toMatch(/Seteais/);
    expect(r.picks.filter((p) => p.outside)).toEqual([]);
  });

  it("reads the taste as Qloo ambience words and marks the picks that share them", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-taste", env);
    expect(r.tasteFrom).toBe("loves");
    expect(r.taste).toContain("Bohemian");
    expect(r.taste).toHaveLength(8);
    // Every pick with ambience or decor tags names its own words that Qloo ranks highest for these loves.
    for (const p of r.picks) {
      if (p.vibe.length) expect(p.matches!.length).toBeGreaterThan(0);
      for (const m of p.matches!) {
        expect(p.vibe).toContain(m);
        expect(p.tags).not.toContain(m);
      }
    }
  });

  it("shows only taste tags on a pick, never payment, parking or reservation tags", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-tags", env);
    const tags = r.picks.flatMap((p) => p.tags);
    expect(tags.length).toBeGreaterThan(0);
    for (const t of ["Accepts reservations", "Credit cards", "Restroom", "Paid street parking", "Dine in", "Seating"]) expect(tags).not.toContain(t);
  });

  it("finds Studio Ghibli itself, not the most popular brand with Studio in its name", async () => {
    const { scenario, env } = loadScenario("tokyo-cafes");
    const r = await runConcierge(scenario.message, "profile-tokyo-1", env);
    expect(r.seeds.map((s) => s.name)).toEqual(["Studio Ghibli", "Nick Drake"]);
    // Qloo predicts no ambience words for these loves, so the page shows what the picks share instead.
    expect(r.tasteFrom).toBe("picks");
  });

  it("gives the writer only Qloo places, so it cannot add its own", async () => {
    const { scenario, env, aiCalls } = loadScenario("lisbon-restaurants");
    const r = await runConcierge(scenario.message, "profile-lisbon-2", env);
    const writerInput = JSON.parse(aiCalls.at(-1).messages[1].content);
    expect(writerInput.PICKS.map((p: any) => p.name)).toEqual(r.picks.map((p) => p.name));
  });

  it("finds the country from the Qloo city match when the model leaves it out", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    env.AI = scriptedAi({ ...scenario.answers, plan: { ...scenario.answers.plan, country: "" } });
    const r = await runConcierge(scenario.message, "profile-lisbon-4", env);
    expect(r.plan?.country).toBeUndefined();
    expect(r.travel).toMatchObject({ status: "ok", country: "Portugal" });
  });

  it("remembers the seeds and city for a follow-up", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    await runConcierge(scenario.message, "profile-lisbon-3", env);
    const profile = await getProfile("profile-lisbon-3", env);
    expect(profile.seeds.map((s) => s.name)).toEqual(["Khruangbin", "The Grand Budapest Hotel"]);
    expect(profile).toMatchObject({ city: "Lisbon", country: "Portugal", venue: "restaurant" });
  });

  it("falls back to a plain summary of the Qloo picks when the writer says nothing", async () => {
    const { env } = loadScenario("tokyo-cafes");
    env.AI = { run: async (_m: string, input: any) => (input.tools ? {} : { response: "" }) };
    const plan: TastePlan = { seeds: [{ name: "Studio Ghibli", kind: "brand" }, { name: "Nick Drake", kind: "artist" }], venue: "cafe", city: "Tokyo", country: "Japan" };
    const r = await runPlan(plan, env);
    expect(r.status).toBe("ok");
    expect(r.replyBy).toMatch(/Plain summary/);
    expect(r.reply).toContain(r.picks[0]!.name);
  });
});

describe("an honest answer when Qloo has little to offer", () => {
  it("opens the answer with a note that few picks are mainly record stores, and the test says the model list fit better", async () => {
    const { scenario, env } = loadScenario("lisbon-record-stores");
    const r = await runConcierge(scenario.message, "record-lisbon-record-stores", env);
    expect(r.reply.split("\n")[0]).toBe("Qloo has no places in Lisbon that are mainly a record store for this taste, so some picks below only sell or host it on the side.");
    expect(r.trace.find((t) => t.step === "Rank places by taste affinity")?.detail).toMatch(/the answer says so$/);
    // Qloo has only 5 such places, so a deeper search would find nothing new and does not run.
    expect(r.trace.map((t) => t.step)).not.toContain("Search deeper for the kind asked for");
    const proof = await runBaseline(
      { seeds: r.seeds.map((s) => ({ name: s.name!, entityId: s.entityId! })), venue: r.plan!.venue, city: r.plan!.city, qlooPickIds: r.picks.map((p) => p.entityId) },
      env,
    );
    expect(proof.summary!.llmAffinity).toBeGreaterThan(proof.summary!.qlooAffinity);
    expect(proof.summary!.qlooPopularity).toBeLessThan(proof.summary!.llmPopularity);
  });
});

describe("the popularity cap", () => {
  it("drops the cap on the second ranking when too few places fit under it", async () => {
    const { env } = loadScenario("lisbon-bars-less-obvious");
    const insights: URL[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search") return Response.json({ results: [{ entity_id: "e1", name: url.searchParams.get("query"), types: ["urn:entity:movie"] }] });
      if (url.pathname === "/v2/insights" && url.searchParams.get("filter.type") === "urn:entity:place") insights.push(url);
      return Response.json({ results: { entities: [], tags: [] } });
    });
    const plan: TastePlan = { seeds: [{ name: "Amélie", kind: "movie" }], venue: "museum", city: "Paris", lessObvious: true };
    await runPlan(plan, env);
    expect(insights.map((u) => u.searchParams.get("filter.popularity.max"))).toEqual(["0.7", null]);
  });
});

describe("a rare kind of place", () => {
  it("asks Qloo for a deeper pool before it fills the list with other kinds", async () => {
    const { env } = loadScenario("lisbon-bars-less-obvious");
    const takes: string[] = [];
    // Bars sit low in the ranking: 2 in the first 12, 15 in the first 50.
    const place = (i: number, bars: number) => ({ entity_id: `p${i}`, name: `Place ${i}`, popularity: 0.3, tags: [{ type: "urn:tag:category:place", name: i % 3 === 0 && i / 3 < bars ? "Bar" : "Restaurant" }], query: { affinity: 0.9 - i / 100 } });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/search") return Response.json({ results: [{ entity_id: "e1", name: url.searchParams.get("query"), types: ["urn:entity:movie"] }] });
      if (url.pathname !== "/v2/insights" || url.searchParams.get("filter.type") !== "urn:entity:place") return Response.json({ results: { entities: [], tags: [] } });
      const take = Number(url.searchParams.get("take"));
      takes.push(String(take));
      return Response.json({ results: { entities: Array.from({ length: take }, (_, i) => place(i, take > 12 ? 15 : 2)) } });
    });
    const plan: TastePlan = { seeds: [{ name: "In the Mood for Love", kind: "movie" }], venue: "bar", city: "Berlin" };
    const result = await runPlan(plan, env);
    expect(takes).toEqual(["12", "50"]);
    expect(result.picks.map((p) => p.kind)).toEqual(Array(6).fill("Bar"));
    expect(result.trace.map((t) => t.step)).toContain("Search deeper for the kind asked for");
  });
});

describe("without Qloo", () => {
  it("refuses to guess places when no Qloo key is set", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    delete env.QLOO_API_KEY;
    const r = await runConcierge(scenario.message, "profile-noqloo-1", env);
    expect(r.status).toBe("unavailable");
    expect(r.picks).toEqual([]);
  });

  it("says Qloo is down instead of answering from the model alone", async () => {
    const { scenario, env } = loadScenario("lisbon-restaurants");
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503 }));
    const r = await runConcierge(scenario.message, "profile-noqloo-2", env);
    expect(r.status).toBe("unavailable");
    expect(r.reply).toMatch(/will not guess places/);
    expect(r.picks).toEqual([]);
  });
});

describe("the taste proof on recorded live data", () => {
  it.each(["lisbon-restaurants", "lisbon-bars-less-obvious", "tokyo-cafes"])("%s: Qloo picks fit better and are less obvious than the model-only list", async (id) => {
    const { env, scenario } = loadScenario(id);
    const r = await runConcierge(scenario.message, `record-${id}`, env);
    const plan = r.plan!;
    const proof = await runBaseline(
      {
        seeds: r.seeds.filter((s) => s.found).map((s) => ({ name: s.name!, entityId: s.entityId! })),
        venue: plan.venue,
        city: plan.city,
        qlooPickIds: r.picks.map((p) => p.entityId),
        lessObvious: plan.lessObvious,
      },
      env,
    );
    expect(proof.status).toBe("ok");
    expect(proof.llmOnly.map((p) => p.name)).toEqual(scenario.answers.modelOnlyNames);
    // Counts only the model places Qloo found and could score.
    expect(proof.summary!.llmFound).toBe(5 - (scenario.unscored ?? 0));
    expect(proof.summary!.qlooAffinity).toBeGreaterThan(proof.summary!.llmAffinity);
    expect(proof.summary!.qlooPopularity).toBeLessThan(proof.summary!.llmPopularity);
    expect(proof.heldOut!.map((f) => f.seed)).toEqual(r.seeds.map((s) => s.name));
    expect(proof.heldOut!.filter((f) => f.qlooAffinity > f.llmAffinity).length).toBeGreaterThanOrEqual(1);
  });
});
