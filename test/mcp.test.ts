import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index.ts";
import { loadScenario } from "./support/load-scenario.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const rpc = (body: unknown, env: object) =>
  app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);

describe("MCP endpoint", () => {
  it("lists the four tools", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {});
    const body = (await res.json()) as any;
    expect(body.result.tools.map((t: any) => t.name)).toEqual(["find_places", "taste_proof", "check_travel", "whats_on"]);
  });

  it("find_places returns picks with seed shares in structuredContent", async () => {
    const { env, scenario } = loadScenario("lisbon-restaurants");
    const plan = scenario.answers.plan as any;
    const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "find_places", arguments: { loves: plan.seeds, venue: plan.venue, city: plan.city, country: plan.country } } }, env);
    const body = (await res.json()) as any;
    const sc = body.result.structuredContent;
    expect(sc.status).toBe("ok");
    expect(sc.picks[0].drivenBy[0].name).toBeTruthy();
    expect(sc.steps.map((s: any) => s.step)).toContain("Rank places by taste affinity");
  });

  it("answers a notification with 202 and no body", async () => {
    const res = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, {});
    expect(res.status).toBe(202);
  });
});

describe("HTTP API", () => {
  it("rejects a missing profile id", async () => {
    const res = await app.request("/api/ask", { method: "POST", body: JSON.stringify({ message: "hi" }) }, {});
    expect(res.status).toBe(400);
  });

  it("reports which model backend is live", async () => {
    const res = await app.request("/health", {}, { QLOO_API_KEY: "x", AI: { run: async () => ({}) } });
    expect(await res.json()).toMatchObject({ qloo: true, llm: { provider: "workers-ai" } });
  });

  it("serves the page", async () => {
    const res = await app.request("/", {}, {});
    const html = await res.text();
    expect(html).toContain("<title>Taste Concierge</title>");
    expect(html).not.toContain("innerHTML");
  });
});
