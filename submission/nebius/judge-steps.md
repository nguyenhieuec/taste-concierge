# Judge steps

These steps take under 3 minutes and need no account or key.

## On the live demo

1. Open https://taste-concierge.nguyenhieuec.workers.dev.
   The top right says what is live, for example "Live Qloo, fallback model on Workers AI".
   The dot is green only when both Qloo and Nemotron on Nebius are live.
2. Click the first example, or type: "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?".
   Click "Find places".
3. Check "Your taste in Qloo": each seed shows the Qloo entity it matched.
4. Check a pick card: taste fit and popularity come from Qloo insights, and "Driven by" is the Qloo explainability share for each seed.
5. Scroll to "Would a model alone do this?" and click "Run the test".
   The same model names 5 places with no Qloo data.
   Qloo finds them and scores both lists on the same seeds.
   The verdict line gives the averages.
6. Scroll to "What the agent did".
   Each step shows the service, the result and the time in ms.
7. Turn on "Skip the famous places" and type "Now record stores there.".
   The agent keeps your seeds and city, and the popularity of the picks drops.
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
