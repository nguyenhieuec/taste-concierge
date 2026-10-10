# Judge steps

These steps take under 3 minutes and need no account or key.

## On the live demo

1. Open https://taste-concierge.nguyenhieuec.workers.dev.
   The top right says what is live, for example "Live Qloo · text by Workers AI".
   The dot is green when Qloo is live.
2. Click the first example, or type: "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?".
   Click "Find places".
3. Check "Your taste in Qloo": each love shows the Qloo entity it matched, and "Qloo reads this taste as" lists the ambience words Qloo predicts for them.
4. Check a pick card: the main kind and address, taste fit and popularity from Qloo insights, and "Shares your taste": the place's own qualities that rank highest for your loves.
   "Driven by" is the Qloo explainability share for each love; when the loves count about equally, the card says so instead of drawing a bar.
5. Scroll to "Would a model alone do this?" and click "Run the test".
   The same model names 8 places with no Qloo data, and the test keeps 5 of them, places Qloo can score first.
   Qloo finds them and scores both lists on the same seeds.
   The verdict line gives the averages for fit and popularity, each judged on its own.
   The "Fair test" line ranks again without one love and scores both lists on that love alone.
6. Scroll to "What the agent did".
   Each step shows the service, the result and the time in ms, including how many places are mainly the kind you asked for.
7. Turn on "Skip the famous places" and type "Now bars there.".
   The agent keeps your loves and city, and the popularity of the picks drops.
   Writing "not touristy" in the request has the same effect as the checkbox.
   Then type "Now record stores there.".
   Too few record stores fit under the popularity cap, so the trace shows a second ranking without the cap, and the answer opens with a note that Qloo has few places that are mainly record stores.
8. Click "Forget" to delete what the page remembered.

## Try a city and taste of your own

Any city that Qloo knows works, for example "I love Haruki Murakami and Radiohead. Cafes in Tokyo?".
The 9 venue kinds are restaurant, bar, cafe, hotel, bookstore, record store, museum, art gallery and live music venue.

## As an agent (MCP)

Add this Streamable HTTP MCP server to any MCP client: https://taste-concierge.nguyenhieuec.workers.dev/mcp

Quick check with curl:

```sh
curl -s https://taste-concierge.nguyenhieuec.workers.dev/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Run the code

```sh
git clone <repo>
cd taste-concierge
pnpm install
pnpm test        # offline, replays recorded live Qloo, Tavily and travel calls
```

## If something looks off

The Qloo hackathon key has a burst rate limit.
If the page says "The Qloo taste graph did not answer", wait a minute and try again.
The page never guesses places when Qloo does not answer.
