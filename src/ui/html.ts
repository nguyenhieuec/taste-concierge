import { CLIENT_SCRIPT } from "./client.ts";

const STYLE = `
:root{--bg:#FBFBF9;--fg:#1D1D1B;--muted:#5C5C57;--accent:#0B5CAD;--card-bg:#FFFFFF;--rail-bg:#F5F5F0;--line:#DCDCD4;--code:#F0F0EA;--badge-bg:#E8F0FE;--badge-fg:#1A5BB8;--on-accent:#FFFFFF;--ok:#10B981;--alert:#B45309;--down:#B42318;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--fg:#ECECE6;--muted:#A3A39B;--accent:#6DB3F2;--card-bg:#222220;--rail-bg:#1B1B1A;--line:#333331;--code:#2A2A28;--badge-bg:#1D2A3A;--badge-fg:#9CC8F5;--on-accent:#151514;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}a:hover{text-decoration:underline}
.wrap{max-width:48rem;margin:0 auto;padding:40px 16px 64px}
.top{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:24px;font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.top .live{display:flex;align-items:center;gap:8px;overflow:hidden;text-overflow:ellipsis}
.dot{width:8px;height:8px;border-radius:999px;background:var(--ok);flex:none}.dot.off{background:var(--alert)}
h1{font-size:clamp(2rem,6vw,2.5rem);font-weight:650;line-height:1.12;letter-spacing:-.025em;margin:0 0 16px}
h2{font-size:1.375rem;font-weight:620;line-height:1.3;letter-spacing:-.012em;margin:40px 0 16px}
.lede{font-size:1.125rem;line-height:1.55;color:var(--muted);margin:0 0 24px}
.label{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
form{display:flex;gap:8px}
textarea{flex:1;min-height:56px;resize:vertical;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--card-bg);color:var(--fg);font:inherit}
textarea:focus,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;cursor:pointer;border-radius:8px}
.go{background:var(--accent);color:var(--on-accent);border:0;padding:8px 24px;font-weight:600}
.go:disabled{opacity:.6;cursor:wait}
.ghost{background:transparent;border:1px solid var(--line);color:var(--fg);padding:4px 16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}
.chip{border:1px solid var(--line);background:var(--card-bg);color:var(--fg);border-radius:999px;padding:4px 16px;font-size:.875rem}
.toggle{display:flex;align-items:center;gap:8px;margin-top:16px;font-size:.875rem;color:var(--muted)}
.toggle input{accent-color:var(--accent);width:16px;height:16px}
.memory{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:16px;font-size:.875rem;color:var(--muted)}
.memory b{color:var(--fg);font-weight:600}
.card{background:var(--card-bg);border:1px solid var(--line);border-radius:8px;padding:16px}
.reply{white-space:pre-line;margin-top:24px}
.reply .line{margin:0 0 8px}
.by{font-size:.8125rem;color:var(--muted);margin-top:8px}
.seeds{display:flex;flex-wrap:wrap;gap:8px}
.seed{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:4px 16px 4px 4px;background:var(--card-bg);font-size:.875rem}
.seed img{width:28px;height:28px;border-radius:999px;object-fit:cover;background:var(--code)}
.seed.miss{padding-left:16px;color:var(--muted);text-decoration:line-through}
.seed .kind{color:var(--muted);font-size:.8125rem}
.seed.weak{border-style:dashed}
.picks{display:grid;gap:16px}
.pick h3{margin:0;font-size:1.0625rem;font-weight:620;letter-spacing:-.01em}
.pick .addr{color:var(--muted);font-size:.875rem;margin:4px 0 16px}
.rank{color:var(--muted);font-weight:600;margin-right:8px}
.meter{display:grid;grid-template-columns:7rem 1fr 3rem;align-items:center;gap:8px;font-size:.8125rem;color:var(--muted);margin-bottom:8px}
.bar{height:8px;border-radius:999px;background:var(--code);overflow:hidden;display:flex}
.bar span{display:block;height:100%;background:var(--accent)}
.bar span+span{border-left:2px solid var(--card-bg)}
.num{text-align:right;color:var(--fg);font-variant-numeric:tabular-nums}
.drivers{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.8125rem;color:var(--muted);margin:0 0 8px 7rem;padding-left:8px}
.drivers i{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--accent);margin-right:4px}
.match,.taste{font-size:.875rem;margin:8px 0}
.match .label,.taste .label{display:block;margin:0 0 4px}
.taste{margin:16px 0 0}
.meter .even{font-size:.8125rem;color:var(--muted)}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
.tag{background:var(--code);border-radius:4px;padding:0 8px;font-size:.8125rem;color:var(--muted)}
.links{display:flex;gap:16px;font-size:.875rem}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.scroll{overflow-x:auto}
.verdict{font-weight:600;margin:0 0 16px}
.side{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.trace{list-style:none;margin:0;padding:0 16px;font-size:.875rem}
.trace li{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:8px 0;border-bottom:1px solid var(--line)}
.trace li:last-child{border:0}
.trace .p{color:var(--muted);font-size:.8125rem;grid-column:1}
.trace .d{color:var(--muted);font-size:.8125rem;grid-column:1/3;overflow-wrap:anywhere}
.trace .ms{font-variant-numeric:tabular-nums;color:var(--muted);grid-row:1;grid-column:2}
.muted{color:var(--muted)}
.hidden{display:none}
.foot{margin-top:64px;font-size:.8125rem;color:var(--muted)}
@media (max-width:600px){form{flex-direction:column}.go{padding:16px}.side{grid-template-columns:1fr}.meter{grid-template-columns:5.5rem 1fr 2.5rem}.drivers{margin-left:0;padding:0}.top .tagline{display:none}}
`;

export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Taste Concierge</title>
<meta name="description" content="Name what you love. Get real places in a city that fit it, with the reason for each pick and a test against an answer with no taste data.">
<style>${STYLE}</style>
</head>
<body>
<main class="wrap">
  <div class="top"><span class="tagline" id="tagline">Qloo taste graph</span><span class="live" id="health"><span class="dot off"></span>Checking</span></div>
  <h1>Taste Concierge</h1>
  <p class="lede">Name a film, a band or a book you love and a city. You get real places that fit that taste, the share each of your tastes had in every pick, and a test against an answer from a model with no taste data.</p>
  <form id="ask">
    <label for="msg" class="hidden">Your request</label>
    <textarea id="msg" name="msg" placeholder="I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?"></textarea>
    <button class="go" id="go" type="submit">Find places</button>
  </form>
  <label class="toggle"><input type="checkbox" id="obscure"> Skip the famous places (Qloo popularity under 0.7)</label>
  <div class="chips" id="examples"></div>
  <div class="memory hidden" id="memory"></div>
  <section id="out" aria-live="polite"></section>
  <p class="foot">Places, affinity, popularity and per-seed shares come from the Qloo Insights API. The language model only reads the request and writes the text, and it may only name places Qloo returned. Travel advice comes from the UK FCDO and US State Department through the OpenKrill travel MCP. Fresh results come from Tavily. Source: MIT licence.</p>
</main>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
