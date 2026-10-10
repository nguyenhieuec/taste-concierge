import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { Env } from "../../src/types.ts";
import { replayFetch, type Exchange } from "./replay-fetch.ts";
import { SCENARIOS } from "./scenarios.ts";
import { scriptedAi } from "./scripted-ai.ts";

/** Loads a recorded live scenario, freezes the clock at its recording time and replays its HTTP traffic. */
export function loadScenario(id: string) {
  const scenario = SCENARIOS.find((s) => s.id === id)!;
  const file = JSON.parse(readFileSync(new URL(`../fixtures/${id}.json`, import.meta.url), "utf8")) as { recordedAt: string; exchanges: Exchange[] };
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(file.recordedAt) });
  const seen: string[] = [];
  const aiCalls: any[] = [];
  vi.stubGlobal("fetch", replayFetch(file.exchanges, seen));
  const env: Env = { QLOO_API_KEY: "recorded", TAVILY_API_KEY: "recorded", AI: scriptedAi(scenario.answers, aiCalls) };
  return { scenario, env, seen, aiCalls, exchanges: file.exchanges };
}
