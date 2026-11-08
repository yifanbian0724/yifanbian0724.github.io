/* Feelings explorer: the flower, one family at a time, a word's card, and every word in a list.
 * Reads window.FEELINGS_DATA (data/feelings.js, generated from the app's vocabulary). */
(function () {
  "use strict";

  var D = window.FEELINGS_DATA;
  var CONF = window.FEELINGS_EXPLORER || {};
  if (!D || !window.Clay || !window.Flower) return;
  var UI = D.ui;
  var DURATIONS = ["moments", "minutes", "hours", "days"];
  var STRENGTHS = ["mild", "moderate", "strong", "intense"];
  var reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // -------------------------------------------------------------------------------------------
  // The vocabulary, indexed

  var famById = {}, wordById = {}, appOrder = {};
  D.families.forEach(function (f) { famById[f.id] = f; });
  D.words.forEach(function (w, i) { wordById[w.id] = w; appOrder[w.id] = i; });

  /** A family's words, faint to intense (ties in the app's own order). */
  var byFamily = {};
  D.families.forEach(function (f) {
    byFamily[f.id] = D.words.filter(function (w) { return w.family === f.id; })
      .sort(function (a, b) { return a.intensity - b.intensity || appOrder[a.id] - appOrder[b.id]; });
  });
  function statesIn(fid) { return byFamily[fid] || []; }

  function pairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
  var contrastIndex = {}, partners = {};
  D.contrasts.forEach(function (c) {
    contrastIndex[pairKey(c.a, c.b)] = c;
    (partners[c.a] = partners[c.a] || []).push(c.b);
    (partners[c.b] = partners[c.b] || []).push(c.a);
  });
  var odd = {};
  D.words.forEach(function (w) { if (w.odd) odd[w.id] = true; });

  /** The curated comparison of two words, oriented so that a comes first; null if none. */
  function contrast(a, b) {
    var c = contrastIndex[pairKey(a, b)];
    if (!c) return null;
    return c.a === a ? c : { a: c.b, b: c.a, summary: c.summary, aPoints: c.bPoints, bPoints: c.aPoints };
  }

  /** The two families either side of one on the compass. */
  function adjacentFamilies(fid) {
    var ring = D.families.slice().sort(function (a, b) { return a.angle - b.angle; });
    var i = ring.findIndex(function (f) { return f.id === fid; });
    if (ring.length < 2 || i < 0) return [];
    var before = ring[(i - 1 + ring.length) % ring.length], after = ring[(i + 1) % ring.length];
    return before.id === after.id ? [before] : [before, after];
  }

  /** "Or is it more like...": the app's own order. Neighbours in strength within the family,
   *  then every curated comparison, then further along the family, then nearby families. */
  function neighbours(id) {
    var s = wordById[id], out = [];
    function add(c) { if (c && c.id !== id && out.indexOf(c) < 0) out.push(c); }
    var skipOdd = !odd[id];
    var same = statesIn(s.family).filter(function (w) { return w.id === id || !(skipOdd && odd[w.id]); });
    var i = same.findIndex(function (w) { return w.id === id; });
    if (i > 0) add(same[i - 1]);
    if (i + 1 < same.length) add(same[i + 1]);
    (partners[id] || []).forEach(function (p) { add(wordById[p]); });
    [2, 3].forEach(function (step) {
      if (out.length >= 3) return;
      [i - step, i + step].forEach(function (j) { if (j >= 0 && j < same.length) add(same[j]); });
    });
    if (out.length >= 3) return out;
    var own = famById[s.family].valence;
    function compatible(v) { return v === 0 || own === 0 || (v > 0) === (own > 0); }
    var adjacent = adjacentFamilies(s.family);
    var matching = adjacent.filter(function (f) { return compatible(f.valence); });
    var pools = (matching.length ? matching : adjacent).map(function (f) {
      return statesIn(f.id).filter(function (w) { return !odd[w.id]; })
        .sort(function (a, b) { return Math.abs(a.intensity - s.intensity) - Math.abs(b.intensity - s.intensity); });
    });
    for (var round = 0; out.length < 3 && pools.some(function (p) { return round < p.length; }); round++) {
      pools.forEach(function (p) { if (round < p.length && out.length < 3) add(p[round]); });
    }
    return out;
  }

  var lookCache = {};
  function look(w) { return lookCache[w.id] || (lookCache[w.id] = Clay.look(w, famById[w.family])); }

  // -------------------------------------------------------------------------------------------
  // Small DOM helpers

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  var ICONS = {
    moments: '<path d="M8.6 1.6 3.5 8.7h3.6l-.9 5.7 5.3-7.4H7.8z"/>',
    minutes: '<circle cx="8" cy="9" r="5.4"/><path d="M8 9V6.2M6.4 1.8h3.2M12.4 4.6l.9-.9"/>',
    hours: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.6"/>',
    days: '<rect x="2" y="3.2" width="12" height="11" rx="2"/><path d="M2 6.6h12M5.2 1.6v3M10.8 1.6v3"/>',
    past: '<path d="M6 3.4 2.8 6.4 6 9.4"/><path d="M3 6.4h6.4a3.8 3.8 0 0 1 0 7.6H7"/>',
    present: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none"/>',
    future: '<path d="M2.5 8h10M9 4.4 12.6 8 9 11.6"/>',
    ongoing: '<path d="M3 6.2a5 5 0 0 1 9.2-1.6M13 9.8a5 5 0 0 1-9.2 1.6"/><path d="M12.6 1.8v3h-3M3.4 14.2v-3h3"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    search: '<circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4 14 14"/>'
  };
  function icon(name) {
    var s = el("span", { class: "icon", "aria-hidden": "true" });
    s.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>";
    return s;
  }

  /** Four bars, filled up to how strong a word usually is. */
  function bars(w) {
    var s = el("span", { class: "bars", "aria-hidden": "true" });
    var k = STRENGTHS.indexOf(w.strength);
    STRENGTHS.forEach(function (_, i) {
      s.appendChild(el("i", { class: i <= k ? "on" : "", style: "height:" + (4 + 2.5 * i) + "px" }));
    });
    return s;
  }

  function famDot(f) { return el("span", { class: "dot", style: "background:" + f.color, "aria-hidden": "true" }); }

  /** A clay character in a box of `size` px. */
  function character(w, size, opts) {
    opts = opts || {};
    var box = el("span", { class: "clay", style: "width:" + size + "px;height:" + size + "px", "aria-hidden": "true" });
    var item = Clay.mount(box, look(w), { size: size, intensity: opts.intensity == null ? w.intensity : opts.intensity,
                                          rest: opts.rest, seed: opts.seed || 0, animate: opts.animate !== false });
    box.__item = item;
    return box;
  }

  function cueText(w) { return UI["lasts." + w.duration] + ", " + UI["usually." + w.strength].toLowerCase(); }

  /** The two cues in a few words, for lists: "lasts hours · moderate". */
  function shortCues(w) {
    var lasts = UI["lasts." + w.duration].replace(/^Usually /, "");
    lasts = lasts.charAt(0).toLowerCase() + lasts.slice(1);
    return el("span", { class: "row__cues" }, [
      el("span", { class: "cue" }, [icon(w.duration), lasts]),
      el("span", { class: "sep", text: "·" }),
      el("span", { class: "cue" }, [bars(w), UI["strength." + w.strength]])
    ]);
  }

  function smooth() { return reduceMotion.matches ? "auto" : "smooth"; }

  // -------------------------------------------------------------------------------------------
  // The page's numbers and links

  var snapshot = new Date(D.snapshot + "T12:00:00");
  var monthYear = snapshot.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  document.querySelectorAll("[data-count]").forEach(function (n) {
    var what = n.getAttribute("data-count");
    n.textContent = what === "families" ? D.families.length : what === "words" ? D.words.length
      : what === "comparisons" ? D.contrasts.length : what === "snapshot" ? monthYear : "";
  });
  // On the site (tools/feelings/) the link stays relative; anywhere else it goes to the live site.
  var appLink = /\/tools\/feelings\/?/.test(location.pathname) ? CONF.appLink : (CONF.appLinkElsewhere || CONF.appLink);
  document.querySelectorAll("[data-app-link]").forEach(function (a) { if (appLink) a.setAttribute("href", appLink); });
  var supportNote = document.getElementById("support-note");
  if (supportNote) supportNote.textContent = D.supportNote;

  // -------------------------------------------------------------------------------------------
  // The flower and the list of families beside it

  var state = { family: null, word: null, compare: null, opener: null };
  var flowerBox = document.getElementById("flower");
  var flower = Flower.create(flowerBox, D, {
    statesIn: statesIn,
    faceLook: function (f) { return look(wordById[f.face] || statesIn(f.id)[0]); },
    onFamily: function (id) { selectFamily(id, true); }
  });

  var familyList = document.getElementById("family-list");
  D.families.forEach(function (f) {
    var b = el("button", { type: "button", class: "fam-chip", "data-family": f.id, "aria-pressed": "false",
                           onclick: function () { selectFamily(f.id, true); } },
      [famDot(f), el("span", { text: f.label }), el("span", { class: "fam-chip__n", text: String(statesIn(f.id).length) })]);
    familyList.appendChild(el("li", null, [b]));
  });

  // -------------------------------------------------------------------------------------------
  // One family: its words placed by how long each usually lasts and how strong it usually is

  var panel = document.getElementById("family-panel");
  var announcer = document.getElementById("announce");
  var hoverCard = null;
  function announce(text) { if (announcer) { announcer.textContent = ""; setTimeout(function () { announcer.textContent = text; }, 60); } }

  function selectFamily(id, fromUser) {
    if (!famById[id]) return;
    var changed = state.family !== id;
    state.family = id;
    flower.select(id);
    familyList.querySelectorAll(".fam-chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-family") === id ? "true" : "false");
    });
    if (changed) renderFamily(famById[id]);
    if (fromUser) {
      announce(famById[id].label + ": " + statesIn(id).length + " words, by how long each usually lasts and how strong it usually is.");
      setHash("family=" + id);
      var top = panel.getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6 || top < -panel.offsetHeight / 2) panel.scrollIntoView({ behavior: smooth(), block: "start" });
    }
  }

  function renderFamily(f) {
    panel.innerHTML = "";
    panel.style.setProperty("--fam", f.color);
    var words = statesIn(f.id);
    var head = el("header", { class: "family__head" }, [
      el("p", { class: "eyebrow", text: "Family of feelings" }),
      el("h2", { id: "family-title", class: "family__title" }, [famDot(f), f.label]),
      el("p", { class: "family__summary", text: f.summary })
    ]);

    var field = el("div", { class: "field", role: "group", "aria-labelledby": "family-title", "aria-describedby": "field-how" });
    field.appendChild(el("p", { id: "field-how", class: "sr-only",
      text: "Each word is placed by how long the feeling usually lasts, from moments on the left to days on the right, and how strong it usually is, from mild at the bottom to intense at the top." }));
    var stars = el("canvas", { class: "field__stars", "aria-hidden": "true" });
    field.appendChild(stars);
    var grid = el("div", { class: "field__grid" });
    grid.appendChild(el("div", { class: "field__corner", "aria-hidden": "true", title: "Higher up: usually stronger" }, [el("span", { class: "arrow", text: "↑" })]));
    DURATIONS.forEach(function (d) {
      grid.appendChild(el("div", { class: "field__col", "aria-hidden": "true" }, [icon(d), el("span", { text: UI["duration." + d] })]));
    });
    var index = 0;
    STRENGTHS.slice().reverse().forEach(function (s) {
      grid.appendChild(el("div", { class: "field__row", "aria-hidden": "true" }, [el("span", { text: UI["strength." + s] })]));
      DURATIONS.forEach(function (d) {
        var cell = el("div", { class: "field__cell", "data-strength": s, "data-duration": d });
        words.filter(function (w) { return w.strength === s && w.duration === d; })
          .sort(function (a, b) { return b.intensity - a.intensity; })
          .forEach(function (w) { cell.appendChild(node(w, index++)); });
        grid.appendChild(cell);
      });
    });
    field.appendChild(grid);
    field.appendChild(el("p", { class: "field__axis", "aria-hidden": "true" }, [el("span", { text: "How long it usually lasts" }), el("span", { class: "arrow", text: "→" })]));
    hoverCard = el("div", { class: "hover-card", "aria-hidden": "true", hidden: true });
    field.appendChild(hoverCard);

    var legend = el("p", { class: "field__legend",
      text: "Further right, it usually lasts longer; higher up, it is usually stronger. In the moment, any feeling can be milder or stronger, shorter or longer. Tap a word for its card." });

    var more = el("details", { class: "family__more" }, [
      el("summary", { text: "What feelings like these can do" }),
      el("p", { text: f.function }),
      el("div", { class: "family__lists" }, [
        el("div", null, [el("h3", { text: UI["often.after"] }), el("ul", null, f.triggers.map(function (t) { return el("li", { text: t }); }))]),
        el("div", null, [el("h3", { text: UI["often.want"] }), el("ul", null, f.actions.map(function (t) { return el("li", { text: t }); }))])
      ])
    ]);

    panel.appendChild(head);
    panel.appendChild(field);
    panel.appendChild(legend);
    panel.appendChild(more);
    Clay.clock.prune();
    drawStars(stars, f);
  }

  function node(w, i) {
    var small = window.innerWidth < 560;
    var b = el("button", { type: "button", class: "node", "data-word": w.id, "aria-label": w.label + ": " + cueText(w),
                           onclick: function () { openWord(w.id, b); } },
      [character(w, small ? 32 : 40, { seed: i * 0.7, rest: 0.25, animate: false }), el("span", { class: "node__name", text: w.label })]);
    // Still, as in the app's family view; the word being pointed at moves the way it feels.
    var face = b.firstChild.__item;
    b.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") { showHover(w, b); face.wake(true); } });
    b.addEventListener("pointerleave", function () { hideHover(); face.wake(false); });
    b.addEventListener("focus", function () { if (b.matches(":focus-visible")) { showHover(w, b); face.wake(true); } });
    b.addEventListener("blur", function () { hideHover(); face.wake(false); });
    return b;
  }

  /** What a word means, beside it while pointed at (the app's sky does the same). */
  function showHover(w, anchor) {
    if (!hoverCard) return;
    hoverCard.innerHTML = "";
    hoverCard.appendChild(el("p", { class: "hover-card__name", text: w.label }));
    hoverCard.appendChild(el("p", { class: "hover-card__gloss", text: w.gloss }));
    hoverCard.appendChild(el("p", { class: "hover-card__cues" }, [icon(w.duration), UI["lasts." + w.duration], el("span", { class: "sep", text: "·" }), bars(w), UI["usually." + w.strength]]));
    hoverCard.hidden = false;
    var field = hoverCard.parentNode, fb = field.getBoundingClientRect(), ab = anchor.getBoundingClientRect();
    var cw = hoverCard.offsetWidth, ch = hoverCard.offsetHeight;
    var x = ab.left - fb.left + ab.width / 2 - cw / 2;
    x = Math.max(8, Math.min(x, fb.width - cw - 8));
    var above = ab.top - fb.top - ch - 8;
    var y = above > 8 ? above : ab.bottom - fb.top + 8;
    hoverCard.style.transform = "translate(" + x + "px," + y + "px)";
  }
  function hideHover() { if (hoverCard) hoverCard.hidden = true; }

  /** Small background stars, placed the way the app's night sky places them. */
  function drawStars(canvas, f) {
    function paint() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      var ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var tint = Clay.hex(f.color);
      var g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) * 0.6);
      g.addColorStop(0, Clay.rgba(tint, 0.20));
      g.addColorStop(1, Clay.rgba(tint, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 120; i++) {
        var x = ((i * 97 + 31) % 997) / 997 * w;
        var y = ((i * 61 + i * i * 7) % 991) / 991 * h;
        var d = i % 9 === 0 ? 2.2 : (i % 3 === 0 ? 1.5 : 1);
        ctx.fillStyle = "rgba(255,255,255," + (i % 4 === 0 ? 0.5 : 0.2) + ")";
        ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    requestAnimationFrame(paint);
    if ("ResizeObserver" in window) new ResizeObserver(paint).observe(canvas);
  }

  // -------------------------------------------------------------------------------------------
  // A word's card

  var dialog = document.getElementById("word-card");
  var cardBody = dialog.querySelector(".card__body");
  dialog.querySelector(".card__close").addEventListener("click", function () { dialog.close(); });
  dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener("close", function () {
    document.documentElement.classList.remove("has-dialog");
    state.word = null;
    flower.mark(null);
    cardBody.innerHTML = "";
    Clay.clock.prune();
    setHash(state.family ? "family=" + state.family : "");
    if (state.opener && state.opener.isConnected) state.opener.focus();
  });

  function openWord(id, opener) {
    var w = wordById[id];
    if (!w) return;
    if (opener) state.opener = opener;
    if (state.family !== w.family) selectFamily(w.family, false);
    state.word = id;
    var cp = partners[id] && partners[id][0];
    state.compare = cp || (neighbours(id)[0] || {}).id || null;
    renderCard(w);
    flower.mark(id);
    setHash("word=" + id);
    if (!dialog.open) {
      document.documentElement.classList.add("has-dialog");
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    }
    dialog.querySelector(".card__scroll").scrollTop = 0;
    var title = document.getElementById("card-title");
    if (title) title.focus({ preventScroll: true });
  }

  function renderCard(w) {
    var f = famById[w.family];
    cardBody.innerHTML = "";
    dialog.style.setProperty("--fam", f.color);
    var hero = el("div", { class: "card__hero" }, [
      el("span", { class: "card__glow", style: "--k:" + w.intensity }),
      character(w, 96, {})
    ]);
    var text = el("div", { class: "card__text" }, [
      el("p", { class: "card__family" }, [famDot(f), f.label]),
      el("h2", { id: "card-title", class: "card__title", tabindex: "-1", text: w.label }),
      el("p", { class: "card__gloss", text: w.gloss })
    ]);
    cardBody.appendChild(el("header", { class: "card__head" }, [hero, text]));

    cardBody.appendChild(el("ul", { class: "cues", "aria-label": "How this feeling usually goes" }, [
      el("li", null, [icon(w.duration), UI["lasts." + w.duration]]),
      el("li", null, [bars(w), UI["usually." + w.strength]]),
      el("li", null, [icon(w.orientation), UI["about." + w.orientation]])
    ]));

    var ladder = statesIn(w.family).slice().sort(function (a, b) { return a.intensity - b.intensity || (a.id < b.id ? -1 : 1); });
    var i = ladder.indexOf(w);
    if (ladder.length > 2) {
      var span = window.innerWidth < 560 ? 3 : 5;       // long names need the room on a phone
      var lo = Math.max(0, Math.min(i - Math.floor(span / 2), ladder.length - span)), hi = Math.min(ladder.length, lo + span);
      var rungs = ladder.slice(lo, hi).map(function (x) {
        var here = x === w;
        return el("li", null, [el("button", { type: "button", class: "rung" + (here ? " is-here" : ""), "aria-current": here ? "true" : null,
                                               disabled: here ? true : null, onclick: function () { openWord(x.id); } },
          [character(x, Math.round(18 + 18 * x.intensity), { intensity: 0, animate: false }), el("span", { text: x.label })])]);
      });
      cardBody.appendChild(el("section", { class: "ladder", "aria-labelledby": "ladder-title" }, [
        el("h3", { id: "ladder-title", class: "card__h3", text: UI.ladder }),
        el("div", { class: "ladder__row" }, [
          el("span", { class: "ladder__end", text: UI["ladder.milder"] }),
          el("ol", { class: "ladder__rungs" }, rungs),
          el("span", { class: "ladder__end", text: UI["ladder.stronger"] })
        ])
      ]));
    }

    if (w.support) cardBody.appendChild(el("p", { class: "support", role: "note", text: D.supportNote }));

    var list = neighbours(w.id).slice(0, 4);
    if (state.compare && !list.some(function (n) { return n.id === state.compare; })) list.unshift(wordById[state.compare]);
    if (list.length) {
      var chips = el("div", { class: "compare__chips", role: "group", "aria-label": "Close words" }, list.map(function (n) {
        return el("button", { type: "button", class: "chip", "aria-pressed": n.id === state.compare ? "true" : "false", "data-word": n.id,
                              onclick: function () { state.compare = n.id; renderCompare(w); announce("Comparing " + w.label + " and " + n.label + "."); } },
          [character(n, 24, { intensity: 0, animate: false }), el("span", { text: n.label })]);
      }));
      cardBody.appendChild(el("section", { class: "compare", "aria-labelledby": "compare-title" }, [
        el("h3", { id: "compare-title", class: "card__h3", text: UI.orIsIt }),
        chips,
        el("div", { class: "compare__duo" })
      ]));
      renderCompare(w);
    }

    cardBody.appendChild(el("p", { class: "card__foot" }, [
      "From the feelings vocabulary in Self-Discovery, an app in development. ",
      el("a", { href: appLink || "#about", text: "About the app" })
    ]));
    Clay.clock.prune();
  }

  /** Two close feelings side by side, each moving its own way, with the line that tells them apart. */
  function renderCompare(a) {
    var duo = cardBody.querySelector(".compare__duo");
    if (!duo) return;
    var b = wordById[state.compare];
    cardBody.querySelectorAll(".compare__chips .chip").forEach(function (c) {
      c.setAttribute("aria-pressed", c.getAttribute("data-word") === state.compare ? "true" : "false");
    });
    duo.innerHTML = "";
    if (!b) return;
    var c = contrast(a.id, b.id);
    var diff = { duration: a.duration !== b.duration, strength: a.strength !== b.strength };
    function column(s, line, seed) {
      var cues = el("p", { class: "duo__cues" }, [
        el("span", { class: diff.duration ? "is-diff" : "" }, [icon(s.duration), UI["lasts." + s.duration]]),
        el("span", { class: diff.strength ? "is-diff" : "" }, [bars(s), UI["usually." + s.strength]])
      ]);
      var kids = [character(s, 60, { seed: seed }), el("p", { class: "duo__name", text: s.label }), cues];
      if (!line && a.orientation !== b.orientation) kids.push(el("p", { class: "duo__about", text: UI["about." + s.orientation] }));
      kids.push(el("p", { class: "duo__line", text: line || s.gloss }));
      return el("div", { class: "duo__col" }, kids);
    }
    duo.appendChild(el("div", { class: "duo" }, [
      column(a, c && c.aPoints[0], 0),
      el("span", { class: "duo__or", text: UI.or }),
      column(b, c && c.bPoints[0], 1.7)
    ]));
    if (c) {
      var rest = [[a, c.aPoints.slice(1)], [b, c.bPoints.slice(1)]].filter(function (x) { return x[1].length; });
      duo.appendChild(el("details", { class: "duo__more", open: true }, [
        el("summary", { text: UI["compare.more"] }),
        el("p", { text: c.summary })
      ].concat(rest.map(function (x) { return el("p", { class: "duo__points" }, [el("b", { text: x[0].label + ": " }), x[1].join(" · ")]); }))));
    } else {
      duo.appendChild(el("p", { class: "duo__note", text: UI["compare.generic"] }));
    }
    Clay.clock.prune();
  }

  // -------------------------------------------------------------------------------------------
  // All words, mildest to strongest, with search

  var listBox = document.getElementById("all-list");
  var search = document.getElementById("word-search");
  var count = document.getElementById("search-count");
  var everyWord = D.words.slice().sort(function (a, b) { return a.intensity - b.intensity || (a.label < b.label ? -1 : 1); });
  var rows = [];

  STRENGTHS.forEach(function (s) {
    var words = everyWord.filter(function (w) { return w.strength === s; });
    var ul = el("ul", { class: "all__rows" });
    words.forEach(function (w) {
      var f = famById[w.family];
      var face = character(w, 38, { animate: false, intensity: w.intensity });
      var b = el("button", { type: "button", class: "row", "data-word": w.id, onclick: function () { openWord(w.id, b); } }, [
        face,
        el("span", { class: "row__text" }, [
          el("span", { class: "row__top" }, [el("span", { class: "row__name", text: w.label }), el("span", { class: "row__fam" }, [famDot(f), f.label])]),
          el("span", { class: "row__gloss", text: w.gloss }),
          shortCues(w)
        ])
      ]);
      b.addEventListener("pointerenter", function () { face.__item.wake(true); });
      b.addEventListener("pointerleave", function () { face.__item.wake(false); });
      var li = el("li", null, [b]);
      ul.appendChild(li);
      rows.push({ li: li, word: w, group: s });
    });
    var group = el("section", { class: "all__group", "data-strength": s, "aria-labelledby": "all-" + s }, [
      el("h3", { id: "all-" + s, class: "all__h3" }, [el("span", { text: UI["usually." + s] }), el("span", { class: "all__n", text: String(words.length) })]),
      ul
    ]);
    listBox.appendChild(group);
  });

  function normal(q) {
    return q.toLowerCase().replace(/[’']/g, "").replace(/[^a-z\s-]/g, " ")
      .replace(/^\s*(i\s+feel|i\s+am|im|feeling|feel|a\s+bit|kind\s+of|so|very|really|quite)\s+/, "").replace(/\s+/g, " ").trim();
  }
  function startsWord(text, q) {
    text = " " + text.toLowerCase().replace(/[’']/g, "") + " ";
    return text.indexOf(" " + q) >= 0 || text.indexOf("-" + q) >= 0;
  }
  function matches(w, q) {
    if (!q) return true;
    var forms = [w.label, w.id].concat(w.aliases);
    if (forms.some(function (x) { return startsWord(x, q); })) return true;
    return q.length >= 3 && startsWord(w.gloss, q);
  }
  function runSearch() {
    var q = normal(search.value);
    var shown = 0, perGroup = {};
    rows.forEach(function (r) {
      var on = matches(r.word, q);
      r.li.hidden = !on;
      if (on) { shown++; perGroup[r.group] = (perGroup[r.group] || 0) + 1; }
    });
    listBox.querySelectorAll(".all__group").forEach(function (g) {
      var n = perGroup[g.getAttribute("data-strength")] || 0;
      g.hidden = n === 0;
      g.querySelector(".all__n").textContent = String(n);
    });
    count.textContent = q ? (shown ? shown + (shown === 1 ? " word matches" : " words match") : "No match. Try another word, or browse the families above.")
      : D.words.length + " words";
  }
  search.addEventListener("input", runSearch);
  search.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var first = rows.find(function (r) { return !r.li.hidden; });
    if (first) { e.preventDefault(); openWord(first.word.id, first.li.querySelector("button")); }
  });
  runSearch();

  // -------------------------------------------------------------------------------------------
  // Links into the page: #family=fear, #word=anxious

  function setHash(h) {
    var url = location.pathname + location.search + (h ? "#" + h : "");
    if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
  }
  function fromHash() {
    var m = /^#(family|word)=([A-Za-z]+)$/.exec(location.hash);
    if (m && m[1] === "word" && wordById[m[2]]) { openWord(m[2], null); return true; }
    if (m && m[1] === "family" && famById[m[2]]) { selectFamily(m[2], false); return true; }
    return false;
  }
  window.addEventListener("hashchange", function () { if (!fromHash() && dialog.open) dialog.close(); });
  if (!fromHash()) selectFamily(CONF.firstFamily && famById[CONF.firstFamily] ? CONF.firstFamily : D.families[0].id, false);

  window.FeelingsExplorer = { openWord: openWord, selectFamily: selectFamily, neighbours: neighbours, contrast: contrast, flower: flower };
})();
