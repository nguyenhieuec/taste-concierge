import type { AiBinding } from "../../src/types.ts";

/**
 * A stand-in for the model in tests. It answers by role: the router gets a tool call, the writer gets text,
 * and the model-only test gets a list of names. HTTP data (Qloo, Tavily, travel) is never scripted; it is replayed.
 */
export interface ScriptedAnswers {
  plan?: Record<string, unknown>;
  writer?: string;
  modelOnlyNames?: string[];
}

export function scriptedAi(answers: ScriptedAnswers, calls: unknown[] = []): AiBinding {
  return {
    async run(_model, input: any) {
      calls.push(input);
      const system = String(input.messages?.[0]?.content ?? "");
      if (input.tools && answers.plan) return { response: "", tool_calls: [{ name: "plan_taste_search", arguments: answers.plan }] };
      if (system.startsWith("Name 8 real places")) return { response: JSON.stringify(answers.modelOnlyNames ?? []) };
      return { response: answers.writer ?? "" };
    },
  };
}
