# Agent-Customer Check: Taste Concierge

This file records an agent-customer check of the Taste Concierge MCP server, run on 2026-10-10 against the live Worker.
An outside agent got only the MCP tools and a plain user prompt, with no hints about which tool to use.

> **Note on the picks below.** This check ran before 2 later changes on the same day: picks are now ranked by their main Qloo category, and places outside the city go last.
> The tool names, inputs and outputs are the same, but a run today returns different picks; for example Village Underground Lisboa no longer appears in a restaurant list.
> The data-quality finding below is the reason for the first change.

## Setup

- **Date:** 2026-10-10.
- **Endpoint:** `https://taste-concierge.nguyenhieuec.workers.dev/mcp` (Streamable HTTP, no auth).
- **Runner:** Pi CLI, one fresh non-interactive run per prompt: `pi -p --mode json --no-session --no-context-files --no-skills --model xai/grok-4.7 --thinking medium --mcp-config /tmp/at-tc-pi/mcp-config.json "<prompt>"`.
- **Pi model:** `xai/grok-4.7`.
  Pi's Anthropic and OpenAI Codex logins had expired and its Gemini key was rejected, so xAI was the one working provider.
- **MCP config:** a temp file with one server, `{"mcpServers":{"taste-concierge":{"url":"<endpoint>","lifecycle":"eager","directTools":true}}}`.
  Pi exposed the tools as `taste-concierge_find_places`, `taste-concierge_taste_proof`, `taste-concierge_check_travel` and `taste-concierge_whats_on`.
  The global `~/.pi` config was not changed.
- **Pacing:** runs were sequential with 8 s between them, to stay under the Qloo hackathon key burst limit.
- **Raw output:** Pi JSON event logs are kept outside the repo, one file per task (`P1.jsonl` to `N3.jsonl`).

## Keys on the Worker

- **Qloo:** live.
  Every `find_places` and `taste_proof` call returned real Qloo entity ids, affinity and popularity scores.
- **Tavily:** live.
  `whats_on` and the live block inside `find_places` returned real web results.
- **Travel advice:** live.
  US State Department and UK FCDO text with source links.
- **Language model on the Worker:** Cloudflare Workers AI, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
  The Nebius key is not set yet.

## Pass bar

- A positive task passes when the agent picks the expected tool without hints, the call succeeds, and the answer uses the returned data.
- A negative task passes when the agent calls 0 Taste Concierge tools.

## Results

| ID | Prompt | Tools called | Key arguments | Returned data (excerpt) | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| P1 | I love Khruangbin and The Grand Budapest Hotel. Which restaurants in Lisbon would I like? | `find_places` x1 | venue `restaurant`, city `Lisbon`, country `Portugal` | 6 picks, top: Mar ao Carmo 0.831, Barbica 0.827, Solar dos Bicos 0.827 | PASS |
| P2 | (same tastes) Bars in Lisbon that are not the famous tourist ones. | `find_places` x1 | venue `bar`, `less_obvious: true` | 6 picks, top: Bar Terraço de Santa Luzia 0.846 (pop 0.39), Vicente Lisboa 0.841 (pop 0.14) | PASS |
| P3 | Would a plain language model pick worse Lisbon restaurants than a taste graph...? Prove it. | `find_places` x1, then `taste_proof` x1 | seeds with Qloo entity ids, 6 pick ids | LLM-only affinity 0.784 vs Qloo 0.825; popularity 0.974 vs 0.750 | PASS |
| P4 | Is it safe to travel to Portugal right now? | `check_travel` x1 | country `Portugal` | US Level 1, FCDO does not advise against travel | PASS |
| P5 | What film or music events are on in Lisbon this month? | `whats_on` x6 (plus Pi `bash` for the date) | first query `film and music events Lisbon this month` | Doclisboa 15 to 25 October 2026, LEFFEST 6 to 15 November 2026 | PASS |
| N1 | What is the capital of France? | none | - | Answer: "Paris." | PASS |
| N2 | Write a Python function to reverse a linked list. | none | - | Iterative Python function | PASS |
| N3 | Create a 1500-calorie meal plan for weight loss. | none | - | Sample meal plan with a note to check with a clinician | PASS |

## Task details

### P1: restaurants from two tastes

