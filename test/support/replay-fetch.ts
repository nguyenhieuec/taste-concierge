export interface Exchange {
  method: string;
  url: string;
  body?: unknown;
  status: number;
  response: unknown;
}

// Query params and JSON bodies are compared as sets, so order never breaks a replay.
export function exchangeKey(method: string, url: string, body?: unknown): string {
  const u = new URL(url);
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const rpc = body && typeof body === "object" ? JSON.stringify((body as any).params ?? body) : "";
  return `${method} ${u.host}${u.pathname}?${new URLSearchParams(params).toString()} ${rpc}`;
}

/** Replaces fetch with recorded live exchanges; an unrecorded call fails the test instead of reaching the network. */
export function replayFetch(exchanges: Exchange[], seen: string[] = []): typeof fetch {
  const byKey = new Map(exchanges.map((e) => [exchangeKey(e.method, e.url, e.body), e]));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const key = exchangeKey(method, url, body);
    const hit = byKey.get(key);
    seen.push(key);
    if (!hit) throw new Error(`No recorded exchange for ${key}`);
    return new Response(JSON.stringify(hit.response), { status: hit.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}
