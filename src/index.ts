import { Hono } from "hono";
import { runBaseline, type BaselineRequest } from "./agent/baseline.ts";
import { runConcierge } from "./agent/concierge.ts";
import { pickLlm } from "./services/llm.ts";
import { deleteProfile, getProfile, validProfileId } from "./services/profile-store.ts";
import { handleMcpPost } from "./mcp.ts";
import type { Env } from "./types.ts";
import { renderPage } from "./ui/html.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(renderPage()));

app.post("/api/ask", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as any;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 600) : "";
  if (!message) return c.json({ error: "message is required" }, 400);
  if (!validProfileId(body.profileId)) return c.json({ error: "profileId must be 8 to 64 letters, digits, - or _" }, 400);
  try {
    return c.json(await runConcierge(message, body.profileId, c.env, { lessObvious: body.lessObvious === true }));
  } catch (err) {
    console.error("ask failed", err);
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.post("/api/proof", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<BaselineRequest>;
  if (!Array.isArray(body.seeds) || !body.seeds.length || !body.city || !Array.isArray(body.qlooPickIds)) {
    return c.json({ error: "seeds, city and qlooPickIds are required" }, 400);
  }
  try {
    return c.json(await runBaseline(body as BaselineRequest, c.env));
  } catch (err) {
    console.error("proof failed", err);
    return c.json({ error: (err as Error).message }, 502);
  }
});

app.get("/api/profile/:id", async (c) => {
  const id = c.req.param("id");
  if (!validProfileId(id)) return c.json({ error: "bad profile id" }, 400);
  return c.json(await getProfile(id, c.env));
});

app.delete("/api/profile/:id", async (c) => {
  const id = c.req.param("id");
  if (!validProfileId(id)) return c.json({ error: "bad profile id" }, 400);
  await deleteProfile(id, c.env);
  return c.json({ deleted: true });
});

app.post("/mcp", (c) => handleMcpPost(c.req.raw, c.env));
app.on(["GET", "DELETE"], "/mcp", (c) => c.body(null, 405, { allow: "POST" }));

app.get("/health", (c) => {
  const llm = pickLlm(c.env);
  return c.json({
    status: "ok",
    service: "taste-concierge",
    llm: llm ? { provider: llm.provider, router: llm.modelFor("router"), writer: llm.modelFor("writer") } : null,
    qloo: Boolean(c.env.QLOO_API_KEY),
    tavily: Boolean(c.env.TAVILY_API_KEY),
    memory: c.env.TASTE_DB ? "d1" : "in-memory",
  });
});

export default app;
