import { describe, expect, it } from "vitest";
import { capNote, datedBefore, datedNow, dropShareClaims, fitsLoves, freshItems, plainWording, repeatsReasons, thinNote, weakLoves, weakNote } from "../src/agent/answer-checks.ts";
import { topUp } from "../src/agent/concierge.ts";
import type { Pick, ResolvedSeed } from "../src/types.ts";

const pick = (name: string, popularity: number): Pick => ({ entityId: name, name, kind: "Museum", affinity: 0.8, popularity, tags: [], vibe: [], drivenBy: [] });

const OCT_2026 = new Date("2026-10-10T00:00:00Z");

describe("checks on the written answer", () => {
  it("spots web results that date themselves before this month", () => {
    expect(datedBefore("Jazz in the garden, August 2026, free entry", OCT_2026)).toBe(true);
    expect(datedBefore("Doclisboa runs 16 October 2026 to 26 October 2026", OCT_2026)).toBe(false);
    expect(datedBefore("Fado nights every Friday in Nov. 2026", OCT_2026)).toBe(false);
    expect(datedBefore("The 2025 festival line-up", OCT_2026)).toBe(true);
    expect(datedBefore("Live music tonight", OCT_2026)).toBe(false);
  });

  it("tells a dated event from an undated one", () => {
    expect(datedNow("Doclisboa runs 16 October 2026 to 26 October 2026", OCT_2026)).toBe(true);
    expect(datedNow("Lisbon film events this month", OCT_2026)).toBe(false);
    expect(datedNow("Jazz in the garden, August 2026", OCT_2026)).toBe(false);
  });

  it("keeps only the fresh results for the writer", () => {
    const live = { status: "ok" as const, query: "q", items: [
      { title: "Summer series", url: "a", snippet: "July 12, 2026 at the park" },
      { title: "Film week", url: "b", snippet: "From 20 October 2026" },
    ] };
    expect(freshItems(live, OCT_2026).map((i) => i.url)).toEqual(["b"]);
  });

  it("says how many places fit in plain words", () => {
    expect(thinNote(1, "bookstore", "Porto")).toMatch(/^Qloo has only 1 place in Porto that is mainly a bookstore/);
    expect(thinNote(2, "bar", "Lyon")).toMatch(/^Qloo has only 2 places in Lyon/);
  });

  it("never lets the word seed reach the person", () => {
    expect(plainWording("Driven by the seeds, mostly the first seed.")).toBe("Driven by your loves, mostly the first love.");
  });

  it("keeps the lesser-known places first, then the least famous of the well-known ones, when the cap leaves too few", () => {
    const capped = { picks: [pick("Small A", 0.5), pick("Small B", 0.6), pick("Side bar", 0.4)], mainKind: 2, pool: 3 };
    const open = { picks: [pick("Famous", 0.99), pick("Small A", 0.5), pick("Known", 0.95), pick("Big", 0.98)], mainKind: 4, pool: 12 };
    const r = topUp(capped, open);
    expect(r.picks.map((p) => p.name)).toEqual(["Small A", "Small B", "Known", "Big", "Famous"]);
    expect(r.picks.map((p) => Boolean(p.wellKnown))).toEqual([false, false, true, true, true]);
    expect(r.mainKind).toBe(5);
    expect(capNote(2, 2, "museum", "Paris")).toBe("Qloo has only 2 lesser-known places in Paris that are mainly a museum for this taste, so 2 picks below are well known.");
  });

  it("drops model sentences about shares, which the page already shows from Qloo", () => {
    const text = "The taste is rustic.\nBarbica: charming.\nKhruangbin is the driver of these picks, with a share of 51% or more. Enjoy.";
    expect(dropShareClaims(text)).toBe("The taste is rustic.\nBarbica: charming.\nEnjoy.");
  });

  it("spots an answer that gives most picks the same reason", () => {
    const picks = ["A", "B", "C", "D"].map((n) => pick(n, 0.5));
    const same = "Taste.\nA: it matches the historic taste.\nB: it matches the historic taste.\nC: it matches the historic taste.\nD: cozy and quiet.";
    expect(repeatsReasons(same, picks)).toBe(true);
    expect(repeatsReasons("A: cozy.\nB: quiet.\nC: historic.\nD: lively.", picks)).toBe(false);
    // The same reason with one word swapped is still the same reason.
    const near = "A: it is a well-known place that fits this taste.\nB: is a well-known spot that matches this taste.\nC: a well-known place for this taste.\nD: cozy and quiet.";
    expect(repeatsReasons(near, picks)).toBe(true);
    const varied = "A: has a rustic and historic feel that aligns with this taste.\nB: has a rustic and authentic atmosphere that suits this taste.\nC: is an authentic and charming spot that matches this whimsical style.\nD: is an authentic and charming place that fits this bohemian style.";
    expect(repeatsReasons(varied, picks)).toBe(false);
  });

  it("keeps only events that fit the loves", () => {
    const seeds: ResolvedSeed[] = [
      { input: "Patti Smith", name: "Patti Smith", kind: "artist", found: true, tags: ["Punk rock", "Poetry"] },
      { input: "Amélie", name: "Amélie", kind: "movie", found: true, tags: ["Romantic comedy", "Paris", "Love"] },
    ];
    expect(fitsLoves({ title: "Katy Perry concert in Paris", snippet: "Pop star live, October 2026, a love song night" }, seeds, "Paris")).toBe(false);
    expect(fitsLoves({ title: "Punk rock night at La Maroquinerie", snippet: "Paris 20e" }, seeds, "Paris")).toBe(true);
    expect(fitsLoves({ title: "Open-air cinema at La Villette", snippet: "Paris, 12 October 2026" }, seeds, "Paris")).toBe(true);
    expect(fitsLoves({ title: "Popular Events in France in 2026 | Trip.com", snippet: "Paris film and punk rock nights" }, seeds, "Paris")).toBe(false);
    expect(fitsLoves({ title: "Paris Activities October 2026: Ultimate Guide to Outings & Events", snippet: "Film screenings and concerts in Paris" }, seeds, "Paris")).toBe(false);
    expect(fitsLoves({ title: "Met Opera in cinemas", snippet: "New York, October 2026" }, seeds, "Paris")).toBe(false);
  });

  it("names a love that Qloo gave almost no pull on any pick", () => {
    const wkw: ResolvedSeed = { input: "Wong Kar-wai", kind: "movie", found: true, entityId: "wkw", name: "Wong Kar-Wai", tags: [] };
    const rh: ResolvedSeed = { input: "Radiohead", kind: "artist", found: true, entityId: "rh", name: "Radiohead", tags: [] };
    const driven = (rhShare: number): Pick => ({ ...pick("Bar", 0.3), drivenBy: [{ entityId: "rh", name: "Radiohead", share: rhShare }, { entityId: "wkw", name: "Wong Kar-Wai", share: 1 - rhShare }] });
    expect(weakLoves([driven(1), driven(0.95)], [wkw, rh])).toEqual([wkw]);
    expect(weakLoves([driven(1), driven(0.5)], [wkw, rh])).toEqual([]);
    // Without explainability there is nothing to judge, so no love is called weak.
    expect(weakLoves([pick("Bar", 0.3)], [wkw, rh])).toEqual([]);
    expect(weakNote([wkw], [wkw, rh])).toBe("Qloo has little taste data on Wong Kar-Wai, so these picks follow Radiohead. Name a film, album or book of theirs for a better mix.");
  });
});
