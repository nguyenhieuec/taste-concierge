# Taste Concierge

Taste Concierge turns things you love (a film, a band, a book) into a short list of real places in a city that fit your taste.
It shows which of your tastes drove each pick, and it tests its own answer against a language model that has no taste data.

Live demo: https://taste-concierge.nguyenhieuec.workers.dev
MCP endpoint: https://taste-concierge.nguyenhieuec.workers.dev/mcp
Licence: MIT (see `LICENSE`).

## What it does

The steps below name the Nemotron models the entry is built for.
Until the Nebius key is set, the live demo runs the same steps on Workers AI llama-3.3-70b, and each answer names the model that wrote it.

1. You write one sentence, for example "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?".
2. NVIDIA Nemotron 3 Nano reads the sentence with tool calling and fills a plan: the seeds (Khruangbin as an artist, the film as a movie), the venue (restaurant), the city and the country.
3. Qloo `/search` finds each seed in the Qloo taste graph, and keeps the hit whose name matches.
4. Qloo `/v2/insights` ranks real restaurants in Lisbon by affinity to those seeds, with explainability: the share of the fit that came from each seed.
   Places in the city whose main Qloo category is the venue come first; a place that only carries the tag on the side, or sits in a nearby town, only fills the list when fewer than 3 fit, and then the answer opens with a note that says so.
   A second Qloo `/v2/insights` call on tags reads the taste as ambience and decor words (whimsical, rustic, bohemian), and each pick shows its own qualities that rank highest for that taste.
5. In parallel, the OpenKrill travel MCP server returns official UK and US travel advice for the country, and Tavily returns events this month that match the kinds of things you love (live music for a band, film screenings for a film).
6. NVIDIA Nemotron 3 Ultra writes the answer from the Qloo picks only. It gets the list as data and may not add a place, a price or an opening hour.
7. The page shows each pick with its main kind, taste fit, popularity, a "driven by" split per seed, the qualities it shares with your taste, its taste tags and a Maps link.
8. "Run the test" asks the same model for the same places with no Qloo data, finds those places in Qloo and scores both lists on the same seeds.
   A held-out test then ranks again without one seed and scores both lists on that seed alone, because the Qloo list is ranked by the same affinity it is scored on.

A follow-up such as "Now record stores there." reuses the saved seeds and city for that browser.
"Skip the famous places" adds a Qloo popularity cap of 0.7, so the list is not the one every guide gives.

## Why Qloo is the core, not a garnish

Without Qloo the concierge does not answer with places.
If the Qloo key is missing or Qloo is down, it says so and stops; it never lets the model guess places (tests: `test/concierge.test.ts`, "without Qloo").

The taste test makes the gap measurable.
On the live Lisbon run (2026-10-10), the model-only list (Cantinho do Avillez, Eleven and other guidebook names) had an average Qloo popularity of 0.95; the Qloo list had 0.62.
Fit on the same loves was 0.82 against 0.75, but that half favours Qloo by design.
The fair half is the held-out test: Qloo ranks again without one love and both lists are scored on that love alone.
Over 7 live requests on 2026-10-10, the Qloo list was less famous in 7 of 7, and Qloo won 10 of 14 held-out loves; `submission/qloo/README.md` has the table, with the Paris losses.
The test reports honestly when the model-only list wins: for Lisbon record stores the model list fit better (0.76 against 0.75), and the page says so.

## How it uses NVIDIA Nemotron on Nebius Token Factory

| Role | Model | Endpoint |
| --- | --- | --- |
| Router: read the request, fill the plan tool | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `https://api.tokenfactory.nebius.com/v1` |
| Writer: write the answer from Qloo picks; model-only list for the test | `nvidia/Nemotron-3-Ultra-550b-a55b` | `https://api.tokenfactory.us-central1.nebius.com/v1` |

The router uses OpenAI-style tool calling with 2 tools: `plan_taste_search` and `reply_without_search` for anything that is not a place request.
The small, fast model does the routing; the large model does the writing.
Both run through one OpenAI-compatible client in `src/services/llm.ts`.

When `NEBIUS_API_KEY` is not set, the same code runs on Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`).
The page header, `/health` and every answer say which backend ran.
Status on 2026-10-10: the Nebius API key is waiting on a billing step, so the live demo runs the Workers AI fallback and the Nebius path is covered by request-shape tests.

## What is live and what is recorded

| Part | Live demo | Tests |
| --- | --- | --- |
| Qloo search and insights | Live, hackathon key | Replayed from recorded live calls (`test/fixtures/*.json`) |
| Tavily search | Live | Replayed from recorded live calls |
| OpenKrill travel MCP | Live, no key | Replayed from recorded live calls |
| Language model | Workers AI until the Nebius key is set | Scripted answers (`test/support/scripted-ai.ts`); every place and score still comes from recorded Qloo data |

Re-record the fixtures with `QLOO_API_KEY=... TAVILY_API_KEY=... pnpm record`.
The recorder never writes request headers, so no key reaches a fixture.

## MCP tools

The Worker is also a Streamable HTTP MCP server at `/mcp` with 4 tools:

- `find_places`: places of one kind in a city ranked by Qloo affinity to what the person loves, with per-seed shares, travel advice and fresh results.
- `taste_proof`: the model-only comparison, scored by Qloo.
- `check_travel`: UK FCDO and US State Department advice for a country.
- `whats_on`: fresh Tavily results.

Results are in `structuredContent`.

## Run it yourself

```sh
pnpm install
pnpm test            # 58 tests, offline, on recorded live data
pnpm typecheck
cp .dev.vars.example .dev.vars   # then add your keys
pnpm dev             # http://localhost:8787
```

Deploy your own:

```sh
npx wrangler d1 create taste-concierge          # put the id in wrangler.jsonc
npx wrangler d1 migrations apply taste-concierge --remote
npx wrangler secret put QLOO_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put NEBIUS_API_KEY          # optional; Workers AI is used without it
npx wrangler deploy
```

## Layout

```text
src/index.ts                 routes: /, /api/ask, /api/proof, /api/profile/:id, /mcp, /health
src/agent/intent.ts          Nemotron router and plan tool
src/agent/concierge.ts       the pipeline and the answer writer
src/agent/baseline.ts        the taste test against a model-only answer
src/services/qloo.ts         Qloo search, insights, scoring and name matching
src/services/llm.ts          Nebius Token Factory client and Workers AI fallback
src/services/travel.ts       OpenKrill travel MCP client
src/services/tavily.ts       Tavily search
src/services/profile-store.ts  per-browser taste memory in D1
src/ui/                      the page (no framework; all text set with textContent)
test/                        replay tests on recorded live data
```

## Privacy

The browser makes a random profile id and keeps it in local storage.
The server stores only the seeds, the last city and the last venue for that id, after it strips emails and phone numbers.
"Forget" on the page deletes the row.
