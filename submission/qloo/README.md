# Taste Concierge: Qloo Agentic Hackathon entry

Live demo: https://taste-concierge.nguyenhieuec.workers.dev
MCP endpoint: https://taste-concierge.nguyenhieuec.workers.dev/mcp
Video: https://youtu.be/5oPj2kYwKxY (script in `video.md`).
Code: https://github.com/nguyenhieuec/taste-concierge
Licence: MIT.

Name note: another entry in this hackathon, `github.com/Abhi4899/taste-concierge`, uses the same name and is a different project (an outing planner); this one is the taste-to-place agent with the taste test and the MCP server, at the demo URL above.

## The short version

Taste Concierge turns things you love into real places in a city that fit your taste.
You write one sentence, such as "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?".
Qloo reads that taste as ambience words (whimsical, artistic, rustic, historical, bohemian), finds places in the city that fit it, and says which of each place's own qualities match.
Then the page tests its own answer against the same model with no Qloo data, and shows the numbers.
The same agent is an MCP server, so other agents can use it too.

## Why it beats an LLM-only answer

A language model alone gives the guidebook list.
On the live Lisbon run on 2026-10-10, the model-only list was Cantinho do Avillez, Eleven, Belcanto, Bistro 100 Maneiras and Solar do Castelo.
"Run the test" asks the same model for 8 places with no Qloo data and finds them in Qloo.
It keeps 5 of them, places Qloo can score first, in the model's own order, so a closed or unknown place does not leave the test with 2.
The page says how many the model named.

We ran 7 requests on the live demo on 2026-10-10, each followed by the test, after the last fix to the ranking and the search.
The raw run, with the time, every place name, every score and the agent steps, is `live-eval-2026-10-10.json` in the package.
The model was Workers AI llama-3.3-70b.

| Request | Popularity, Qloo against model | Fit, Qloo against model | Held-out loves Qloo won | Model places Qloo could score |
| --- | --- | --- | --- | --- |
| Restaurants, Lisbon | 0.62 against 0.95 | 0.82 against 0.75 | 2 of 2 | 5 of 5 |
| Bars, Lisbon, not touristy | 0.36 against 0.97 | 0.82 against 0.74 | 2 of 2 | 5 of 5 |
| Cafes, Tokyo | 0.49 against 0.85 | 0.87 against 0.79 | 2 of 2 | 3 of 5 |
| Bookstores, Paris, not touristy | 0.43 against 0.92 | 0.85 against 0.86 | 0 of 2 | 3 of 5 |
| Museums, Paris, not touristy | 0.86 against 0.97 | 0.88 against 0.90 | 0 of 2 | 4 of 5 |
| Bars, Mexico City | 0.67 against 0.95 | 0.86 against 0.82 | 2 of 2 | 3 of 5 |
| Bars, Berlin | 0.58 against 0.97 | 0.85 against 0.77 | 2 of 2 | 4 of 5 |

1. **Less obvious in 7 of 7, by very different margins.** This result does not depend on the ranking.
   The gap is large in Lisbon, Tokyo, Berlin and the Paris bookstores, and smallest for the Paris museums (0.86 against 0.97).
   Both popularity and fit average only the places Qloo can score, so the 2 averages count the same places.
   With "Skip the famous places" on, the model is also asked in words to skip famous places, but Qloo applies a hard cap of 0.7 and the model cannot, so part of that gap is by design.
   For the Paris museums, Qloo has only 2 lesser-known museums for this taste, so the agent ranked again without the cap and filled the list with 4 well-known ones.
   It takes the least famous of the 12 best fits above the cap, but for this taste those are still at 0.98 or more.
   Each of those cards says "well known", and the answer opens with that note.
2. **A fair fit test.** Qloo ranks its own picks by affinity, so a higher fit on the same loves is close to guaranteed.
   The page therefore also runs a held-out test: Qloo ranks again without one love, and both lists are scored on that love alone.
   Qloo won 10 of 14 held-out loves, and every run scored at least 3 model places.
   For a "not touristy" request, each held-out ranking uses the same cap and no well-known fill, and the trace says so.
   It lost all 4 in Paris, where the model's well-known bookstores and museums fit Amélie and Patti Smith better.
3. **The page says when a result is weak.** Qloo search finds most model places by name, but its taste index sometimes has no score for them.
   Then the page names them "in Qloo, no score", and with fewer than 3 scored it calls the result weak.

The test is honest, and Qloo does not always win on fit.
For Lisbon record stores, the model list fit better (0.76 against 0.75), Qloo has only 5 places there, and none of them is mainly a record store.
The answer opens with that note, and the verdict says the model list fit as well or better.
For the Paris bookstores and museums above, the model list fit better (0.86 against 0.85 and 0.90 against 0.88, and 0 of 2 held-out loves for Qloo in each).
For the bookstores, under the popularity cap, Qloo trades a little fit for places that are much less known (0.43 against 0.92).
For the museums, 4 of the 6 Qloo picks are well-known fill, so that list is close to the model's.

## How it uses Qloo

Qloo is the core, not a garnish.
Without Qloo, the concierge does not name places: it says Qloo is unavailable and stops.

