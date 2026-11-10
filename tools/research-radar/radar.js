/* Research radar: draws the digest from data/radar.json (written by the radar's build) and ties each paper to its
   star in the galaxy (galaxy-hero-radar.js: galaxy-hero.js 2.0.2 with data-new-src). Every number on the page comes from the
   data file; nothing here is typed in by hand. */
(function () {
  "use strict";
  var doc = document;
  var monthsEl = doc.querySelector("[data-months]");
  var navEl = doc.querySelector("[data-months-nav]");
  var statusEl = doc.querySelector("[data-status]");
  var pickEl = doc.querySelector("[data-pick]");
  var galaxyEl = doc.querySelector("[data-galaxy]");
  var pauseBtn = doc.querySelector("[data-pause]");
  var stillNote = doc.querySelector("[data-still]");
  var method = doc.getElementById("placement");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var papers = {};                                   // DOI -> paper, for the galaxy's "galaxy:newstar" events
  var pickDefault = pickEl ? pickEl.textContent : "";

  // ------------------------------------------------------------------ helpers
  function h(tag, attrs, kids) {
    var e = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k === "text") e.textContent = attrs[k];
      else if (k === "className") e.className = attrs[k];
      else e.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
    return e;
  }
  function day(iso) {
    var d = new Date(iso + "T12:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }
  function count(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function pct(x) { return Math.round(x * 100) + "%"; }
  function cite(p) { return p.author + (p.year ? ", " + p.year : ""); }
  var STAR_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';

  // ------------------------------------------------------------------ the digest
  function ruleText(include) {
    var words = { relevant: "relevant", maybe: "maybe", irrelevant: "not relevant" };
    var parts = (include || ["relevant"]).map(function (k) { return words[k] || k; });
    return "Only the papers I mark " + parts.join(" or ") + " are listed here and in the feed.";
  }

  function render(d) {
    var months = d.months || [];
    var total = months.reduce(function (s, m) { return s + (m.listed || 0); }, 0);
    var latest = months[0];
    if (statusEl) {
      statusEl.textContent = latest
        ? "Latest search " + day(latest.updated) + " · " + count(total, "paper", "papers") + " listed · built " + day(d.built)
        : "No searches yet.";
    }
    var rule = doc.querySelector("[data-rule]");
    if (rule) rule.textContent = ruleText(d.rule && d.rule.include);
    describeMethod(d.placement || {});

    if (navEl && months.length > 1) {
      months.forEach(function (m) { navEl.appendChild(h("a", { href: "#m-" + m.id, text: m.label })); });
      navEl.hidden = false;
    }
    monthsEl.textContent = "";
    if (!months.length) monthsEl.appendChild(h("p", { className: "notice", text: "Nothing is listed yet. Papers appear here after the first search." }));
    months.forEach(function (m, k) { monthsEl.appendChild(month(m, k === 0)); });
    monthsEl.setAttribute("aria-busy", "false");
    // A link to one paper (#p-...) lands on it and shows its star; a link to a month (#m-...) lands on the month.
    if (location.hash && location.hash.length > 1) {
      var target = doc.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target && target.closest && target.closest("[data-months]")) {
        target.scrollIntoView();
        var id = target.getAttribute("data-id");
        if (id) whenGalaxy(function (g) { g.showNew(id); });
      }
    }
  }

  function month(m, isLatest) {
    var waiting = Math.max(0, (m.candidates || 0) - (m.judged || 0));
    var facts = [];
    if (m.searches) facts.push(count(m.searches, "search", "searches"));
    if (m.candidates) facts.push(count(m.candidates, "candidate", "candidates"));
    if (m.candidates) facts.push((m.judged || 0) + " judged so far");
    facts.push((m.listed || 0) + " marked relevant");
    var head = h("header", { className: "month-head" }, [
      h("h2", { id: "m-" + m.id + "-h" }, ["Found in " + m.label, isLatest ? h("span", { className: "chip chip--live", text: "Latest" }) : null]),
      h("p", { className: "meta", text: facts.join(" · ") })
    ]);
    var sec = h("section", { className: "month", id: "m-" + m.id, "aria-labelledby": "m-" + m.id + "-h" }, [head]);
    if (!m.papers || !m.papers.length) {
      sec.appendChild(h("p", { className: "month-empty", text: waiting
        ? "Nothing marked relevant yet."
        : "None of this month’s candidates made the list." }));
      return sec;
    }
    var list = h("ol", { className: "papers" });
    m.papers.forEach(function (p) { papers[p.id] = p; list.appendChild(paper(p)); });
    sec.appendChild(list);
    return sec;
  }

  function paper(p) {
    var venue = p.kind === "Preprint" && p.venue && !/preprint/i.test(p.venue) ? p.venue + " preprint" : p.venue;
    var title = h("a", { href: p.url }, [p.title]);
    var showBtn = h("button", { className: "btn btn--ghost btn--xs show-star", type: "button", "data-show": p.id,
      "aria-label": "Show “" + p.title + "” in the galaxy" });
    showBtn.innerHTML = STAR_ICON + "Show in galaxy";
    var near = (p.near || []).map(function (n) { return "‘" + n.title + "’ (" + cite(n) + ")"; });
    var placed = p.fit === "exact"
      ? [h("b", { text: "In my library" }), " · ringed at its own place" + (near.length ? ", near " + near[0] : "")]
      : p.fit === "loose"
        ? [h("b", { text: "Placed loosely" }), " · few close matches in my library" + (near.length ? "; nearest: " + near[0] : "")]
        : [h("b", { text: "Placed approximately" }), near.length ? " · near " + near.join(" and ") : ""];
    return h("li", { className: "paper", id: p.anchor, "data-id": p.id }, [
      h("p", { className: "topic", style: "--c:" + p.colour }, [h("i", { "aria-hidden": "true" }), p.topic]),
      h("h3", { className: "paper-title" }, [title]),
      h("p", { className: "byline" }, [p.authors, " · ", h("cite", { text: venue }), p.year ? " · " + p.year : ""]),
      h("p", { className: "summary", text: p.summary }),
      h("div", { className: "paper-foot" }, [
        h("a", { className: "doi", href: p.url, "aria-label": "Read the paper (DOI " + p.doi + ")" }, ["DOI " + p.doi]),
        showBtn,
        h("p", { className: "placed" }, placed)
      ])
    ]);
  }

  function describeMethod(pl) {
    var t = pl.test, testEl = doc.querySelector("[data-test]"), metaEl = doc.querySelector("[data-method-meta]");
    if (testEl && t) {
      testEl.textContent = "To see how close this gets, the same steps were run on " + t.papers + " papers that are already in my library, " +
        "each placed from its title and the start of its abstract with the paper itself taken out. " +
        pct(t.sameTopic) + " landed in the topic group the map gives them (" + pct(t.sameTopicByChance) + " would by chance), and " +
        pct(t.withinTenNearest) + " landed no further from their real place than their own tenth-nearest neighbour. " +
        "So treat a new star’s place, and its topic, as a good first guess. Tested " + day(t.date) + ".";
      testEl.hidden = false;
    }
    if (metaEl) {
      metaEl.textContent = "Similarity: TF-IDF cosine between a paper’s title and abstract and each library document’s " +
        (pl.basis === "titles only" ? "title" : "title, 15 key full-text terms and tags") +
        " · place: similarity-weighted centre of up to 5 nearest documents in the winning topic group · " +
        "the map itself: 3D t-SNE of full-text similarity (TF-IDF, LSA)";
    }
  }

  function failed(err) {
    if (statusEl) statusEl.textContent = "The list could not be loaded.";
    monthsEl.textContent = "";
    monthsEl.appendChild(h("p", { className: "notice" }, ["The list could not be loaded just now. The same papers are in the ", h("a", { href: "feed.xml", text: "RSS feed" }), "."]));
    monthsEl.setAttribute("aria-busy", "false");
    if (window.console) console.warn("research radar: " + (err && err.message ? err.message : err));
  }

  fetch("data/radar.json", { credentials: "same-origin" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(render)
    .catch(failed);

  // ------------------------------------------------------------------ the galaxy
  function galaxy() { return galaxyEl && galaxyEl.__galaxy; }
  // Runs fn once the galaxy has drawn and its new stars have arrived (it starts when it nears the screen).
  function whenGalaxy(fn) {
    var tries = 0;
    (function go() {
      var g = galaxy();
      if (g && g.ready && g.newStars && g.newStars().length) { fn(g); return; }
      if (++tries < 50) setTimeout(go, 200);
    })();
  }

  // "Show in galaxy": bring the whole galaxy into view if part of it is off screen (phones, or the end of the
  // list on a wide screen), then turn it to the star.
  function showStar(id) {
    var r = galaxyEl.getBoundingClientRect(), vh = window.innerHeight || doc.documentElement.clientHeight;
    var head = (doc.querySelector(".site-header") || {}).offsetHeight || 0;
    if (r.top < head || r.bottom > vh) galaxyEl.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    whenGalaxy(function (g) { g.showNew(id); });
  }
  if (monthsEl) {
    monthsEl.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-show]");
      if (b) showStar(b.getAttribute("data-show"));
    });
  }

  // The galaxy says which new star is pinned (a tap on it, or "Show in galaxy"); the list marks the paper.
  if (galaxyEl) {
    galaxyEl.addEventListener("galaxy:newstar", function (e) {
      var id = e.detail && e.detail.id, p = id && papers[id];
      Array.prototype.forEach.call(doc.querySelectorAll(".paper.is-selected"), function (x) { x.classList.remove("is-selected"); });
      if (!p) { pickEl.textContent = pickDefault; return; }
      var li = doc.getElementById(p.anchor);
      if (li) li.classList.add("is-selected");
      pickEl.textContent = "";
      pickEl.appendChild(doc.createTextNode("Showing " + p.authors + (p.year ? " (" + p.year + ")" : "") + " · " + p.topic + ". "));
      pickEl.appendChild(h("a", { href: "#" + p.anchor, text: "Read its summary" }));
    });
  }

  // Pause and play, as on the site's galaxies: with reduced motion the galaxy is one still frame and says so, and a
  // galaxy that could not draw (the poster stands in) has no button.
  if (pauseBtn) {
    var frozen = false, pauseLabel = pauseBtn.querySelector("[data-label]");
    var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    var paint = function () {
      pauseBtn.classList.toggle("is-paused", frozen);
      if (pauseLabel) pauseLabel.textContent = frozen ? "Play" : "Pause";
      pauseBtn.setAttribute("aria-label", frozen ? "Play the galaxy" : "Pause the galaxy");
    };
    var sync = function () {
      var still = !!(mq && mq.matches), g = galaxy();
      pauseBtn.hidden = still || !window.GalaxyHero || !!(g && g.failed);
      if (stillNote) stillNote.hidden = !still;
    };
    pauseBtn.addEventListener("click", function () {
      var g = galaxy();
      if (!g || !g.setView) return;
      frozen = !frozen;
      g.setView({ freeze: frozen });
      paint();
    });
    paint();
    sync();
    if (mq) { if (mq.addEventListener) mq.addEventListener("change", sync); else if (mq.addListener) mq.addListener(sync); }
    window.addEventListener("load", sync);
    setTimeout(sync, 4000);
  }

  // "How the new papers are placed" opens the method note it points to.
  function openMethod() { if (method && !method.open) method.open = true; }
  Array.prototype.forEach.call(doc.querySelectorAll("[data-open-method]"), function (a) { a.addEventListener("click", openMethod); });
  if (location.hash === "#placement") openMethod();
})();
