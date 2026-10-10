// Browser code for the page. It builds every node with textContent, so no API text is ever parsed as HTML.
export const CLIENT_SCRIPT = String.raw`
(function(){
  var EXAMPLES = [
    "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?",
    "Big fan of Studio Ghibli films and Nick Drake. Find me a cafe in Tokyo.",
    "I like Anthony Bourdain and LCD Soundsystem. Bars in Mexico City?",
    "Now record stores there."
  ];
  var VENUE_WORD = {restaurant:"restaurants",bar:"bars",cafe:"cafes",hotel:"hotels",bookstore:"bookstores",record_store:"record stores",museum:"museums",gallery:"galleries",music_venue:"music venues"};

  function h(tag, attrs){
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs){
      if (k === "text") el.textContent = attrs[k];
      else if (k === "class") el.className = attrs[k];
      else if (k.slice(0,2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++){
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function(x){ if (x) el.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }
  function pct(x){ return typeof x === "number" ? Math.round(x * 100) : null; }
  function fmt(x){ return typeof x === "number" ? x.toFixed(2) : "n/a"; }

  function profileId(){
    var id = null;
    try { id = localStorage.getItem("tc-profile"); } catch (e) {}
    if (!id){
      id = "p-" + Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function(b){ return b.toString(16).padStart(2,"0"); }).join("");
      try { localStorage.setItem("tc-profile", id); } catch (e) {}
    }
    return id;
  }
  var PID = profileId();
  var out = document.getElementById("out");
  var msg = document.getElementById("msg");
  var go = document.getElementById("go");

  function health(){
    fetch("/health").then(function(r){ return r.json(); }).then(function(s){
      var el = document.getElementById("health");
      el.textContent = "";
      var nebius = s.llm && s.llm.provider === "nebius";
      el.appendChild(h("span", {class: "dot" + (s.qloo ? "" : " off")}));
      el.appendChild(document.createTextNode(!s.qloo ? "Qloo key missing" : nebius ? "Live: Qloo + Nemotron on Nebius" : "Live Qloo · text by Workers AI"));
      document.getElementById("tagline").textContent = nebius ? "Qloo taste graph + NVIDIA Nemotron" : "Qloo taste graph";
      el.title = s.llm ? (s.llm.router + " / " + s.llm.writer) : "no model";
    }).catch(function(){});
  }

  function memory(){
    fetch("/api/profile/" + PID).then(function(r){ return r.json(); }).then(function(p){
      var box = document.getElementById("memory");
      box.textContent = "";
      if (!p.seeds || !p.seeds.length){ box.classList.add("hidden"); return; }
      box.classList.remove("hidden");
      box.appendChild(h("span", {text: "Remembered:"}));
      box.appendChild(h("b", {text: p.seeds.map(function(s){ return s.name; }).join(", ")}));
      if (p.city) box.appendChild(h("span", {text: "in " + p.city + ". Ask a follow-up like \"now hotels\"."}));
      box.appendChild(h("button", {class: "ghost", type: "button", text: "Forget", onclick: function(){
        fetch("/api/profile/" + PID, {method: "DELETE"}).then(memory);
      }}));
    }).catch(function(){});
  }

  function seedRow(seeds){
    return h("div", {class: "seeds"}, seeds.map(function(s){
      if (!s.found) return h("span", {class: "seed miss", title: "Qloo has no entity for this", text: s.input});
      var kind = (s.type || "").replace("urn:entity:", "").replace("_", " ");
      return h("span", {class: "seed" + (s.weak ? " weak" : ""), title: s.tags.join(", ")},
        h("img", {src: s.image || "", alt: "", loading: "lazy"}), s.name,
        kind ? h("span", {class: "kind", text: kind + (s.weak ? ", little data in Qloo" : "")}) : null);
    }));
  }

  function meter(label, value, title){
    return h("div", {class: "meter", title: title},
      h("span", {text: label}), h("div", {class: "bar"}, h("span", {style: "width:" + (pct(value) || 0) + "%"})), h("span", {class: "num", text: fmt(value)}));
  }

  function tasteRow(words, from){
    if (!words || !words.length) return null;
    var label = from === "picks" ? "What these Qloo picks share" : "Qloo reads this taste as";
    return h("p", {class: "taste"}, h("span", {class: "label", text: label}), words.join(", ").toLowerCase());
  }

  // A 53/47 split on every card says little, so the bar shows only when one love clearly leads.
  function drivers(p){
    if (!p.drivenBy.length) return null;
    var shades = [1, 0.6, 0.35, 0.2, 0.12];
    if (p.drivenBy.length > 1 && p.drivenBy[0].share < 0.55){
      return h("div", {class: "meter", title: "Share of the fit that came from each thing you love"}, h("span", {text: "Driven by"}), h("span", {class: "even", text: "All your loves about equally"}), h("span"));
    }
    var split = h("div", {class: "bar"}, p.drivenBy.map(function(d, j){
      return h("span", {style: "width:" + pct(d.share) + "%;opacity:" + shades[j % shades.length], title: d.name + " " + pct(d.share) + "%"});
    }));
    return [
      h("div", {class: "meter", title: "Share of the fit that came from each thing you love"}, h("span", {text: "Driven by"}), split, h("span")),
      h("div", {class: "drivers"}, p.drivenBy.map(function(d, j){
        return h("span", null, h("i", {style: "opacity:" + shades[j % shades.length]}), d.name + " " + pct(d.share) + "%");
      }))
    ];
  }

  // When Qloo predicts no taste words for the loves, the words come from what the picks share instead.
  function pickCard(p, i, city, from){
    return h("article", {class: "card pick"},
      h("h3", null, h("span", {class: "rank", text: String(i + 1)}), p.name),
      h("p", {class: "addr", text: [p.kind, p.outside ? p.outside + ", outside " + city : null, p.wellKnown ? "well known, added because few lesser-known places fit" : null, p.address].filter(Boolean).join(" · ")}),
      meter("Taste fit", p.affinity, "Qloo affinity of this place to what you love, 0 to 1"),
      meter("Popularity", p.popularity, "Qloo popularity percentile, 0 to 1. Lower means less obvious."),
      drivers(p),
      p.matches && p.matches.length ? h("p", {class: "match"}, h("span", {class: "label", text: from === "picks" ? "Shares with the other picks" : "Shares your taste"}), p.matches.join(", ").toLowerCase()) : null,
      p.tags.length ? h("div", {class: "tags"}, p.tags.map(function(t){ return h("span", {class: "tag", text: t}); })) : null,
      h("div", {class: "links"},
        p.mapUrl ? h("a", {href: p.mapUrl, target: "_blank", rel: "noopener", text: "Open in Maps"}) : null,
        p.website ? h("a", {href: p.website, target: "_blank", rel: "noopener", text: "Website"}) : null));
  }

  function travelCard(t){
    if (!t) return null;
    if (t.status !== "ok") return h("div", {class: "card"}, h("p", {class: "label", text: "Travel advice"}), h("p", {class: "muted", text: "Not available for " + t.country + "."}));
    return h("div", {class: "card"}, h("p", {class: "label", text: "Travel advice · " + t.country}),
      t.usLevelText ? h("p", null, t.usUrl ? h("a", {href: t.usUrl, target: "_blank", rel: "noopener", text: "US: " + t.usLevelText}) : "US: " + t.usLevelText) : null,
      t.ukText ? h("p", null, t.ukUrl ? h("a", {href: t.ukUrl, target: "_blank", rel: "noopener", text: "UK: " + t.ukText}) : "UK: " + t.ukText) : null);
  }

  function liveCard(l){
    if (!l) return null;
    return h("div", {class: "card"}, h("p", {class: "label", text: "On now · Tavily"}),
      l.status !== "ok" ? h("p", {class: "muted", text: l.note || "Not available."}) :
      !l.items.length ? h("p", {class: "muted", text: "Nothing on this month names the city and one of your loves."}) :
      h("div", null, l.items.slice(0, 3).map(function(it){
        return h("p", null, h("a", {href: it.url, target: "_blank", rel: "noopener", text: it.title}));
      })));
  }

  function traceList(trace){
    return h("ol", {class: "trace card"}, trace.map(function(t){
      return h("li", null, h("span", {text: t.step}), h("span", {class: "ms", text: t.ms + " ms"}), h("span", {class: "p", text: t.provider}), h("span", {class: "d", text: t.detail}));
    }));
  }

  function proofSection(r){
    var box = h("div", {id: "proof"});
    var btn = h("button", {class: "ghost", type: "button", text: "Run the test: same question, model only, no Qloo"});
    btn.addEventListener("click", function(){
      btn.disabled = true; btn.textContent = "Asking the model alone, then scoring both lists in Qloo...";
      fetch("/api/proof", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
        seeds: r.seeds.filter(function(s){ return s.found; }).map(function(s){ return {name: s.name, entityId: s.entityId}; }),
        venue: r.plan.venue, city: r.plan.city, lessObvious: r.plan.lessObvious === true,
        qlooPickIds: r.picks.map(function(p){ return p.entityId; })
      })}).then(function(x){ return x.json(); }).then(function(b){ box.textContent = ""; box.appendChild(proofTable(b)); })
        .catch(function(){ btn.disabled = false; btn.textContent = "The test failed. Try again"; });
    });
    box.appendChild(btn);
    return box;
  }

  function proofTable(b){
    if (b.status !== "ok" || !b.summary) return h("p", {class: "muted", text: b.error || "The test is not available right now."});
    var s = b.summary;
    if (!s.llmFound) return h("div", {class: "card"}, h("p", {class: "verdict", text: "Qloo could not score any of the model's places, so there is no fair comparison for this request."}),
      h("p", {class: "muted", text: "Qloo search knows these names, but its taste index has no score for them. Model: " + b.by + "."}),
      h("div", {class: "scroll"}, h("table", null, h("tbody", null, rows(b.llmOnly, "Model only")))));
    var fit = s.qlooAffinity > s.llmAffinity ? "Qloo picks fit this taste better" : "The model-only list fit as well or better";
    var fame = s.qlooPopularity < s.llmPopularity ? "and they are less obvious" : "and they are not less obvious";
    var verdict = fit + " (fit " + fmt(s.qlooAffinity) + " against " + fmt(s.llmAffinity) + "), " + fame + " (popularity " + fmt(s.qlooPopularity) + " against " + fmt(s.llmPopularity) + ")." +
      (s.llmFound < 3 ? " Only " + s.llmFound + " model place" + (s.llmFound === 1 ? "" : "s") + " could be scored, so this result is weak." : "");
    return h("div", {class: "card"},
      h("p", {class: "verdict", text: verdict}),
      heldOutLine(b.heldOut),
      h("p", {class: "muted", text: (b.modelNamed > b.llmOnly.length ? "The model named " + b.modelNamed + " places; the test keeps " + b.llmOnly.length + " of them, places Qloo can score first, in the model's order. " : "") + s.llmFound + " of " + b.llmOnly.length + " model-only places were found and scored in Qloo. Qloo scores both lists on the same loves. Model: " + b.by + "."}),
      h("div", {class: "scroll"}, h("table", null,
        h("thead", null, h("tr", null, h("th", {text: "Source"}), h("th", {text: "Place"}), h("th", {text: "Fit"}), h("th", {text: "Popularity"}))),
        h("tbody", null, rows(b.llmOnly, "Model only"), rows(b.qloo, "Qloo")))));
  }

  function rows(list, who){
    return list.map(function(p){
      var note = !p.found ? " (not found in Qloo)" : p.affinity == null ? " (in Qloo, no score)" : "";
      return h("tr", null, h("td", {text: who}), h("td", {text: p.name + note}), h("td", {class: "n", text: fmt(p.affinity)}), h("td", {class: "n", text: fmt(p.popularity)}));
    });
  }

  // Qloo ranks its own picks by fit, so this is the fair half of the test: a love the ranking never saw.
  function heldOutLine(folds){
    if (!folds || !folds.length) return null;
    var wins = folds.filter(function(f){ return f.qlooAffinity > f.llmAffinity; }).length;
    return h("p", null, h("b", {text: "Fair test: "}),
      "Qloo ranked again without one love, then both lists were scored on that love alone. Qloo wins " + wins + " of " + folds.length + ": " +
      folds.map(function(f){ return f.seed + " " + fmt(f.qlooAffinity) + " against " + fmt(f.llmAffinity); }).join("; ") + ".");
  }

  function render(r){
    out.textContent = "";
    if (r.error){ out.appendChild(h("div", {class: "card reply", text: "Something failed: " + r.error})); return; }
    // One paragraph per line, so the taste line and each pick read as separate lines.
    var lines = r.reply.split("\n").filter(function(l){ return l.trim(); }).map(function(l){ return h("p", {class: "line", text: l}); });
    out.appendChild(h("div", {class: "card reply"}, lines, h("p", {class: "by", text: "Written by " + r.replyBy + (r.usedProfile ? " · used your remembered taste" : "")})));
    if (r.seeds && r.seeds.length){
      out.appendChild(h("h2", {text: "Your taste in Qloo"}));
      out.appendChild(seedRow(r.seeds));
      var taste = tasteRow(r.taste, r.tasteFrom);
      if (taste) out.appendChild(taste);
    }
    if (r.picks && r.picks.length){
      out.appendChild(h("h2", {text: (VENUE_WORD[r.plan.venue] || "Places").replace(/^./, function(c){ return c.toUpperCase(); }) + " in " + (r.plan.country ? r.plan.city + ", " + r.plan.country : r.plan.city) + (r.plan.lessObvious ? ", less obvious" : "")}));
      out.appendChild(h("div", {class: "picks"}, r.picks.map(function(p, i){ return pickCard(p, i, r.plan.city, r.tasteFrom); })));
      out.appendChild(h("h2", {text: "Would a model alone do this?"}));
      out.appendChild(proofSection(r));
    }
    if (r.travel || r.live){
      out.appendChild(h("h2", {text: "Before you go"}));
      out.appendChild(h("div", {class: "side"}, travelCard(r.travel), liveCard(r.live)));
    }
    if (r.trace && r.trace.length){
      out.appendChild(h("h2", {text: "What the agent did"}));
      out.appendChild(traceList(r.trace));
    }
  }

  function ask(text){
    if (!text.trim()) return;
    go.disabled = true; go.textContent = "Searching...";
    out.textContent = "";
    out.appendChild(h("p", {class: "muted reply", text: "Reading your request, finding your taste in Qloo, ranking places..."}));
    fetch("/api/ask", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({message: text, profileId: PID, lessObvious: document.getElementById("obscure").checked})})
      .then(function(r){ return r.json(); }).then(function(r){ render(r); memory(); })
      .catch(function(e){ render({error: String(e)}); })
      .finally(function(){ go.disabled = false; go.textContent = "Find places"; });
  }

  document.getElementById("ask").addEventListener("submit", function(e){ e.preventDefault(); ask(msg.value); });
  msg.addEventListener("keydown", function(e){ if (e.key === "Enter" && !e.shiftKey){ e.preventDefault(); ask(msg.value); } });
  var ex = document.getElementById("examples");
  EXAMPLES.forEach(function(t){ ex.appendChild(h("button", {class: "chip", type: "button", text: t, onclick: function(){ msg.value = t; ask(t); }})); });
  health(); memory();
})();
`;
