import { runBaseline } from "./agent/baseline.ts";
import { runPlan } from "./agent/concierge.ts";
import { completePlan, VENUES } from "./agent/intent.ts";
import { emptyProfile } from "./services/profile-store.ts";
import { searchLive } from "./services/tavily.ts";
import { getTravelNote } from "./services/travel.ts";
import type { Env } from "./types.ts";

const SEED_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 5,
  description: "Things the person loves, e.g. a film, band, book or chef.",
  items: {
    type: "object",
    properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["movie", "tv_show", "artist", "person", "book", "author", "brand", "place", "podcast", "video_game"] },
    },
    required: ["name", "kind"],
  },
};

export const MCP_TOOLS = [
  {
    name: "find_places",
    title: "Find places that fit a taste",
    description:
      "Real places of one kind in a city, ranked by Qloo taste affinity to things the person loves. Each pick says which seed drove it and by how much. Includes official travel advice and fresh web results.",
    inputSchema: {
      type: "object",
      properties: {
        loves: SEED_SCHEMA,
        venue: { type: "string", enum: VENUES },
        city: { type: "string" },
        country: { type: "string", description: "Country of the city, in English; adds official travel advice." },
        less_obvious: { type: "boolean", description: "Skip places Qloo rates as widely known (popularity 0.7 or more)." },
      },
      required: ["loves", "venue", "city"],
    },
  },
  {
    name: "taste_proof",
    title: "Compare with an LLM-only answer",
    description:
      "Asks the model for the same places with no Qloo data, finds them in Qloo and scores both lists on the same seeds. Use it to show whether the Qloo picks fit the taste better.",
    inputSchema: {
      type: "object",
      properties: {
        loves: { type: "array", items: { type: "object", properties: { name: { type: "string" }, entityId: { type: "string" } }, required: ["name", "entityId"] } },
        venue: { type: "string", enum: VENUES },
        city: { type: "string" },
        qlooPickIds: { type: "array", items: { type: "string" } },
        less_obvious: { type: "boolean", description: "Set when find_places ran with less_obvious, so the model is asked for less famous places too and Qloo keeps the same cap." },
      },
      required: ["loves", "venue", "city", "qlooPickIds"],
    },
  },
  {
    name: "check_travel",
    title: "Official travel advice",
    description: "UK FCDO and US State Department advice for a country, with level, date and source link.",
    inputSchema: { type: "object", properties: { country: { type: "string" } }, required: ["country"] },
  },
  {
    name: "whats_on",
    title: "What is on now",
    description: "Fresh web results from Tavily for events, openings or closures. Put the city, the month and the year in the query, for example \"jazz concerts Lisbon October 2026\", or the results are general guides.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "What to look for, with the city, month and year." } }, required: ["query"] },
  },
];

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

const rpcError = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const rpcResult = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });

async function callTool(name: string, args: any, env: Env): Promise<unknown> {
  switch (name) {
    case "find_places": {
      const { plan, missing } = completePlan({ seeds: args.loves, venue: args.venue, city: args.city, country: args.country, less_obvious: args.less_obvious }, emptyProfile("mcp-client"));
      if (!plan) throw new Error(`${missing} is required`);
      const { trace, ...rest } = await runPlan(plan, env);
      // The steps tell an outside agent what the concierge changed, such as a second ranking without the cap.
      return { ...rest, steps: trace.map(({ step, detail, ms }) => ({ step, detail, ms })) };
    }
    case "taste_proof":
      return runBaseline({ seeds: args.loves ?? [], venue: String(args.venue ?? "restaurant"), city: String(args.city ?? ""), qlooPickIds: args.qlooPickIds ?? [], lessObvious: args.less_obvious === true }, env);
    case "check_travel":
      return getTravelNote(String(args.country ?? ""), env);
    case "whats_on":
      return searchLive(String(args.query ?? ""), env.TAVILY_API_KEY, env.TAVILY_BASE_URL);
    default:
      return undefined;
  }
}

export async function handleMcpRequest(req: RpcRequest, env: Env): Promise<unknown | null> {
  const isNotification = req.id === undefined;
  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: req.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "taste-concierge", title: "Taste Concierge", version: "2.0.0" },
        instructions:
          "Call find_places with what the person loves and a city. Quote each pick's drivenBy to explain it. Call taste_proof with the resolved seeds and pick ids to compare with an answer that has no Qloo data.",
      });
    case "ping":
      return rpcResult(req.id, {});
    case "tools/list":
      return rpcResult(req.id, { tools: MCP_TOOLS });
    case "tools/call": {
      if (isNotification) return null;
      const name = req.params?.name;
      if (!MCP_TOOLS.some((t) => t.name === name)) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await callTool(name, req.params?.arguments ?? {}, env);
        return rpcResult(req.id, { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
      } catch (err) {
        return rpcResult(req.id, { isError: true, content: [{ type: "text", text: (err as Error).message }] });
      }
    }
    default:
      return isNotification ? null : rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcpPost(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((r) => handleMcpRequest(r, env)))).filter((r) => r !== null);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = await handleMcpRequest(body as RpcRequest, env);
  return out === null ? new Response(null, { status: 202 }) : Response.json(out);
}
