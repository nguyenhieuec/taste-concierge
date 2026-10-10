# Taste Concierge: Nebius x NVIDIA Global AI Hackathon entry

Track: Best Apps and Agents.
Live demo: https://taste-concierge.nguyenhieuec.workers.dev
MCP endpoint: https://taste-concierge.nguyenhieuec.workers.dev/mcp
Video: the Nebius cut waits on the Nebius key (see `video.md`); the Qloo cut is https://youtu.be/5oPj2kYwKxY.
Code: https://github.com/nguyenhieuec/taste-concierge
Licence: MIT.

## What it is

Taste Concierge is an agent that turns things you love (a film, a band, a book) into real places in a city that fit your taste.
Two NVIDIA Nemotron models on Nebius Token Factory run the agent.
The Qloo taste graph supplies every place and every score.
The page then tests the answer against the same model with no taste data, and shows the numbers.

## How it uses Nemotron on Nebius Token Factory

| Role | Model | Endpoint | Why this model |
| --- | --- | --- | --- |
| Router | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | `https://api.tokenfactory.nebius.com/v1` | fast and cheap tool calling on every request |
| Writer and test baseline | `nvidia/Nemotron-3-Ultra-550b-a55b` | `https://api.tokenfactory.us-central1.nebius.com/v1` | better writing; also the strongest "model alone" baseline for the taste test |

1. The router reads the request with OpenAI-style tool calling.
   It calls `plan_taste_search` (seeds, venue, city, country) or `reply_without_search` for a message that is not a place request.
2. The agent runs Qloo search and Qloo insights, plus the OpenKrill travel MCP server and Tavily in parallel.
   A second Qloo insights call reads the taste as ambience and decor words, and each pick shows the words it shares with that taste.
3. The writer gets the Qloo picks as data and writes the answer.
   It may not add a place, a price or an opening hour.
   The trace counts how many Qloo picks the answer names.
4. "Run the test" asks the writer for 8 places with no Qloo data and keeps 5 of them, places Qloo can score first.
   Qloo scores both lists on the same seeds.
   A held-out test then ranks again without one seed and scores both lists on that seed alone; over 7 live requests on 2026-10-10, Qloo won 10 of 14 held-out loves and its list was less famous in 7 of 7.
   A stronger baseline makes the test harder to win, so we use the large model for it.

Both models run through one OpenAI-compatible client in `src/services/llm.ts`.
The client removes any reasoning block before it reads the answer, and it reads tool arguments that come back as JSON text.

## Status of the Nebius key (honest note)

On 2026-10-10 the Token Factory account exists and the promo code is stored, but the API key page asks for billing details and a card first.
That step is waiting on the account owner.
Until the key is set, the live demo runs the same code on Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`).
The page header, `/health` and every answer say which model ran, so nothing is hidden.
The Nebius request shape is covered by tests in `test/units.test.ts`.
When the key is set, one secret switches the demo to Nemotron with no code change.

## Tavily

Tavily finds what is on this month for the kinds of things the person loves: live music for a band, screenings for a film, readings for a book.
The results show in "Before you go" and the writer may mention 1 of them.

## What was updated during the submission period

- 2026-10-02: a first scaffold of Taste Concierge was committed (a recommender on Workers AI with OpenKrill tools).
- 2026-10-10: the project was rebuilt.
  New in this rebuild: the Nemotron router and writer roles on Token Factory, the Qloo insights pipeline with explainability, the taste test, D1 taste memory with Forget, the "Skip the famous places" control, the MCP server with 4 new tools, the page, and replay tests on recorded live data.

## Feedback on Nebius Token Factory

- Sign-up with Google was quick, and the OpenAI-compatible API meant our existing client worked with only a base URL and a model id.
- The API key page opens on billing details and a card form, even when a hackathon promo code is ready.
  For a hackathon, a key that works on promo credit before any card would remove the biggest blocker we hit.
- Nemotron 3 Ultra is served from a regional base URL (`us-central1`) while Nano is on the main one.
  One base URL for all models, or a clear note on the model page, would save a debugging step.
- A per-model note on tool calling support and the reasoning output format would help agent builders choose a model quickly.

## Feedback on NVIDIA Nemotron

- A small router plus a large writer is a natural split for agents, and the Nemotron 3 family has both sizes under one name.
- Clear guidance on how to turn reasoning output on or off per request would help: an agent wants no reasoning on the router and some on the writer.
- Published tool calling examples with nested arguments (an array of objects) would help, because that is where the fallback model we used (Llama 3.3 on Workers AI) returned arguments in the wrong shape: nested values came back as JSON text.

## Try it

See `judge-steps.md`.
The architecture picture is `../shared/architecture.svg`, and screenshots are in `../shared/screenshots/`.