| Step | Qloo call | What it gives |
| --- | --- | --- |
| Find each love | `GET /search`, typed first, then untyped | the Qloo entity whose name matches, so "Studio Ghibli" is the studio and not the most popular brand with "Studio" in its name |
| Read the taste | `GET /v2/insights` with `filter.type=urn:tag` and `filter.tag.types` for ambience and decor | the mood Qloo predicts for these loves, strongest first |
| Rank places | `GET /v2/insights` with `filter.type=urn:entity:place`, a venue tag, `filter.location.query` and `feature.explainability` | places in the city by affinity and popularity, the share of the fit from each love, and each place's own tags |
| Skip the famous places | the same call with `filter.popularity.max=0.7` | less obvious places that still fit |
| Taste test | `GET /search` with `filter.location.query` for each model-only name, then `/v2/insights` with `filter.results.entities` | the same affinity and popularity scores for the model's places |
| Fair test | `/v2/insights` again with one love left out, then scored on that love | fit on a taste the ranking never saw |

The 9 venue kinds are restaurant, bar, cafe, hotel, bookstore, record store, museum, art gallery and live music venue.
Qloo tags a place with every category it has, so a coworking space with a kitchen is also a restaurant.
The agent uses the first category tag as the place's main kind and shows that kind on each card.
Places in the city whose main kind fits come first.
Qloo's city filter also reaches nearby towns (Sintra and Cascais for Lisbon), so places outside the city come last, and their card names the town.
Side-kind places and nearby towns only fill the list when fewer than 3 places fit, and then the answer opens with a note that says so.

## What makes it agentic

1. A router model reads the request with tool calling.
   It fills a plan (loves, venue, city, country) or answers directly when the message is not a place request.
   Words such as "not touristy" or "hidden gem" turn on the popularity cap even when the model leaves the flag off.
2. The agent runs Qloo search for each love, then Qloo place insights, Qloo taste insights, the OpenKrill travel MCP server and Tavily in parallel.
3. It checks its own results in code, not by trusting the model:
   - Places outside the city go last and are named as such.
   - When the first 12 places hold fewer than 3 of the kind asked for, it asks Qloo again for 50 before it fills the list with other kinds (Berlin bars: 2 of 12, then 15 of 50).
     When Qloo has fewer than 12 places at all, it skips that call, since a deeper search would find nothing new.
   - When too few places fit under the popularity cap, it ranks again without the cap, keeps the lesser-known places first, and fills the list with well-known places of the right kind. Each such card says "well known", and the answer opens with a note that says how many.
   - When few places are mainly the kind asked for, code puts a note at the top of the answer.
   - When a love gets almost no pull on any pick (under 10%), the answer opens with a note that names it and says which love the picks follow, and its chip is marked "little data in Qloo".
     Each chip shows the Qloo type it matched (person, movie, artist), and a director the router calls a movie is searched as a person before any untyped search.
   - Web results that date themselves in the past, or that name neither the city nor a love, are dropped for the page, the MCP tools and the writer.
   - The writer's text loses any sentence about shares or percentages, and a reply that gives every pick the same reason falls back to a plain summary.
   - In the test, a model place Qloo search misses on the full name is searched again on its distinctive words, and a failed search is named in the trace, never counted as "not in Qloo".
     The searches run 2 at a time, since 5 at once hit Qloo's rate limit.
4. A writer model writes the answer from the Qloo picks only, with each reason tied to the place's matching taste words.
   It never mentions payment, parking or reservations; those Qloo tags never reach it.
   The trace counts how many Qloo picks the answer names.
5. Taste memory keeps the loves and the city for each browser.
   "Now record stores there." reuses them, so a follow-up is 4 words.
6. The same agent is an MCP server with 4 tools.
   In an outside agent check (`../../AGENT-CUSTOMER-CHECK.md`), another agent passed 5 of 5 real tasks with these tools and called none of them on 3 of 3 unrelated tasks.

## Against the 2025 winners

The 2025 winners (GeoTaste, Resonance AI, Zesty and Alloy) set the bar: Qloo taste data turned into a useful recommendation.
Taste Concierge aims past that bar in 3 ways:

- **It tests its answer, fairly.** Every result can run a test against the model alone, scored by Qloo, including a held-out love the ranking never saw.
- **It explains each pick with Qloo data.** The taste words, the matching qualities of each place and the "driven by" share are Qloo data, not text the model made up.
- **It is a tool for other agents.** The MCP server returns the picks, scores and test results in structured form.

## What is live and what is not

- Qloo, Tavily and the OpenKrill travel MCP server are live on the demo.
- The language model on the demo is Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`).
  The code also runs NVIDIA Nemotron on Nebius Token Factory, but that account still waits on a billing step, so the demo uses this fallback.
  The page header and every answer say which model ran.
- The tests replay recorded live calls, so they run offline.

## Try it as a judge

See `judge-steps.md` (under 3 minutes).

## Files in this package

- `README.md`: this write-up.
- `video.md`: the video link, length and script.
- `judge-steps.md`: steps to check the demo.
- `../shared/screenshots/`: desktop, phone and dark-mode pictures of the live demo.
- `../shared/architecture.svg`: the architecture picture.