- **Call:** `find_places` with `loves: [{Khruangbin, artist}, {The Grand Budapest Hotel, movie}]`, `venue: restaurant`, `city: Lisbon`, `country: Portugal`.
- **Seeds:** both found in Qloo (Khruangbin `BAF6317A-...`, The Grand Budapest Hotel `DF788007-...`).
- **Picks (affinity, popularity):** Mar ao Carmo 0.831, 0.90; Barbica 0.827, 0.43; Solar dos Bicos 0.827, 0.94; Village Underground Lisboa 0.825, 1.00; BONANÇA - Associação Naval de Lisboa 0.824, 0.27; Lisboa Rio 0.819, 0.96.
- **drivenBy:** Mar ao Carmo was 0.53 The Grand Budapest Hotel and 0.47 Khruangbin.
- **Extras in the same response:** Portugal travel advice (US Level 1), Tavily items for Doclisboa and LEFFEST, `replyBy: Workers AI @cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- **Agent answer:** listed the picks with affinity, address and map link, and used `drivenBy` to say which seed each pick leaned on.

### P2: less obvious bars

- **Call:** `find_places` with the same seeds, `venue: bar`, `city: Lisbon`, `country: Portugal`, `less_obvious: true`.
- **Picks (affinity, popularity):** Bar Terraço de Santa Luzia 0.846, 0.39; Vicente Lisboa 0.841, 0.14; Cossoul 0.831, 0.31; Bacchanal 0.824, 0.14; MALT 0.819, 0.19; Lounge D 0.819, 0.48.
- **Check:** every pick has popularity under 0.7, so the filter worked.

### P3: taste graph against a plain model

- **Calls:** `find_places` first, then `taste_proof` with the resolved seed entity ids and the 6 pick ids from step 1.
  The agent built the second call from the first result with no help.
- **LLM-only list (Workers AI, no Qloo data):** Cantinho do Avillez, Eleven, Bistro 100 Maneiras, Sol e Pesca, Park.
  All 5 were found in Qloo (`llmFound: 5`).
- **Summary:** `llmAffinity 0.784`, `qlooAffinity 0.825`, `llmPopularity 0.974`, `qlooPopularity 0.750`.
- **Agent answer:** said the graph list scores +0.042 in affinity and -0.225 in popularity.
  It also said the test uses Qloo's own metric, so it is partly circular, and that 3 of the 6 graph picks are not restaurants.

### P4: travel safety

- **Call:** `check_travel` with `country: Portugal`.
- **Returned:** `usLevel: 1`, `usLevelText: Level 1: Exercise Normal Precautions`, `ukText: The FCDO does not currently advise against travel.`, with both source URLs.

### P5: what is on

- **Calls:** 6 `whats_on` calls and 2 Pi `bash` calls to read the date.
- **First query:** `film and music events Lisbon this month`, which returned seasonal guides (golisbon.com, visitlisboa.com).
- **Agent detour:** the second query used "March 2026" before the agent checked the date (October 2026).
  This was an agent mistake, not a tool fault.
- **Later queries returned:** Doclisboa 15 to 25 October 2026 (events.europa.tips), LEFFEST 6 to 15 November 2026 (leffest.com), Queer Lisboa 18 to 26 September 2026 (European Film Academy), Evanescence at MEO Arena on 4 October 2026 (jambase.com).
- **Agent answer:** listed Doclisboa and a Kelela show on 21 October, and marked LEFFEST, Queer Lisboa and Evanescence as outside the rest of this month.

### N1, N2, N3: out of scope

- All 3 answered directly and called no Taste Concierge tool.
- N3 gave a sample plan with a note to check with a clinician first.

## Findings

- **No tool errors.** All 11 Taste Concierge tool calls returned `isError: false` and `status: ok`.
- **Tool descriptions work.** The agent picked the right tool on every positive task, set `less_obvious` from the words "not the famous tourist ones", and chained `find_places` into `taste_proof` with the right ids.
- **Data quality, restaurant picks:** for `venue: restaurant`, 3 of 6 picks are not mainly restaurants: Village Underground Lisboa (a venue and coworking space), Lisboa Rio (bar and dancing) and BONANÇA (a naval club with dining).
  The code sends `filter.tags=urn:tag:category:place:restaurant` (`src/services/qloo.ts:21`), so these places carry that tag in Qloo.
  The Workers AI reply still calls Village Underground "a coworking space" in a restaurant list, and the outside agent pointed this out.
- **`whats_on` has no date hint.** The description says "fresh web results" but does not say to put the month and year in the query.
  A vague first query returned seasonal guides, and the agent needed 5 more calls to get dated listings.

## Conclusion

- Positive tasks: 5 of 5 PASS, with the expected tool and live data.
- Negative tasks: 3 of 3 PASS, with 0 Taste Concierge tools called.
- Live data: Qloo, Tavily and official travel advice all returned real data, and the Worker's language model was Workers AI.
- Open items at the time of the check: non-restaurant places in restaurant picks, and a date hint for `whats_on`.

## Fixed after this check (2026-10-10)

- Picks whose main Qloo category (the first `urn:tag:category:place` tag) matches the venue now rank first.
  The live Lisbon restaurant run now returns 6 of 6 places with the main kind "Restaurant", and each card shows that kind.
  A replay test covers this ranking.
- The `whats_on` description now asks for the city, the month and the year in the query.
