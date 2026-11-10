/* ==========================================================================
   SITE: contact details, in one place.
   Fill a value and every page shows it (contact sections, footer, the "Email me" and "Copy email" buttons, and
   every "Ask me for a demo" button, which then opens an email with the subject "Demo request: <tool>").
   Leave a value empty and everything that needs it stays hidden. Without an email address the site makes no
   promise it cannot keep: the "Get in touch" and "Ask me for a demo" buttons are hidden, and each contact section
   is headed "Find my work" and points to Google Scholar (and, on the Tools page, to the two live previews).
   ========================================================================== */
var SITE = {
  email: "bianyifan2016@gmail.com",      // the public address shown on every page
  cv: "",         // a link to a one-page CV in PDF: put the file in media/ and give its path, e.g. media/cv.pdf
  linkedin: "",   // the full LinkedIn profile URL
  github: "",     // the full GitHub profile URL
  ucl: ""         // the full UCL profile URL (optional)
};

/* Page behaviour
   - contact details from SITE
   - the header is clear over the hero and solid after it; sections fade in once (never with reduced motion)
   - the face wall behind the name on Home: one face at a time lights up with its AU tag; pointing at (or tapping)
     a face lights it; Pause / Play; with reduced motion three faces are lit and nothing changes by itself
   - Pause / Play for the live galaxies (GalaxyHero instance .setView({ freeze }))
   - recordings: a still that a loop plays over; only one plays at a time, only while it is mostly on screen; each
     has Pause / Play; with reduced motion nothing plays by itself
   - click to enlarge, tool details that fold on phones, Copy email / citation / bio, the tools page's jump bar
   - the galaxy's topic key and the journal chart's readout
   Everything works without this file: stills show, links work, every section is open. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  function mq(q) { return window.matchMedia ? window.matchMedia(q) : null; }
  var mqReduce = mq("(prefers-reduced-motion: reduce)");
  var mqCut = mq("(max-width: 640px)");          // the phone cut of a recording
  var mqPhone = mq("(max-width: 720px)");        // the phone layout
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function onChange(m, fn) { if (!m) return; if (m.addEventListener) m.addEventListener("change", fn); else if (m.addListener) m.addListener(fn); }
  function now() { return Date.now(); }
  var modalOpen = false;

  /* ---------------------------------------------------------------- contact details */
  var S = (function site() {
    var out = {};
    var cfg = (typeof SITE === "object" && SITE) || {};
    Object.keys({ email: 1, cv: 1, linkedin: 1, github: 1, ucl: 1 }).forEach(function (k) {
      var v = cfg[k] == null ? "" : String(cfg[k]).trim();
      if (/\{\{|\}\}/.test(v) || /^javascript:/i.test(v)) v = "";
      if (k === "email" && v && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)) v = "";
      out[k] = v;
    });
    $all("[data-site-show]").forEach(function (el) {
      var keys = el.getAttribute("data-site-show").split(/\s+/);
      el.hidden = !keys.some(function (k) { return !!out[k]; });
    });
    $all("[data-site-hide]").forEach(function (el) { el.hidden = !!out[el.getAttribute("data-site-hide")]; });
    $all("[data-site-text]").forEach(function (el) {
      var k = el.getAttribute("data-site-text"), v = out[k] || "";
      el.textContent = "";
      // an address breaks after the @ when it has to, never inside a word
      var at = k === "email" ? v.indexOf("@") : -1;
      if (at > 0) {
        el.appendChild(doc.createTextNode(v.slice(0, at + 1)));
        el.appendChild(doc.createElement("wbr"));
        el.appendChild(doc.createTextNode(v.slice(at + 1)));
      } else el.textContent = v;
    });
    $all("[data-site-href]").forEach(function (el) {
      var k = el.getAttribute("data-site-href");
      if (!out[k]) return;
      el.setAttribute("href", k === "email" ? "mailto:" + out.email : out[k]);
    });
    root.classList.toggle("has-email", !!out.email);
    root.classList.toggle("no-email", !out.email);
    if (out.email) {
      $all("[data-demo]").forEach(function (a) {
        var tool = a.getAttribute("data-demo");
        a.setAttribute("href", "mailto:" + out.email + "?subject=" + encodeURIComponent("Demo request" + (tool ? ": " + tool : "")));
      });
    }
    return out;
  })();

  /* ---------------------------------------------------------------- header */
  // Clear over the face wall at the top of Home; solid as soon as the first line of the hero's text would reach it, so
  // no text ever scrolls under a clear header.
  (function header() {
    var header = doc.querySelector("[data-header]"), hero = doc.querySelector("[data-hero]");
    if (!header) return;
    if (!hero) { header.classList.remove("is-clear"); return; }
    var first = hero.querySelector(".hero-copy > *") || hero;
    var ticking = false;
    function update() {
      ticking = false;
      header.classList.toggle("is-clear", first.getBoundingClientRect().top > header.offsetHeight + 12 &&
        hero.getBoundingClientRect().bottom > header.offsetHeight + 1);
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener("resize", update);
    update();
  })();

  /* ---------------------------------------------------------------- reveal (once) */
  (function reveal() {
    if (reduced() || !("IntersectionObserver" in window)) return;
    var els = $all(".reveal");
    var limit = window.innerHeight * 0.94;
    var pending = els.filter(function (el) { return el.getBoundingClientRect().top > limit; });
    if (!pending.length) return;
    els.forEach(function (el) { if (pending.indexOf(el) < 0) el.classList.add("in"); });
    root.classList.add("can-reveal");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    pending.forEach(function (el) { io.observe(el); });
    // never leave anything hidden: a jump to an anchor or a print shows everything
    function all() { els.forEach(function (el) { el.classList.add("in"); }); }
    window.addEventListener("hashchange", all);
    window.addEventListener("beforeprint", all);
  })();

  /* ---------------------------------------------------------------- face wall (Home)
     The candid photos behind the name. The wall drifts slowly to the left and a little upwards, and wraps round out of
     sight, so every photo passes through the open part of the wall (beside the words, or below them on a tall screen;
     on a phone, the band above the name). Every 2.4 s a face there lights up and shows the AUs LibreFace found in it, two
     at a time, never side by side: the face that has waited longest goes first, and a face about to drift under
     the words waits for its next pass. A few photos always wait out of sight; when a place wraps round, the photo that
     has waited longest takes it if that place is about to cross the open part, so every photo comes by within a few
     minutes. Pointing at a face lights it at once and the wall glides to a stop until the pointer leaves; on a
     phone, tapping a face does. With reduced motion the wall stands still, three faces are lit and nothing changes by
     itself; Pause stops the drift and the cycle; both rest while the wall is off screen. */
  (function faceWall() {
    var wall = doc.querySelector("[data-facewall]");
    if (!wall) return;
    var hero = wall.closest("[data-hero]") || doc.body;
    var tiles = $all(".face", wall);
    var copy = hero.querySelector(".hero-copy"), foot = hero.querySelector(".hero-foot"), eyebrow = hero.querySelector(".eyebrow");
    var header = doc.querySelector("[data-header]");
    var btn = hero.querySelector("[data-wall-toggle]"), note = hero.querySelector("[data-wall-still]");
    var label = btn && btn.querySelector("[data-label]");
    var lit = [], max = 2, timer = null, paused = false, onScreen = true, hover = null, tapTimer = null;
    var seen = tiles.map(function () { return 0; });      // when each face was last lit (0: not yet)
    function phone() { return !!(mqPhone && mqPhone.matches); }
    // the open part of the wall: right of the words (or below them), under the header, above the notes
    function words() {                                   // where the words end (not the box round them, which is padded)
      var c = null;
      if (copy) $all(":scope > *", copy).forEach(function (el) {
        if (el.hidden) return;
        var r = el.getBoundingClientRect();
        if (!r.width) return;
        c = c ? { right: Math.max(c.right, r.right), bottom: Math.max(c.bottom, r.bottom) } : { right: r.right, bottom: r.bottom };
      });
      return c;
    }
    function bounds() {
      var f = foot ? foot.getBoundingClientRect() : null;
      return { vw: root.clientWidth, top: header ? header.getBoundingClientRect().bottom : 64, c: words(),
        low: phone() ? (eyebrow ? eyebrow.getBoundingClientRect().top - 6 : 236) : (f ? f.top : window.innerHeight) - 10 };
    }
    // wholly inside the open part; lead: the room it must still have on its left, as it drifts that way
    function inside(t, b, lead, slack) {
      if (t.classList.contains("is-queued")) return false;
      var r = t.getBoundingClientRect(), ph = phone(), c = b.c;
      lead = lead || 0;
      if (slack) {                                       // a lit face is drawn a little larger: judge it by its middle
        var dx = r.width * slack, dy = r.height * slack;
        r = { left: r.left + dx, right: r.right - dx, top: r.top + dy, bottom: r.bottom - dy, width: r.width - 2 * dx };
      }
      if (!r.width || r.top < b.top + (ph ? 2 : 6) || r.bottom > b.low || r.left < 6 + lead || r.right > b.vw - (ph ? 6 : 16)) return false;
      return ph || !c || r.left > c.right + 24 + lead || r.top > c.bottom + 16;
    }
    function open(lead) { var b = bounds(); return tiles.filter(function (t) { return inside(t, b, lead); }); }
    function light(t) {
      if (lit.indexOf(t) >= 0) return;
      t.classList.add("is-lit"); lit.push(t); seen[tiles.indexOf(t)] = now();
      while (lit.length > max) lit.shift().classList.remove("is-lit");
    }
    function unlight(t) { var i = lit.indexOf(t); if (i >= 0) { lit.splice(i, 1); t.classList.remove("is-lit"); } }
    function clear() { lit.forEach(function (t) { t.classList.remove("is-lit"); }); lit = []; }
    function step() {
      if (hover) return;
      var c = open(drift.on ? drift.p * 0.35 : 0).filter(function (t) { return lit.indexOf(t) < 0; });
      if (!c.length) return;
      // two lit faces are never side by side: a face right beside the one staying lit waits until it drifts clear
      var centre = function (t) { var r = t.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; };
      var near = function (m, o) { return Math.hypot(m[0] - o[0], m[1] - o[1]) < 1.2 * Math.max(m[2], o[2]); };
      var stay = lit.slice(lit.length >= max ? 1 : 0).map(centre);   // the oldest goes out when this one comes in
      var t0 = now();
      var rank = c.map(function (t) {
        var m = centre(t), s = seen[tiles.indexOf(t)];
        return { t: t, m: m, s: s, due: !s || t0 - s > 60000 ? 0 : 1, far: stay.every(function (o) { return !near(m, o); }) };
      });
      rank.sort(function (a, b) {                        // apart first, then due, then the longest wait, then most room ahead
        return (b.far - a.far) || a.due - b.due || a.s - b.s || b.m[0] - a.m[0];
      });
      var pick = rank[0];
      if (!pick.far) {                                   // nothing clear of the lit face yet: wait for the next beat,
        if (lit.length && t0 - seen[tiles.indexOf(lit[0])] > 7000) unlight(lit[0]);   // and let a long-lit face go
        return;
      }
      light(pick.t);
    }
    function still() {                                   // reduced motion: a few faces lit, spread over the open wall
      clear();
      var c = open(), qs = phone() ? [0.2, 0.8] : [0.1, 0.5, 0.9];
      max = qs.length;
      qs.forEach(function (q) { var t = c[Math.round(q * (c.length - 1))]; if (t) light(t); });
    }

    // the drift: the photos sit in a grid of places that wraps round (a torus), one place larger than the wall each way,
    // so a photo always wraps while it is out of sight. Speeds are in photos per second: on a wide screen the wall moves
    // left and a little up; on a phone it moves sideways only, so a row always sits in the band above the name.
    var drift = { on: false, p: 0, C: 0, R: 0, vx: 0, vy: 0, slots: [], queue: [], ox: 0, oy: 0, v: 1, last: 0, raf: 0, check: 0, zone: null };
    var canDrift = !!(window.CSS && CSS.supports && CSS.supports("translate", "1px 1px")) && "requestAnimationFrame" in window;
    function mod(a, n) { return ((a % n) + n) % n; }
    function tearDown() {
      if (drift.raf) cancelAnimationFrame(drift.raf);
      drift.raf = 0; drift.on = false;
      wall.classList.remove("is-drift"); wall.style.height = "";
      tiles.forEach(function (t) { t.style.width = t.style.height = t.style.translate = ""; t.classList.remove("is-queued"); });
    }
    function setUp() {
      tearDown();
      if (reduced() || !canDrift) return;
      var cs = getComputedStyle(wall);                   // measured as the still grid
      var cols = (cs.gridTemplateColumns || "").split(" ").filter(Boolean).length || 7;
      var gap = parseFloat(cs.columnGap) || 8, W = wall.offsetWidth, H = wall.offsetHeight, N = tiles.length;
      if (!W || !H || !N) return;
      var ph = phone(), extra = ph ? 0 : 1;              // a phone's rows never wrap, so they need no spare row
      var keep = Math.max(6, Math.round(N * 0.15));      // photos that always wait out of sight, ready to come in
      if (ph) cols += 1;                                 // a phone: smaller photos, so two rows fit the band above the name
      var p = (W + gap) / cols;                          // the photos keep their size, or grow a little to go round
      while ((Math.ceil(W / p) + 1) * (Math.ceil(H / p) + extra) > N - keep) p += 2;
      drift.p = p; drift.C = Math.ceil(W / p) + 1; drift.R = Math.ceil(H / p) + extra;
      drift.vx = ph ? 0.12 : 0.075; drift.vy = ph ? 0 : 0.02;   // about 15 px a second on a laptop, 9 on a phone
      max = 2;
      zone();
      drift.slots = []; drift.queue = []; drift.on = true;
      wall.style.height = H + "px";
      wall.classList.add("is-drift");
      var size = (p - gap).toFixed(2) + "px";
      tiles.forEach(function (t, i) {
        t.style.width = size; t.style.height = size;
        if (i < drift.C * drift.R) drift.slots.push({ c: i % drift.C, r: Math.floor(i / drift.C), face: t, x: null, y: null });
        else { t.classList.add("is-queued"); drift.queue.push(t); }
      });
      place();
    }
    function zone() {
      var b = bounds(), r = wall.getBoundingClientRect();
      var left = (b.c && !phone() ? b.c.right + 24 : 6) - r.left, right = b.vw - (phone() ? 6 : 16) - r.left;
      drift.zone = { left: left, right: right, top: b.top + 6 - r.top, bottom: b.low - r.top };
    }
    function place() {
      var p = drift.p, CW = drift.C * p, RH = drift.R * p;
      drift.slots.forEach(function (s) {
        var x = mod(s.c * p - drift.ox, CW) - p, y = mod(s.r * p - drift.oy, RH) - (drift.vy ? p : 0);
        var wrapX = s.x !== null && x > s.x + p / 2, wrapY = s.y !== null && y > s.y + p / 2;
        if ((wrapX || wrapY) && drift.queue.length) {    // it wrapped round, out of sight: a waiting photo takes its place
          var out = s.face, z = drift.zone;
          unlight(out); if (hover === out) point(null);
          out.classList.add("is-queued"); out.style.translate = "";
          // will this place cross the open part soon? Then the photo that has waited longest; if not, a recent one
          var soon = !!z && (wrapX ? (y > z.top && y + p < z.bottom) : (x > z.left && x + p < z.right));
          var best = 0;
          drift.queue.forEach(function (f, i) {
            var a = seen[tiles.indexOf(f)], b = seen[tiles.indexOf(drift.queue[best])];
            if (soon ? a < b : a > b) best = i;
          });
          s.face = drift.queue.splice(best, 1)[0]; drift.queue.push(out); s.face.classList.remove("is-queued");
        }
        s.x = x; s.y = y;
        s.face.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
      });
    }
    // just before a place slides in from the right, still out of sight, the photo that has waited longest takes it
    function stage(b) {
      drift.slots.forEach(function (s) {
        var f = s.face, r = f.getBoundingClientRect();
        if (!(r.left > b.vw + 2 && r.left < b.vw + drift.p * 1.2 && r.top >= b.top && r.bottom <= b.low)) { s.staged = false; return; }
        if (s.staged || !drift.queue.length) return;
        s.staged = true;
        var best = 0;
        drift.queue.forEach(function (q, i) { if (seen[tiles.indexOf(q)] < seen[tiles.indexOf(drift.queue[best])]) best = i; });
        var q = drift.queue[best];
        if (seen[tiles.indexOf(q)] >= seen[tiles.indexOf(f)]) return;   // the photo here has waited as long already
        unlight(f); f.classList.add("is-queued"); f.style.translate = "";
        drift.queue.splice(best, 1); drift.queue.push(f);
        q.classList.remove("is-queued"); s.face = q;
        q.style.translate = s.x.toFixed(1) + "px " + s.y.toFixed(1) + "px";
      });
    }
    function frame(t) {
      drift.raf = 0;
      if (!drift.on || paused || !onScreen || doc.hidden) return;
      var dt = drift.last ? Math.min(0.05, (t - drift.last) / 1000) : 0;
      drift.last = t;
      drift.v += ((hover ? 0 : 1) - drift.v) * Math.min(1, dt * 2.5);   // glide to a stop under the pointer, and back
      drift.ox = mod(drift.ox + drift.vx * drift.p * drift.v * dt, drift.C * drift.p);
      drift.oy = mod(drift.oy + drift.vy * drift.p * drift.v * dt, drift.R * drift.p);
      place();
      if (t - drift.check > 500) {                       // a lit face that drifts out of the open part goes back
        drift.check = t;
        var b = bounds();
        lit.slice().forEach(function (f) { if (f !== hover && !inside(f, b, 0, 0.15)) unlight(f); });
        stage(b);
      }
      drift.raf = requestAnimationFrame(frame);
    }

    function run() {
      if (timer) { clearInterval(timer); timer = null; }
      if (drift.raf) { cancelAnimationFrame(drift.raf); drift.raf = 0; }
      if (reduced()) { still(); return; }
      max = 2;
      if (paused || !onScreen || doc.hidden) return;
      if (!lit.length) step();
      timer = setInterval(step, 2400);
      if (drift.on) { drift.last = 0; drift.raf = requestAnimationFrame(frame); }
    }
    function paint() {
      if (note) note.hidden = !reduced();
      if (!btn) return;
      btn.hidden = reduced();
      btn.classList.toggle("is-paused", paused);
      if (label) label.textContent = paused ? "Play" : "Pause";
      btn.setAttribute("aria-label", paused ? "Play the face wall" : "Pause the face wall");
    }
    function point(t) {
      if (hover && hover !== t) hover.classList.remove("is-hover");
      hover = t; if (t) t.classList.add("is-hover");
    }
    tiles.forEach(function (t) {
      t.addEventListener("pointerenter", function (e) { if (e.pointerType !== "touch" && open().indexOf(t) >= 0) point(t); });
      t.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch" && hover === t) point(null); });
      // a tap (no mouse) lights the face, a second tap puts it back; it goes back by itself after 6 s
      t.addEventListener("click", function (e) {
        if (e.pointerType === "mouse" || open().indexOf(t) < 0) return;
        clearTimeout(tapTimer);
        if (hover === t) { point(null); return; }
        point(t);
        tapTimer = setTimeout(function () { if (hover === t) point(null); }, 6000);
      });
    });
    if (btn) btn.addEventListener("click", function () { paused = !paused; paint(); run(); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; run(); }).observe(hero);
    }
    doc.addEventListener("visibilitychange", run);
    var rz = null, lastW = root.clientWidth, lastH = window.innerHeight;
    window.addEventListener("resize", function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        if (reduced()) { still(); return; }
        // a phone's address bar showing or hiding changes the height a little: keep the drift going through that
        if (root.clientWidth === lastW && Math.abs(window.innerHeight - lastH) < 120) return;
        lastW = root.clientWidth; lastH = window.innerHeight;
        clear(); setUp(); run();
      }, 200);
    });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (reduced()) still(); else if (drift.on) zone(); });
    onChange(mqReduce, function () { paint(); clear(); setUp(); run(); });
    setUp();
    paint();
    run();
  })();

  /* ---------------------------------------------------------------- galaxies: Pause / Play */
  (function galaxyControls() {
    $all("[data-galaxy-toggle]").forEach(function (btn) {
      var host = btn.closest("[data-hero]") || btn.closest("[data-galaxy-host]") || btn.closest("figure") || doc;
      var els = $all("[data-galaxy]", host);
      var note = host.querySelector("[data-still-note]");
      if (!els.length) return;
      var frozen = false;
      var label = btn.querySelector("[data-label]");
      function insts() { return els.map(function (el) { return el.__galaxy; }).filter(Boolean); }
      function paint() {
        btn.classList.toggle("is-paused", frozen);
        if (label) label.textContent = frozen ? "Play" : "Pause";
        btn.setAttribute("aria-label", frozen ? "Play the galaxy" : "Pause the galaxy");
      }
      function sync() {
        var gs = insts();
        var broken = gs.length > 0 && gs.every(function (g) { return g.failed; });
        var missing = !window.GalaxyHero;
        // With reduced motion the galaxy draws one still frame: no Play button, a short note instead.
        btn.hidden = reduced() || broken || missing;
        if (note) note.hidden = !reduced();
      }
      btn.addEventListener("click", function () {
        frozen = !frozen;
        insts().forEach(function (g) { if (typeof g.setView === "function") g.setView({ freeze: frozen }); });
        paint();
      });
      paint();
      sync();
      onChange(mqReduce, sync);
      window.addEventListener("load", sync);
      setTimeout(sync, 4000);
    });
  })();

  /* ---------------------------------------------------------------- recordings */
  var recordings = (function recordings() {
    var items = [];
    var active = null;
    $all(".loop[data-loop]").forEach(function (box) {
      var v = box.querySelector("video");
      if (v) items.push({ v: v, box: box, mode: "auto" });
    });
    // The real-world example (NASA/JPL footage): its own Pause / Play button, and no motion at all when the device
    // asks for less (the still and a note stay).
    $all("[data-rw-screen]").forEach(function (fig) {
      var v = fig.querySelector(".rw-screen__video");
      if (!v) return;
      if (reduced()) { v.parentNode.removeChild(v); return; }
      items.push({ v: v, box: null, fig: fig, mode: "rw" });
    });
    if (!items.length) return null;

    function find(el) { for (var i = 0; i < items.length; i++) if (items[i].v === el || items[i].box === el || items[i].target === el) return items[i]; return null; }
    function want(it) { return it.box ? ((mqCut && mqCut.matches && it.box.getAttribute("data-src-phone")) || it.box.getAttribute("data-src")) : null; }
    function ensureSrc(it) {
      var src = want(it);
      if (src && it.v.getAttribute("src") !== src) {
        it.box.classList.remove("is-playing");
        it.v.setAttribute("src", src);
      }
    }
    function play(it) {
      ensureSrc(it);
      active = it;
      var p = it.v.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* refused or missing: the still stays */ });
    }
    function paint(it) {
      var paused = it.v.paused;
      if (it.btn) {
        it.btn.classList.toggle("is-paused", paused);
        var l = it.btn.querySelector("[data-label]");
        if (l) l.textContent = paused ? "Play" : "Pause";
        it.btn.setAttribute("aria-label", paused ? "Play the recording" : "Pause the recording");
      }
      if (it.rwBtn) {
        it.rwBtn.textContent = paused ? "Play" : "Pause";
        it.rwBtn.setAttribute("aria-label", paused ? "Play the screen recording" : "Pause the screen recording");
      }
    }

    // Decide which one recording plays: one the viewer started while it is on screen, otherwise the most visible
    // one that is at least half on screen (never with reduced motion). Everything else is paused.
    function pick() {
      if (doc.hidden || modalOpen) { items.forEach(function (it) { if (!it.v.paused) it.v.pause(); }); return; }
      var best = null, t = now();
      items.forEach(function (it) {
        if (it.user && it.ratio === 0 && t - it.userAt > 1500) it.user = false;
        if (it.user && it.ratio > 0 && (!best || it.ratio > best.ratio)) best = it;
      });
      if (!best && !reduced()) {
        items.forEach(function (it) {
          if (it.held || it.broken || it.ratio < 0.5) return;
          if (!best || it.ratio > best.ratio) best = it;
        });
      }
      items.forEach(function (it) {
        if (it === best) { if (it.v.paused) play(it); else active = it; }
        else if (!it.v.paused) it.v.pause();
      });
      if (!best) active = null;
    }

    items.forEach(function (it) {
      var v = it.v;
      it.ratio = 0; it.held = false; it.user = false; it.userAt = 0; it.broken = false;
      // what the visibility observer watches: the loop's box, or the real-world example's media frame
      it.target = it.box || it.v.closest(".rw-screen__media") || it.v;
      it.btn = it.box && it.box.id ? doc.querySelector('[data-loop-toggle="' + it.box.id + '"]') : null;
      it.rwBtn = it.fig ? it.fig.querySelector("[data-rw-toggle]") : null;
      v.addEventListener("play", function () {
        if (it !== active && !it.user) { v.pause(); return; }
        items.forEach(function (o) { if (o !== it && !o.v.paused) o.v.pause(); });
        paint(it);
      });
      v.addEventListener("playing", function () { (it.box || v).classList.add("is-playing"); paint(it); });
      v.addEventListener("pause", function () { paint(it); });
      v.addEventListener("error", function (e) {
        // A <source> whose media query does not match also fires "error" (at that source, caught here): only a video
        // that failed, or one with no source left to try (NETWORK_NO_SOURCE), counts as broken.
        if (e.target !== v && v.networkState !== 3) return;
        it.broken = true; if (it.btn) it.btn.hidden = true; if (it.rwBtn) it.rwBtn.hidden = true;
      }, true);
      function toggle() {
        if (v.paused) { it.held = false; it.user = true; it.userAt = now(); play(it); }
        else { it.held = true; it.user = false; v.pause(); pick(); }
      }
      if (it.btn) { it.btn.hidden = false; paint(it); it.btn.addEventListener("click", toggle); }
      if (it.rwBtn) { it.rwBtn.hidden = false; paint(it); it.rwBtn.addEventListener("click", toggle); }
    });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { var it = find(e.target); if (it) it.ratio = e.isIntersecting ? e.intersectionRatio : 0; });
        pick();
      }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      items.forEach(function (it) { io.observe(it.target); });
    }
    doc.addEventListener("visibilitychange", pick);
    // Load ahead: a recording starts downloading about one screen before it comes into view, so it can start at once
    // when the reader gets there. Only after the page itself has loaded, and not with reduced motion or Save-Data.
    function loadAhead() {
      if (!("IntersectionObserver" in window) || reduced()) return;
      if (navigator.connection && navigator.connection.saveData) return;
      var ahead = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting || reduced()) return;
          var it = find(e.target);
          if (!it || it.broken) return;
          it.v.preload = "auto";
          if (it.box) ensureSrc(it);
          else if (it.v.readyState === 0 && it.v.networkState !== 2) it.v.load();
          ahead.unobserve(e.target);
        });
      }, { rootMargin: "100% 0px 100% 0px" });
      items.forEach(function (it) { ahead.observe(it.target); });
    }
    if (doc.readyState === "complete") setTimeout(loadAhead, 300);
    else window.addEventListener("load", function () { setTimeout(loadAhead, 300); });
    onChange(mqReduce, function () { if (reduced()) items.forEach(function (it) { if (!it.user && !it.v.paused) it.v.pause(); }); pick(); });
    // crossing 640 px swaps a recording to the other cut
    onChange(mqCut, function () {
      items.forEach(function (it) {
        var was = !it.v.paused;
        if (it.mode === "rw") {
          if (!it.v.currentSrc) return;
          it.v.pause(); it.v.classList.remove("is-playing"); it.v.load();
          if (was) play(it);
          return;
        }
        if (!it.v.getAttribute("src")) return;
        it.v.pause();
        ensureSrc(it);
        if (was) play(it);
      });
    });

    // "Watch the test recording", "Watch the timeline in action": bring the recording into view and play it.
    $all("[data-play-target]").forEach(function (b) {
      b.addEventListener("click", function () {
        var box = doc.getElementById(b.getAttribute("data-play-target"));
        var v = box && box.querySelector("video");
        var it = v && find(v);
        if (!it) return;
        (box.closest("figure") || box).scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
        it.held = false; it.user = true; it.userAt = now();
        play(it);
      });
    });
    return { pick: pick };
  })();

  /* ---------------------------------------------------------------- click to enlarge */
  (function lightbox() {
    var triggers = $all("[data-zoom]");
    if (!triggers.length || typeof HTMLDialogElement !== "function") return;
    var dlg = doc.createElement("dialog");
    dlg.className = "lightbox";
    dlg.setAttribute("aria-label", "Enlarged view");
    dlg.innerHTML = '<div class="lb-bar"><p class="lb-cap"></p><button class="toggle" type="button" data-lb-close>Close</button></div><div class="lb-body"></div>';
    doc.body.appendChild(dlg);
    var body = dlg.querySelector(".lb-body"), cap = dlg.querySelector(".lb-cap"), closeBtn = dlg.querySelector("[data-lb-close]");
    var opener = null;
    function open(z) {
      var fig = z.closest("figure");
      var src = z.getAttribute("data-zoom-src") || z.getAttribute("href");
      body.innerHTML = "";
      body.classList.toggle("is-light", z.hasAttribute("data-zoom-light"));
      if (z.getAttribute("data-zoom") === "video") {
        var v = doc.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.controls = true; v.preload = "auto";
        v.src = src;
        var poster = z.getAttribute("data-zoom-poster");
        if (poster) v.poster = poster;
        if (!reduced()) v.autoplay = true;
        body.appendChild(v);
      } else {
        var img = doc.createElement("img");
        var inner = z.querySelector("img") || (fig && fig.querySelector("img"));
        img.src = src;
        img.alt = inner ? inner.alt : "";
        body.appendChild(img);
      }
      var c = fig && fig.querySelector(".cap");
      cap.textContent = z.getAttribute("data-zoom-cap") || (c ? (c.firstChild && c.firstChild.nodeType === 3 ? c.firstChild.textContent : c.textContent) : "");
      opener = z;
      modalOpen = true;
      if (recordings) recordings.pick();
      dlg.showModal();
      closeBtn.focus();
    }
    triggers.forEach(function (z) {
      z.addEventListener("click", function (e) { e.preventDefault(); open(z); });
    });
    closeBtn.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      body.innerHTML = "";
      modalOpen = false;
      if (recordings) recordings.pick();
      if (opener && opener.focus) opener.focus();
    });
  })();

  /* ---------------------------------------------------------------- tool details: open on wide screens, folded on phones */
  (function folds() {
    var rows = $all("[data-fold]");
    if (!rows.length) return;
    function phone() { return !!(mqPhone && mqPhone.matches); }
    function setRow(r, open) {
      r.classList.toggle("is-folded", !open);
      var b = r.querySelector(".fold-btn");
      if (b && phone()) b.setAttribute("aria-expanded", open ? "true" : "false");
    }
    function set() {
      rows.forEach(function (r) {
        var b = r.querySelector(".fold-btn");
        if (b) {
          // On wider screens the title is plain text (the section is always open); on phones it is a real button.
          if (phone()) { b.removeAttribute("tabindex"); b.removeAttribute("role"); }
          else { b.setAttribute("tabindex", "-1"); b.setAttribute("role", "none"); b.removeAttribute("aria-expanded"); }
        }
        if (phone()) { if (!r.hasAttribute("data-touched")) setRow(r, false); else setRow(r, !r.classList.contains("is-folded")); }
        else setRow(r, true);
      });
    }
    rows.forEach(function (r) {
      var b = r.querySelector(".fold-btn");
      if (b) b.addEventListener("click", function () {
        if (!phone()) return;
        r.setAttribute("data-touched", "");
        setRow(r, r.classList.contains("is-folded"));
      });
    });
    set();
    onChange(mqPhone, set);
    // a link to something inside a folded section opens it
    function openTarget() {
      var id = location.hash.slice(1);
      var t = id && doc.getElementById(id);
      var r = t && t.closest && t.closest("[data-fold]");
      if (r) setRow(r, true);
    }
    window.addEventListener("hashchange", openTarget);
    openTarget();
  })();

  /* ---------------------------------------------------------------- copy email, citation, bio */
  (function copyButtons() {
    var toastEl = doc.querySelector("[data-toast-el]"), timer = 0;
    function toast(msg) {
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add("is-on");
      clearTimeout(timer);
      timer = setTimeout(function () { toastEl.classList.remove("is-on"); }, 2200);
    }
    function legacyCopy(text) {
      return new Promise(function (resolve, reject) {
        var t = doc.createElement("textarea");
        t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
        doc.body.appendChild(t); t.select();
        var ok = false;
        try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
        doc.body.removeChild(t);
        if (ok) resolve(); else reject();
      });
    }
    function copy(text) {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
      }
      return legacyCopy(text);
    }
    $all("[data-copy], [data-copy-site]").forEach(function (b) {
      b.addEventListener("click", function () {
        var from = b.getAttribute("data-copy-from");
        var key = b.getAttribute("data-copy-site");
        var text = key ? S[key] : from ? (doc.querySelector(from) || {}).textContent : b.getAttribute("data-copy");
        if (!text) return;
        copy(text.replace(/\s+/g, " ").trim()).then(function () { toast(b.getAttribute("data-toast") || "Copied"); }, function () { /* nothing copied: say nothing */ });
      });
    });
  })();

  /* ---------------------------------------------------------------- tools page: jump bar */
  (function jumpbar() {
    var links = $all(".jumpbar a");
    if (!links.length || !("IntersectionObserver" in window)) return;
    // The bar appears under the header once the index of tools has scrolled away above it.
    var bar = doc.querySelector("[data-jumpbar]"), index = doc.querySelector("[data-tool-index]"), header = doc.querySelector("[data-header]");
    if (bar && index) {
      var ticking = false;
      var update = function () {
        ticking = false;
        var past = index.getBoundingClientRect().bottom < (header ? header.offsetHeight : 64);
        var close = doc.querySelector(".page-close");
        var done = close && close.getBoundingClientRect().top < window.innerHeight * 0.5;
        bar.classList.toggle("is-on", past && !done);
      };
      window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
      update();
    }
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove("is-active"); a.removeAttribute("aria-current"); });
        var a = byId[e.target.id];
        if (a) { a.classList.add("is-active"); a.setAttribute("aria-current", "true"); }
      });
    }, { rootMargin: "-42% 0px -52% 0px" });
    $all(".tool[id]").forEach(function (t) { io.observe(t); });
  })();

  /* ---------------------------------------------------------------- the galaxy's topic key
     Read from the same data file the galaxy draws, so the colours always match it. Shown only when every topic in
     the file carries one of the public topic names. */
  (function topicKey() {
    var wrap = doc.querySelector("[data-topic-key]");
    if (!wrap || !window.fetch) return;
    var list = wrap.querySelector("ul");
    var PUBLIC = ["Automated facial analysis", "How people read faces", "Multimodal datasets and AI", "Theories of emotion",
      "Social psychology and methods", "Depression and behaviour", "Shame, guilt and the self", "Measuring facial movement",
      "Shame and psychotherapy", "Conversation datasets", "AI ethics and humanlike AI", "Expressivity in psychiatry",
      "Brain and social threat", "Emotion regulation", "Statistics and modelling", "Detecting deception",
      "Automatic depression detection", "Suicide and self-harm", "Facial expressions of pain", "Micro-expressions"];
    var colour = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
    fetch(wrap.getAttribute("data-src"), { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var groups = (d && d.groups) || [];
        var topics = [], other = null;
        for (var i = 0; i < groups.length; i++) {
          var g = groups[i];
          if (!Array.isArray(g)) continue;
          var name = String(g[0] || "").trim(), c = String(g[1] || "").trim();
          if (g[3] === 1) { if (colour.test(c)) other = c; continue; }  // not a topic: listed last, apart, by what it is
          if (PUBLIC.indexOf(name) < 0 || !colour.test(c)) return;  // any other name: show no key at all
          topics.push({ name: name, c: c, n: +g[2] || 0 });
        }
        if (topics.length < 3) return;
        topics.sort(function (a, b) { return b.n - a.n; });
        if (other) topics.push({ name: "Not a topic: files whose text could not be read", c: other, apart: true });
        topics.forEach(function (t) {
          var li = doc.createElement("li"), dot = doc.createElement("i");
          if (t.apart) li.className = "not-topic";
          dot.style.background = t.c; dot.style.color = t.c; dot.setAttribute("aria-hidden", "true");
          li.appendChild(dot);
          li.appendChild(doc.createTextNode(t.name));
          list.appendChild(li);
        });
        wrap.hidden = false;
      })
      .catch(function () { /* no data, no key */ });
  })();

  /* ---------------------------------------------------------------- charts: the journal chart's readout */
  (function readouts() {
    $all("[data-readout-for]").forEach(function (out) {
      var chart = doc.getElementById(out.getAttribute("data-readout-for"));
      if (!chart) return;
      var idle = out.textContent;
      $all("[data-readout]", chart).forEach(function (row) {
        function show() { out.textContent = row.getAttribute("data-readout"); }
        function hide() { out.textContent = idle; }
        row.addEventListener("pointerenter", show);
        row.addEventListener("focus", show);
        row.addEventListener("pointerleave", hide);
        row.addEventListener("blur", hide);
      });
    });
  })();
})();
