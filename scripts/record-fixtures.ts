/**
 * Records live Qloo, Tavily and OpenKrill travel exchanges for the test scenarios into test/fixtures.
 * Run: QLOO_API_KEY=... TAVILY_API_KEY=... node --experimental-strip-types scripts/record-fixtures.ts
 * Keys go in request headers only, and headers are never written, so fixtures hold no secret.
 * The model is scripted (see test/support/scripted-ai.ts); only the outside data is live.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runBaseline } from "../src/agent/baseline.ts";
import { runConcierge } from "../src/agent/concierge.ts";
import type { Env } from "../src/types.ts";
import { SCENARIOS } from "../test/support/scenarios.ts";
import { scriptedAi } from "../test/support/scripted-ai.ts";
import type { Exchange } from "../test/support/replay-fetch.ts";

const realFetch = globalThis.fetch;
let log: Exchange[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const res = await realFetch(input, {
    ...init,
    headers: { ...(init?.headers as Record<string, string>), "User-Agent": "OpenAI File Downloader, XaiImageApiFetch/1.0" },
  });
  const text = await res.clone().text();
  let response: unknown = text;
  try {
    response = JSON.parse(text);
  } catch {
    // keep the raw text
  }
  log.push({
    method: init?.method ?? "GET",
    url,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    status: res.status,
    response,
  });
  return res;
}) as typeof fetch;

if (!process.env.QLOO_API_KEY || !process.env.TAVILY_API_KEY) throw new Error("QLOO_API_KEY and TAVILY_API_KEY are required");
mkdirSync(new URL("../test/fixtures/", import.meta.url), { recursive: true });

// RECORD_ONLY=<id> records one scenario and leaves the other fixtures as they are.
for (const s of SCENARIOS.filter((x) => !process.env.RECORD_ONLY || x.id === process.env.RECORD_ONLY)) {
  log = [];
  const env: Env = {
    QLOO_API_KEY: process.env.QLOO_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    AI: scriptedAi(s.answers),
  };
  const result = await runConcierge(s.message, `record-${s.id}`, env);
  const plan = result.plan!;
  const found = result.seeds.filter((x) => x.found);
  const proof = await runBaseline(
    {
      seeds: found.map((x) => ({ name: x.name!, entityId: x.entityId! })),
      venue: plan.venue,
      city: plan.city,
      qlooPickIds: result.picks.map((p) => p.entityId),
      lessObvious: plan.lessObvious,
    },
    env,
  );
  const file = new URL(`../test/fixtures/${s.id}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), scenario: s.id, exchanges: log }, null, 1) + "\n");
  console.log(`${s.id}: ${log.length} exchanges, ${result.picks.length} picks, ${proof.llmOnly.filter((p) => p.found).length}/${proof.llmOnly.length} model-only found`);
  console.log(`  picks: ${result.picks.map((p) => `${p.name} ${p.affinity.toFixed(2)}/${p.popularity.toFixed(2)}`).join("; ")}`);
  await new Promise((r) => setTimeout(r, 5000));
  console.log(`  taste: ${result.taste?.join(", ")}; trace: ${result.trace.map((t) => t.detail).join(" | ")}`);
  console.log(`  proof: ${JSON.stringify(proof.summary)} heldOut: ${JSON.stringify(proof.heldOut)}`);
}
