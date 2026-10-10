import type { Env, TravelNote } from "../types.ts";

export const OPENKRILL_TRAVEL_DEFAULT_URL = "https://travel.openkrill.app/mcp";

/** Official UK and US travel advice for the trip's country, from the OpenKrill travel MCP server. */
export async function getTravelNote(country: string, env: Env): Promise<TravelNote> {
  const unavailable: TravelNote = { status: "unavailable", country };
  try {
    const res = await fetch(env.OPENKRILL_TRAVEL_URL || OPENKRILL_TRAVEL_DEFAULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_travel_advice", arguments: { country } },
      }),
    });
    if (!res.ok) return unavailable;
    const data = (await res.json()) as any;
    const s = data.result?.structuredContent;
    if (s?.status !== "ok") return unavailable;
    return {
      status: "ok",
      country: s.country ?? country,
      usLevel: s.us?.level ?? undefined,
      usLevelText: s.us?.levelText ?? undefined,
      usUrl: s.us?.url ?? undefined,
      ukText: s.uk?.alertText?.[0] ?? undefined,
      ukUrl: s.uk?.url ?? undefined,
    };
  } catch {
    return unavailable;
  }
}
