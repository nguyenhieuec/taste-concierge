import type { ChatMessage, Env } from "../types.ts";

/**
 * Two model roles. The router reads the request and fills a tool call (fast, cheap).
 * The writer turns Qloo results into the answer people read (strongest reasoning).
 */
export type LlmRole = "router" | "writer";

export const NEBIUS_DEFAULTS: Record<LlmRole, { model: string; baseUrl: string }> = {
  router: {
    model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
  },
  writer: {
    model: "nvidia/Nemotron-3-Ultra-550b-a55b",
    baseUrl: "https://api.tokenfactory.us-central1.nebius.com/v1",
  },
};

export const WORKERS_AI_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmRequest {
  role: LlmRole;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmReply {
  content: string;
  toolCalls: ToolCall[];
  provider: "nebius" | "workers-ai";
  model: string;
  ms: number;
}

export interface Llm {
  provider: "nebius" | "workers-ai";
  modelFor(role: LlmRole): string;
  chat(req: LlmRequest): Promise<LlmReply>;
}

/** Nebius Token Factory when its key is set; Cloudflare Workers AI otherwise, and the UI says which one ran. */
export function pickLlm(env: Env): Llm | null {
  if (env.NEBIUS_API_KEY) return nebiusLlm(env);
  if (env.AI) return workersAiLlm(env);
  return null;
}

// Reasoning models may put their thinking inline; people only see the answer.
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function nebiusLlm(env: Env): Llm {
  const modelFor = (role: LlmRole) =>
    (role === "router" ? env.NEBIUS_ROUTER_MODEL : env.NEBIUS_WRITER_MODEL) || NEBIUS_DEFAULTS[role].model;
  const baseFor = (role: LlmRole) =>
    (role === "router" ? env.NEBIUS_ROUTER_BASE_URL : env.NEBIUS_WRITER_BASE_URL) ||
    env.NEBIUS_BASE_URL ||
    NEBIUS_DEFAULTS[role].baseUrl;

  return {
    provider: "nebius",
    modelFor,
    async chat(req) {
      const started = Date.now();
      const model = modelFor(req.role);
      const res = await fetch(`${baseFor(req.role).replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.NEBIUS_API_KEY}` },
        body: JSON.stringify({
          model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 900,
          ...(req.tools ? { tools: req.tools, tool_choice: "auto" } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Nebius Token Factory ${model} answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const data = (await res.json()) as any;
      const message = data.choices?.[0]?.message ?? {};
      return {
        content: stripThinking(message.content ?? ""),
        toolCalls: (message.tool_calls ?? []).map((c: any, i: number) => ({
          id: c.id ?? `call_${i}`,
          name: c.function?.name,
          arguments: parseArgs(c.function?.arguments),
        })),
        provider: "nebius",
        model: data.model ?? model,
        ms: Date.now() - started,
      };
    },
  };
}

function workersAiLlm(env: Env): Llm {
  const model = env.WORKERS_AI_MODEL || WORKERS_AI_DEFAULT_MODEL;
  return {
    provider: "workers-ai",
    modelFor: () => model,
    async chat(req) {
      const started = Date.now();
      const out = await env.AI!.run(model, {
        // Workers AI has no tool role; tool results go in as plain context.
        messages: req.messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content })),
        max_tokens: req.maxTokens ?? 900,
        temperature: req.temperature ?? 0.2,
        ...(req.tools ? { tools: req.tools } : {}),
      });
      return {
        // Workers AI hands back a reply that is valid JSON as a parsed value, not as text.
        content: stripThinking(typeof out?.response === "string" ? out.response : out?.response == null ? "" : JSON.stringify(out.response)),
        toolCalls: (out?.tool_calls ?? []).map((c: any, i: number) => ({
          id: `call_${i}`,
          name: c.name ?? c.function?.name,
          arguments: parseArgs(c.arguments ?? c.function?.arguments),
        })),
        provider: "workers-ai",
        model,
        ms: Date.now() - started,
      };
    },
  };
}
