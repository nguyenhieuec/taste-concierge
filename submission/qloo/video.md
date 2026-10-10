# Demo video

Link: to be added after the YouTube upload.
Length: 2 minutes 52 seconds.
Recorded on the live demo on 2026-10-10, in headless Chrome at 1280 by 720 and 1.5x scale (1920 by 1080 output).
Nothing in the video is mocked: every result comes from live Qloo, Tavily and OpenKrill calls.
The language model in this cut is Cloudflare Workers AI, and the page header says so.
Voice: Kyutai Pocket TTS, CC BY 4.0.
Captions: `taste-concierge-qloo.srt` next to the video file.
Live waits for the model and Qloo are cut to under 1 second; nothing else is edited.

## Script

### Scene 1

Picture: Title card: Taste Concierge. Name what you love, get real places that fit it, the reason for each pick, and a test against a model with no taste data.

Voice: Ask a chatbot where to eat, and you get the same famous places every guide lists. Taste Concierge starts from what you love instead.

### Scene 2

Picture: Live demo: type the Lisbon request, click Find places, the answer appears.

Voice: I type one sentence: I love Khruangbin and The Grand Budapest Hotel, where should I eat in Lisbon? A language model reads it with tool calling and fills a plan: two loves, a venue type and a city. Then Qloo does the real work. Qloo search finds each love in the taste graph, and Qloo insights ranks real Lisbon restaurants by affinity to both of them. The model only writes the answer, and it may only name places Qloo returned.

### Scene 3

Picture: Scroll the seed chips, the taste words and the pick cards: kind, fit, popularity, driven by, shares your taste, tags, Maps link.

Voice: Every pick shows its main kind, its taste fit and its popularity from Qloo. A second Qloo call reads my taste as ambience words, and each card says which of them the place shares. The driven by bar is Qloo explainability: the share of the fit that came from each thing I love.

### Scene 4

Picture: Click Run the test. The verdict, the fair test line and the table of both lists appear.

Voice: Is this better than a model alone? Run the test asks the same model for eight places with no Qloo data, and keeps five of them, the ones Qloo can score first. The model picks the most famous names, popularity near 1. Qloo ranks by fit, so the fair half ranks again without one love and scores both lists on that love alone. The page shows who wins, even when the model does.

### Scene 5

Picture: Before you go: travel advice and Tavily results. Then the agent trace with ms per step.

Voice: Before you go, the agent checks official UK and US travel advice through the OpenKrill travel MCP server, and Tavily finds what is on this month. The trace shows each step, the service behind it, and the time it took. The last line counts how many Qloo picks the answer names.

### Scene 6

Picture: Turn on Skip the famous places, type Now bars there., the new picks appear.

Voice: Taste memory makes follow-ups short. I turn on skip the famous places, which caps Qloo popularity, and ask: now bars there. The agent keeps my loves and my city, and returns smaller bars that fit the same taste.

### Scene 7

Picture: Turn off Skip the famous places and ask for bars in Berlin with Wong Kar-wai films and Radiohead. The trace stops on "Search deeper for the kind asked for".

Voice: The agent also checks its own results. For bars in Berlin, only 2 of the first 12 places Qloo returns are mainly bars. So it asks Qloo for 50, finds 15, and keeps 6 real bars. The trace shows each step.

### Scene 8

Picture: Turn on Skip the famous places and ask for museums in Paris that are not touristy. The answer opens with the note on well-known places, a card says well known, and the trace stops on the step that ranks without the cap.

Voice: When the cap leaves too few places, it says so. For museums in Paris that are not touristy, Qloo has only 2 for this taste. The agent ranks again without the cap, marks the famous ones as well known, and the answer opens with that note. In our test runs, this was the closest result on popularity.

### Scene 9

Picture: Card with the live MCP tools/list: 4 tools.

Voice: The same agent is an MCP server, so other agents can call it: find places, the taste test, travel advice, and what is on.

### Scene 10

Picture: Close card: what is live (Qloo, Tavily, travel advice), which language model ran, the MIT licence, the 58 tests and the demo URL.

Voice: Taste Concierge. Qloo picks the places, the model explains them, and every number comes live from Qloo. The code is open source under the MIT licence.
