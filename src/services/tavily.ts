import type { LiveContext } from "../types.ts";

export const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com";

/** Fresh web results (events, openings, closures) that the Qloo taste graph does not carry. */
export async function searchLive(query: string, apiKey?: string, baseUrl = TAVILY_DEFAULT_BASE_URL): Promise<LiveContext> {
  if (!apiKey) return { status: "unavailable", query, items: [], note: "Tavily key is not set." };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: "basic", topic: "general", max_results: 4 }),
    });
    if (!res.ok) return { status: "unavailable", query, items: [], note: `Tavily answered HTTP ${res.status}.` };
    const data = (await res.json()) as any;
    return {
      status: "ok",
      query,
      items: (data.results ?? []).map((r: any) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? "").slice(0, 280),
      })),
    };
  } catch {
    return { status: "unavailable", query, items: [], note: "Tavily could not be reached." };
  }
}
