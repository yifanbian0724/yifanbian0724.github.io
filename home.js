/* Layout v5: the engine shared by Option 1 · Storyboard, Option 2 · Showreel and Option 3 · Bento.

   Nothing here reacts to the scroll position. A recording plays when its player is in view (IntersectionObserver)
   and stops when it is not; moments and progress follow the recording's own clock.

   PLAYER   A frame with the clip's own shape and a list of items (recordings or stills). Changing item, or jumping
            to another moment, is a 360 ms dissolve: the old picture stays on top, paused, and fades away while the
            new one plays underneath. Jumping inside the same recording holds the frame on screen as a picture, moves
            the recording underneath, then fades the picture away. A recording that ends wraps the same way.
            An item whose shape differs from the frame sits centred over a blurred, darkened copy of its own frame.
   ONE AT A TIME  Only one recording plays on the page (two in the bento): starting one pauses the oldest.
   REDUCED MOTION Nothing plays by itself and nothing animates; every player shows its first picture; moments and
            tabs still switch pictures, at once.
   Without this file every player shows its first picture and every list and link still works. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement, body = doc.body;
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mqReduce && mqReduce.matches); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function onChange(m, fn) { if (!m) return; if (m.addEventListener) m.addEventListener("change", fn); else if (m.addListener) m.addListener(fn); }
  var FADE = 360;
  var MAX = parseInt(body.getAttribute("data-max-play") || "1", 10);
  root.classList.add("v5-js");

  /* ---------------------------------------------------------------- recordings */
  function load(v) {
    if (v && !v.getAttribute("src") && v.getAttribute("data-src")) { v.preload = "auto"; v.setAttribute("src", v.getAttribute("data-src")); }
  }
  function playV(v) { load(v); var p = v.play(); if (p && p.catch) p.catch(function () { /* refused: the still stays */ }); }
  function quiet(v) { if (v && !v.paused) { v.__quiet = true; v.pause(); } }
  function whenMeta(v, fn) {
    if (v.readyState >= 1) fn();
    else v.addEventListener("loadedmetadata", function once() { v.removeEventListener("loadedmetadata", once); fn(); });
  }
  function seek(v, t, fn) {
    load(v);
    whenMeta(v, function () {
      var target = Math.max(0, Math.min(t, (v.duration || t + 1) - 0.06));
      if (Math.abs(v.currentTime - target) < 0.03 && v.readyState >= 2) { if (fn) fn(); return; }
      v.addEventListener("seeked", function once() { v.removeEventListener("seeked", once); if (fn) fn(); });
      v.currentTime = target;
    });
  }
  function painted(v, fn) {
    if (v.requestVideoFrameCallback) {
      var done = false, t = setTimeout(function () { if (!done) { done = true; fn(); } }, 180);
      v.requestVideoFrameCallback(function () { if (!done) { done = true; clearTimeout(t); fn(); } });
    } else requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  /* ---------------------------------------------------------------- one recording at a time (two in the bento) */
  var order = [];
  doc.addEventListener("play", function (e) {
    var v = e.target;
    if (!v || v.tagName !== "VIDEO") return;
    order = order.filter(function (x) { return x !== v && !x.paused; });
    order.push(v);
    while (order.length > MAX) { var old = order.shift(); if (!old.paused) old.pause(); }
  }, true);

  /* ---------------------------------------------------------------- the player */
  var players = [];
  function Player(el) {
    var p = this;
    p.el = el;
    p.id = el.getAttribute("data-player");
    p.frame = el.querySelector(".pl-frame");
    p.scope = el.closest("[data-scope]") || el;
    p.items = $all(".pl-item", p.frame).map(function (it) {
      var v = it.querySelector("video");
      return { el: it, v: v, img: it.querySelector("img"), bg: it.querySelector("canvas.pl-bg"), still: !v,
               w: num(it.getAttribute("data-w")) || 16, h: num(it.getAttribute("data-h")) || 10,
               dur: num(it.getAttribute("data-dur")) || 4, t0: num(it.getAttribute("data-t0")), t1: num(it.getAttribute("data-t1")) };
    });
    p.moments = $all("[data-moment]", p.scope).filter(function (m) { return m.getAttribute("data-for") === p.id; });
    p.caps = $all("[data-cap]", p.scope).filter(function (c) { return c.getAttribute("data-for") === p.id; });
    p.fill = el.querySelector(".pl-fill");
    p.toggle = p.scope.querySelector('[data-pl-toggle="' + p.id + '"]');
    p.snap = doc.createElement("canvas");
    p.snap.className = "pl-snap";
    p.snap.setAttribute("aria-hidden", "true");
    p.frame.appendChild(p.snap);
    p.cur = 0;
    p.running = false;     // the player is meant to be playing (a recording plays or a still is counting down)
    p.allowed = false;     // in view (or chosen by the reader)
    p.user = false;        // the reader asked for it (Play, a moment, a tab)
    p.stillStart = 0; p.stillAt = 0; p.timer = 0; p.raf = 0; p.lastMoment = -1;
    p.onItem = null; p.onTick = null;
    p.items.forEach(function (it, i) {
      if (it.v) {
        it.v.addEventListener("playing", function () { it.el.classList.add("is-ready"); p.paint(); });
        it.v.addEventListener("seeked", function () { if (it.v.readyState >= 2) it.el.classList.add("is-ready"); });
        it.v.addEventListener("pause", function () {
          if (it.v.__quiet) { it.v.__quiet = false; return; }   // the player paused it itself
          // paused from outside (another recording started): this player stops too
          if (i === p.cur && p.running && !p.switching && !it.v.ended) { p.running = false; p.stopTick(); p.paint(); }
        });
        it.v.addEventListener("ended", function () { if (i === p.cur && p.running) p.next(); });
      }
      if (it.img) { if (it.img.complete) p.drawBg(it, it.img); else it.img.addEventListener("load", function () { p.drawBg(it, it.img); }); }
    });
    // a moment: the picture moves there (a dissolve); with reduced motion it only changes the picture
    p.moments.forEach(function (m, k) {
      m.addEventListener("click", function () { if (!reduced()) { p.user = true; p.held = false; } p.toMoment(k); });
    });
    if (p.toggle) p.toggle.addEventListener("click", function () {
      if (p.running) { p.user = false; p.held = true; p.pause(); }
      else { p.user = true; p.held = false; p.play(true); }
    });
    if ("ResizeObserver" in window) new ResizeObserver(function () { p.fit(); }).observe(p.frame);
    p.fit();
    p.light(p.momentAt(0, p.itemStart(0)));
    p.progress(0);
    p.paint();
    players.push(p);
    el.__player = p;
  }
  Player.prototype.itemStart = function (i) { var it = this.items[i]; return it.t0 != null ? it.t0 : 0; };
  Player.prototype.itemEnd = function (i) {
    var it = this.items[i];
    if (it.t1 != null) return it.t1;
    if (it.v && it.v.duration) return it.v.duration;
    return it.still ? it.dur : (it.dur || 0);
  };
  Player.prototype.itemLength = function (i) { return Math.max(0.1, this.itemEnd(i) - this.itemStart(i)); };
  Player.prototype.time = function () {
    var it = this.items[this.cur];
    if (it.v) return it.v.currentTime;
    var el = this.stillAt + (this.running && this.stillStart ? (performance.now() - this.stillStart) / 1000 : 0);
    return Math.min(it.dur, el);
  };
  // an item whose shape differs from the frame's sits over a blurred, darkened copy of itself
  Player.prototype.fit = function () {
    var p = this, fw = p.frame.clientWidth, fh = p.frame.clientHeight;
    if (!fw || !fh) return;
    var fa = fw / fh;
    p.items.forEach(function (it) {
      var a = it.w / it.h, cover = Math.abs(a / fa - 1) < 0.02;
      it.el.classList.toggle("fit-cover", cover);
      it.el.classList.toggle("fit-contain", !cover);
      if (!cover && !it.bgDrawn) {
        if (it.v && it.v.readyState >= 2) p.drawBg(it, it.v);
        else if (it.img && it.img.complete && it.img.naturalWidth) p.drawBg(it, it.img);
      }
    });
  };
  Player.prototype.drawBg = function (it, src) {
    if (!it.bg || !it.el.classList.contains("fit-contain")) return;
    var c = it.bg, w = 64, h = Math.max(1, Math.round(64 * it.h / it.w));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    try { c.getContext("2d").drawImage(src, 0, 0, w, h); it.bgDrawn = true; } catch (e) { /* not ready */ }
  };
  Player.prototype.momentAt = function (i, t) {
    var best = -1, ms = this.moments, len = null;
    for (var k = 0; k < ms.length; k++) {
      var m = ms[k];
      if (+m.getAttribute("data-item") !== i) continue;
      var t0 = num(m.getAttribute("data-t0"));
      if (t0 == null) {
        len = len || this.itemEnd(i);
        t0 = (num(m.getAttribute("data-f0")) || 0) * len;
      }
      if (t0 <= t + 0.05) best = k;
      else if (best < 0) best = k;
    }
    return best;
  };
  Player.prototype.light = function (k) {
    if (k === this.lastMoment) return;
    this.lastMoment = k;
    this.moments.forEach(function (m, j) {
      m.classList.toggle("is-on", j === k);
      if (j === k) m.setAttribute("aria-current", "step"); else m.removeAttribute("aria-current");
    });
  };
  Player.prototype.progress = function (frac) {
    if (this.fill) this.fill.style.transform = "scaleX(" + Math.max(0, Math.min(1, frac)).toFixed(4) + ")";
  };
  Player.prototype.whole = function () {
    var before = 0, total = 0, p = this;
    this.items.forEach(function (it, i) { var l = p.itemLength(i); if (i < p.cur) before += l; total += l; });
    return total ? (before + Math.max(0, this.time() - this.itemStart(this.cur))) / total : 0;
  };
  Player.prototype.startTick = function () {
    var p = this;
    if (p.raf) return;
    function tick() {
      p.raf = 0;
      if (!p.running) return;
      if (p.switching) { p.raf = requestAnimationFrame(tick); return; }
      var it = p.items[p.cur], t = p.time();
      if (it.v && it.t1 != null && t >= it.t1 - 0.04) { p.next(); return; }
      if (it.still && t >= it.dur) { p.next(); return; }
      // the next recording is made ready two seconds ahead, so the change never waits for it
      if (p.items.length > 1 && !p.prefetched && t > p.itemEnd(p.cur) - 2) {
        p.prefetched = true;
        var nx = p.items[(p.cur + 1) % p.items.length];
        if (nx.v && nx !== it) { load(nx.v); seek(nx.v, nx.t0 != null ? nx.t0 : 0); }
      }
      p.light(p.momentAt(p.cur, t));
      p.progress(p.whole());
      if (p.onTick) p.onTick(p, t);
      if (it.v && it.el.classList.contains("fit-contain") && (!p.bgAt || performance.now() - p.bgAt > 90)) { p.bgAt = performance.now(); p.drawBg(it, it.v); }
      p.raf = requestAnimationFrame(tick);
    }
    p.raf = requestAnimationFrame(tick);
  };
  Player.prototype.stopTick = function () { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } };
  Player.prototype.paint = function () {
    var b = this.toggle;
    if (!b) return;
    var l = b.querySelector("[data-label]");
    if (l) l.textContent = this.running ? "Pause" : "Play";
    b.classList.toggle("is-paused", !this.running);
    b.setAttribute("aria-label", (this.running ? "Pause" : "Play") + " the recording");
  };
  Player.prototype.play = function (byUser) {
    var p = this, it = p.items[p.cur];
    if (reduced() && !byUser && !p.user) return;
    p.running = true;
    if (it.v) {
      var t = it.v.currentTime, s = p.itemStart(p.cur), e = p.itemEnd(p.cur);
      if (it.t0 != null && (t < s - 0.05 || t >= e - 0.05)) seek(it.v, s, function () { if (p.running) playV(it.v); });
      else playV(it.v);
    } else {
      p.stillStart = performance.now();
    }
    p.startTick();
    p.paint();
  };
  Player.prototype.pause = function () {
    var p = this, it = p.items[p.cur];
    if (it.still && p.running) p.stillAt = p.time();
    p.running = false;
    p.stillStart = 0;
    quiet(it.v);
    p.stopTick();
    p.paint();
  };
  Player.prototype.toMoment = function (k) {
    var m = this.moments[k];
    if (!m) return;
    var i = +m.getAttribute("data-item"), t0 = num(m.getAttribute("data-t0"));
    var p = this;
    var go = function () {
      if (t0 == null) t0 = (num(m.getAttribute("data-f0")) || 0) * p.itemEnd(i);
      p.light(k);
      p.go(i, t0, !reduced());
    };
    var it = p.items[i];
    if (t0 == null && it.v && !it.v.duration) { load(it.v); whenMeta(it.v, go); } else go();
  };
  // show item i at time t; a dissolve unless motion is reduced
  Player.prototype.go = function (i, t, dissolve) {
    var p = this, from = p.items[p.cur], to = p.items[i];
    var keep = p.running || (p.user && !reduced());   // with reduced motion a jump never starts a recording
    if (reduced()) dissolve = false;
    p.switching = true;
    p.prefetched = false;
    var token = p.token = (p.token || 0) + 1;
    if (i === p.cur) {
      if (to.still) { p.stillAt = Math.max(0, t || 0); p.stillStart = p.running ? performance.now() : 0; p.switching = false; p.light(p.momentAt(i, t || 0)); p.progress(p.whole()); return; }
      var c = dissolve ? p.hold(to) : null;
      quiet(to.v);
      seek(to.v, t, function () {
        if (token !== p.token) { p.release(c); return; }
        p.switching = false;
        if (keep) { p.running = true; playV(to.v); p.startTick(); }
        else p.running = false;
        p.light(p.momentAt(i, t)); p.progress(p.whole()); p.paint();
        painted(to.v, function () { p.release(c); });
      });
      return;
    }
    // another item: it goes on underneath, the old one fades away on top of it
    var show = function () {
      if (token !== p.token) return;   // a later jump has replaced this one
      if (to.v) p.drawBg(to, to.v);
      to.el.classList.add("is-on");
      quiet(from.v);
      if (dissolve) {
        from.el.classList.add("is-leaving");
        void from.el.offsetWidth;
        from.el.classList.remove("is-on");
        setTimeout(function () { from.el.classList.remove("is-leaving"); }, FADE + 30);
      } else from.el.classList.remove("is-on");
      p.cur = i;
      p.switching = false;
      p.stillAt = to.still ? Math.max(0, t || 0) : 0;
      p.stillStart = 0;
      if (p.onItem) p.onItem(p, i);
      p.caps.forEach(function (c) { c.classList.toggle("is-on", +c.getAttribute("data-item") === i); });
      if (to.img && to.still) p.drawBg(to, to.img);
      p.light(p.momentAt(i, t || 0));
      p.progress(p.whole());
      p.running = false;
      if (keep) p.play(true); else { p.stopTick(); p.paint(); }
    };
    if (to.v) {
      load(to.v);
      seek(to.v, t || 0, function () { painted(to.v, show); });
    } else show();
  };
  Player.prototype.hold = function (it) {
    var v = it.v, c = this.snap;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    var fw = this.frame.clientWidth, fh = this.frame.clientHeight;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(fw * dpr); c.height = Math.round(fh * dpr);
    var ctx = c.getContext("2d");
    try {
      ctx.fillStyle = "#0d0f14"; ctx.fillRect(0, 0, c.width, c.height);
      var r = v.getBoundingClientRect(), fr = this.frame.getBoundingClientRect();
      // draw the frame where the recording sits (cover or contain), with its blurred backdrop when it has one
      if (it.bg && it.el.classList.contains("fit-contain")) {
        ctx.filter = "blur(" + Math.round(24 * dpr) + "px) brightness(0.62) saturate(1.25)";   // as .pl-bg in v5.css
        ctx.drawImage(it.bg, -0.1 * c.width, -0.1 * c.height, c.width * 1.2, c.height * 1.2);
        ctx.filter = "none";
      }
      var vw = v.videoWidth, vh = v.videoHeight, a = vw / vh, fa = fw / fh, dw, dh;
      if (it.el.classList.contains("fit-cover")) { if (a > fa) { dh = fh; dw = fh * a; } else { dw = fw; dh = fw / a; } }
      else { if (a > fa) { dw = fw; dh = fw / a; } else { dh = fh; dw = fh * a; } }
      ctx.drawImage(v, ((fw - dw) / 2) * dpr, ((fh - dh) / 2) * dpr, dw * dpr, dh * dpr);
      void r; void fr;
    } catch (e) { return null; }
    c.style.transition = "none";
    c.style.opacity = "1";
    return c;
  };
  Player.prototype.release = function (c) {
    if (!c) return;
    void c.offsetWidth;
    c.style.transition = reduced() ? "none" : "opacity " + FADE + "ms ease-in-out";
    c.style.opacity = "0";
  };
  // a recording that reaches its end wraps through a dissolve (single-item players)
  Player.prototype.wrap = function () { this.go(this.cur, this.itemStart(this.cur), true); };
  Player.prototype.next = function () {
    var n = this.items.length;
    if (n === 1) { this.wrap(); return; }
    var i = (this.cur + 1) % n;
    this.go(i, this.itemStart(i), true);
  };

  $all("[data-player]").forEach(function (el) { new Player(el); });

  /* ---------------------------------------------------------------- which players may play: the ones most in view */
  var auto = players.filter(function (p) { return p.el.hasAttribute("data-autoplay"); });
  var scores = new Map();
  function choose() {
    if (doc.hidden) { players.forEach(function (p) { if (p.running) p.pause(); }); return; }
    // a player the reader started keeps a small lead, so it is not dropped the moment another comes into view
    function score(p) { return (scores.get(p) || 0) + (p.user ? 0.25 : 0); }
    var ranked = auto.filter(function (p) { return score(p) >= 0.55; }).sort(function (a, b) { return score(b) - score(a); });
    var keep = ranked.slice(0, MAX);
    auto.forEach(function (p) {
      var on = keep.indexOf(p) >= 0 && !p.hover;
      p.allowed = on;
      if (!on && p.running) p.pause();
      if ((scores.get(p) || 0) < 0.05) { p.user = false; p.held = false; }
      if (on && !p.running && !p.held && (!reduced() || p.user)) p.play(p.user);
    });
  }
  if ("IntersectionObserver" in window && auto.length) {
    var steps = []; for (var s = 0; s <= 20; s++) steps.push(s / 20);
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var p = e.target.__player || (e.target.querySelector("[data-player]") || {}).__player;
        if (!p) return;
        var vh = window.innerHeight || 1;
        scores.set(p, e.isIntersecting ? Math.max(e.intersectionRatio, e.intersectionRect.height / vh) : 0);
      });
      choose();
    }, { threshold: steps });
    auto.forEach(function (p) { io.observe(p.el.closest("[data-view]") || p.el); (p.el.closest("[data-view]") || p.el).__player = p; });
  }
  doc.addEventListener("visibilitychange", choose);

  /* ---------------------------------------------------------------- load ahead
     A recording starts downloading about one screen before its player comes into view, so it can start at once when
     the reader gets there. Only after the page itself has loaded, and not with reduced motion or Save-Data. */
  function loadAhead() {
    if (!("IntersectionObserver" in window) || !auto.length) return;
    if (navigator.connection && navigator.connection.saveData) return;
    var ahead = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting || reduced()) return;
        var p = e.target.__player;
        var it = p && p.items[p.cur];
        if (it && it.v) load(it.v);
        ahead.unobserve(e.target);
      });
    }, { rootMargin: "100% 0px 100% 0px" });
    auto.forEach(function (p) { ahead.observe(p.el.closest("[data-view]") || p.el); });
  }
  if (doc.readyState === "complete") setTimeout(loadAhead, 300);
  else window.addEventListener("load", function () { setTimeout(loadAhead, 300); });
  onChange(mqReduce, function () { players.forEach(function (p) { if (p.running && !p.user) p.pause(); }); choose(); });
  window.V5 = { players: players, choose: choose };

  /* ---------------------------------------------------------------- Option 2 · Showreel */
  $all("[data-showreel]").forEach(function (sr) {
    var p = sr.querySelector("[data-player]").__player;
    if (!p) return;
    var tabs = $all("[data-tab]", sr), heads = $all("[data-head]", sr);
    function mark(i) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
        if (!on) t.style.setProperty("--f", k < i ? 1 : 0);
      });
      heads.forEach(function (h) { h.classList.toggle("is-on", +h.getAttribute("data-head") === i); });
      if (stage && tabs[i]) stage.setAttribute("aria-labelledby", tabs[i].id);
    }
    p.onItem = function (pl, i) { mark(i); };
    p.onTick = function (pl, t) {
      var tab = tabs[pl.cur];
      if (tab) tab.style.setProperty("--f", Math.max(0, Math.min(1, (t - pl.itemStart(pl.cur)) / pl.itemLength(pl.cur))).toFixed(4));
    };
    tabs.forEach(function (t, k) {
      t.addEventListener("click", function () {
        // with reduced motion a tab only changes the picture; Play starts it
        if (!reduced()) { p.user = true; p.held = false; }
        if (k === p.cur) { if (!p.running && !reduced()) p.play(true); return; }
        p.go(k, p.itemStart(k), true);
      });
      t.addEventListener("keydown", function (e) {
        var to = null, n = tabs.length;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") to = (k + 1) % n;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = (k - 1 + n) % n;
        else if (e.key === "Home") to = 0; else if (e.key === "End") to = n - 1;
        if (to === null) return;
        e.preventDefault();
        tabs[to].focus();
        tabs[to].click();
      });
    });
    // pointing at the player pauses it; leaving it lets it play on
    var stage = sr.querySelector(".sr-player");
    stage.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "touch") return;
      p.hover = true; sr.classList.add("is-held");
      if (p.running) { p.pause(); p.resumeAfterHover = true; }
    });
    stage.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "touch") return;
      p.hover = false; sr.classList.remove("is-held");
      if (p.resumeAfterHover) { p.resumeAfterHover = false; if (p.allowed || p.user) p.play(p.user); }
      choose();
    });
    mark(0);
  });

  // "See it in the showreel" (the live grid's summaries): the showreel moves to that tool and comes into view
  $all("[data-reel-jump]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      var sr = doc.querySelector("[data-showreel]"), p = sr && (sr.querySelector("[data-player]") || {}).__player;
      if (!p) return;
      e.preventDefault();
      var k = +a.getAttribute("data-reel-jump");
      if (!reduced()) { p.user = true; p.held = false; }
      if (k !== p.cur) p.go(k, p.itemStart(k), true); else if (!p.running && !reduced()) p.play(true);
      sr.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      var tab = sr.querySelectorAll("[data-tab]")[k];
      if (tab) tab.focus({ preventScroll: true });
    });
  });

  /* ---------------------------------------------------------------- Option 3 · Bento: a tile opens in place */
  $all("[data-bento]").forEach(function (grid) {
    var tiles = $all(".bt-tile", grid), openTile = null, busy = false;
    function rects() { var m = new Map(); tiles.forEach(function (t) { m.set(t, t.getBoundingClientRect()); }); return m; }
    function flip(before, grown) {
      if (reduced()) return;
      tiles.forEach(function (t) {
        var a = before.get(t), b = t.getBoundingClientRect();
        if (!a) return;
        var dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
        var resized = Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01;
        t.style.transition = "none";
        t.style.transformOrigin = "0 0";
        t.style.transform = "translate(" + dx + "px," + dy + "px)" + (resized ? " scale(" + sx + "," + sy + ")" : "");
        if (resized) t.classList.add("is-morphing");
      });
      void grid.offsetHeight;
      tiles.forEach(function (t) {
        if (!t.style.transform) return;
        t.style.transition = "transform " + FADE + "ms cubic-bezier(.4,0,.2,1)";
        t.style.transform = "";
        var done = function () {
          t.removeEventListener("transitionend", done);
          t.style.transition = ""; t.style.transformOrigin = "";
          t.classList.remove("is-morphing");
        };
        t.addEventListener("transitionend", done);
        setTimeout(done, FADE + 80);
      });
    }
    // Opening or closing: the tile's words and picture fade out (120 ms), the grid takes its new shape with every
    // tile gliding to its place (FLIP, 360 ms; a tile that changes size keeps its contents hidden meanwhile), then
    // the contents fade back in. With reduced motion the grid simply changes.
    var PRE = 130;
    function settle(t, fn) {
      if (reduced()) { fn(); return; }
      t.classList.add("is-fading");
      setTimeout(function () { fn(); t.classList.remove("is-fading"); }, PRE);
    }
    function open(t) {
      if (busy || openTile === t) return;
      busy = true;
      var prev = openTile;
      if (prev) prev.classList.add("is-fading");
      settle(t, function () {
        var before = rects();
        if (prev) { close(prev, true); prev.classList.remove("is-fading"); }
        t.classList.add("is-open");
        var b = t.querySelector("[data-open]");
        if (b) { b.setAttribute("aria-expanded", "true"); var l = b.querySelector("[data-open-label]"); if (l) l.textContent = "Close"; }
        openTile = t;
        flip(before, t);
        var p = (t.querySelector("[data-player]") || {}).__player;
        if (p) {
          p.fit();
          if (!reduced()) { p.user = true; p.held = false; if (!p.running) p.play(true); }
          choose();
        }
        var h = t.querySelector(".bt-name");
        if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
        var nav = (doc.querySelector("[data-header]") || {}).offsetHeight || 64;
        setTimeout(function () {
          var r = t.getBoundingClientRect();
          if (r.top < nav + 8 || r.bottom > window.innerHeight) window.scrollTo({ top: window.pageYOffset + r.top - nav - 16, behavior: reduced() ? "auto" : "smooth" });
        }, reduced() ? 0 : FADE + 20);
        setTimeout(function () { busy = false; }, reduced() ? 0 : FADE);
      });
    }
    function close(t, quiet) {
      if (!t) return;
      var shut = function () {
        var before = quiet ? null : rects();
        t.classList.remove("is-open");
        var b = t.querySelector("[data-open]");
        if (b) { b.setAttribute("aria-expanded", "false"); var l = b.querySelector("[data-open-label]"); if (l) l.textContent = "Open"; }
        if (openTile === t) openTile = null;
        var p = (t.querySelector("[data-player]") || {}).__player;
        if (p) {
          p.user = false;
          if (!p.el.hasAttribute("data-autoplay") && p.running) p.pause();   // a tile that shows something else when closed
          p.fit();
          choose();
        }
        if (!quiet) { flip(before, null); if (b) b.focus({ preventScroll: true }); }
      };
      if (quiet) { shut(); return; }
      if (busy) return;
      busy = true;
      settle(t, function () { shut(); setTimeout(function () { busy = false; }, reduced() ? 0 : FADE); });
    }
    tiles.forEach(function (t) {
      var b = t.querySelector("[data-open]");
      if (b) b.addEventListener("click", function () { if (openTile === t) close(t); else open(t); });
      $all("[data-close]", t).forEach(function (c) { c.addEventListener("click", function () { close(t); }); });
      t.addEventListener("keydown", function (e) { if (e.key === "Escape" && openTile === t) { e.preventDefault(); close(t); } });
    });
    // the index at the end opens a tile
    $all("[data-open-tile]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        var t = doc.getElementById(a.getAttribute("data-open-tile"));
        if (!t) return;
        e.preventDefault();
        open(t);
      });
    });
  });

  /* ---------------------------------------------------------------- the live grid at the end (Options 1 and 2) */
  function smoothLoop(v, box) {
    var snap = null, last = 0, raf = 0;
    function hold() {
      if (v.readyState < 2 || !v.videoWidth) return null;
      var c = box.querySelector("canvas.snap");
      if (!c) { c = doc.createElement("canvas"); c.className = "snap"; c.setAttribute("aria-hidden", "true"); box.appendChild(c); }
      c.width = v.videoWidth; c.height = v.videoHeight;
      try { c.getContext("2d").drawImage(v, 0, 0); } catch (e) { return null; }
      c.style.transition = "none"; c.style.opacity = "1";
      return c;
    }
    function tick() {
      raf = 0;
      if (v.paused) return;
      var ct = v.currentTime, dur = v.duration || 0;
      if (!snap && dur && ct > dur - 0.14) snap = hold();
      if (snap && ct < last - 0.5) { var c = snap; snap = null; void c.offsetWidth; c.style.transition = "opacity " + FADE + "ms ease-in-out"; c.style.opacity = "0"; }
      last = ct;
      raf = requestAnimationFrame(tick);
    }
    v.addEventListener("playing", function () { last = v.currentTime; if (!raf) raf = requestAnimationFrame(tick); });
    v.addEventListener("pause", function () { if (snap) { snap.style.opacity = "0"; snap = null; } });
  }
  $all("[data-recap]").forEach(function (sec) {
    var grid = sec.querySelector("[data-grid]");
    if (!grid) return;
    grid.classList.add("js-grid");
    var tiles = $all(".rc-tile", grid), drawers = $all(".rc-drawer", grid);
    drawers.forEach(function (d) { d.hidden = true; grid.appendChild(d); });
    function tileOf(id) { return tiles.filter(function (t) { return t.getAttribute("data-tile") === id; })[0]; }
    function drawerOf(id) { return drawers.filter(function (d) { return d.getAttribute("data-drawer") === id; })[0]; }
    function shown() { return tiles.filter(function (t) { return !t.hidden; }); }
    var hov = [];
    tiles.forEach(function (tile) {
      var media = tile.querySelector("[data-hoverplay]"), v = media && media.querySelector("video");
      if (!v) return;
      var it = { tile: tile, media: media, v: v };
      hov.push(it);
      smoothLoop(v, media);
      v.addEventListener("playing", function () { media.classList.add("is-playing"); });
      it.start = function () { if (!reduced()) playV(v); };
      it.stop = function () { if (!v.paused) v.pause(); media.classList.remove("is-playing"); };
      tile.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse" || e.pointerType === "pen") it.start(); });
      tile.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") it.stop(); });
      tile.addEventListener("focusin", function () { it.start(); });
      tile.addEventListener("focusout", function (e) { if (!tile.contains(e.relatedTarget)) it.stop(); });
    });
    function dvideo(d) { return d ? d.querySelector("[data-dplay] video") : null; }
    function paintD(d) {
      var b = d.querySelector("[data-dtoggle]"), v = dvideo(d);
      if (!b) return;
      b.hidden = !v;
      if (!v) return;
      b.classList.toggle("is-paused", v.paused);
      b.querySelector("[data-label]").textContent = v.paused ? "Play" : "Pause";
      b.setAttribute("aria-label", v.paused ? "Play the recording" : "Pause the recording");
    }
    drawers.forEach(function (d) {
      var v = dvideo(d), b = d.querySelector("[data-dtoggle]");
      if (!v) { if (b) b.hidden = true; return; }
      smoothLoop(v, v.closest("[data-dplay]"));
      v.addEventListener("playing", function () { v.closest("[data-dplay]").classList.add("is-playing"); paintD(d); });
      v.addEventListener("pause", function () { paintD(d); });
      if (b) b.addEventListener("click", function () { if (v.paused) playV(v); else v.pause(); });
    });
    var openId = null, closing = {};
    function rowEnd(tile) {
      var top = tile.getBoundingClientRect().top, last = tile;
      shown().forEach(function (t) { if (Math.abs(t.getBoundingClientRect().top - top) < 4) last = t; });
      return last;
    }
    function place(d, tile) {
      var end = rowEnd(tile);
      if (end.nextSibling !== d) grid.insertBefore(d, end.nextSibling);
      var tr = tile.getBoundingClientRect(), gr = grid.getBoundingClientRect();
      d.style.setProperty("--notch", Math.round(tr.left - gr.left + tr.width / 2) + "px");
    }
    function setBtn(id, isOpen) {
      var b = grid.querySelector('[data-open="' + id + '"]');
      if (!b) return null;
      b.setAttribute("aria-expanded", isOpen ? "true" : "false");
      var l = b.querySelector("[data-open-label]");
      if (l) l.textContent = isOpen ? "Close" : "Open";
      return b;
    }
    function close(id, opts) {
      opts = opts || {};
      var d = drawerOf(id), tile = tileOf(id);
      if (!d) return;
      d.classList.remove("is-open");
      var v = dvideo(d);
      if (v && !v.paused) v.pause();
      if (tile) tile.classList.remove("is-open");
      var b = setBtn(id, false);
      if (openId === id) openId = null;
      clearTimeout(closing[id]);
      var done = function () { if (!d.classList.contains("is-open")) { d.hidden = true; grid.appendChild(d); } };
      if (reduced() || opts.instant) done(); else closing[id] = setTimeout(done, FADE);
      if (opts.focus && b) b.focus();
    }
    function open(id) {
      var d = drawerOf(id), tile = tileOf(id);
      if (!d || !tile || tile.hidden) return;
      if (openId && openId !== id) close(openId, { instant: true });
      clearTimeout(closing[id]);
      place(d, tile);
      d.hidden = false;
      void d.offsetHeight;
      d.classList.add("is-open");
      tile.classList.add("is-open");
      setBtn(id, true);
      openId = id;
      var v = dvideo(d);
      if (v && !reduced()) playV(v);
      paintD(d);
      var tr = tile.getBoundingClientRect(), nav = (doc.querySelector("[data-header]") || {}).offsetHeight || 64;
      if (tr.top < nav + 8 || tr.bottom > window.innerHeight * 0.6) window.scrollTo({ top: window.pageYOffset + tr.top - nav - 16, behavior: reduced() ? "auto" : "smooth" });
      var hd = d.querySelector(".rc-dname");
      if (hd) hd.focus({ preventScroll: true });
    }
    $all("[data-open]", grid).forEach(function (b) {
      b.addEventListener("click", function () { var id = b.getAttribute("data-open"); if (openId === id) close(id, { focus: true }); else open(id); });
    });
    drawers.forEach(function (d) {
      var id = d.getAttribute("data-drawer");
      $all("[data-close]", d).forEach(function (b) { b.addEventListener("click", function () { close(id, { focus: true }); }); });
      d.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); close(id, { focus: true }); } });
    });
    var rz = 0;
    window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(function () { if (openId) place(drawerOf(openId), tileOf(openId)); }, 120); });
    var chips = $all("[data-filter]", sec), status = sec.querySelector("[data-filter-status]");
    function filter(key) {
      var before = new Map();
      shown().forEach(function (t) { before.set(t, t.getBoundingClientRect()); });
      chips.forEach(function (c) { c.setAttribute("aria-pressed", c.getAttribute("data-filter") === key ? "true" : "false"); });
      tiles.forEach(function (t) { var th = (t.getAttribute("data-themes") || "").split(/\s+/); t.hidden = !(key === "all" || th.indexOf(key) >= 0); });
      if (openId) { var ot = tileOf(openId); if (ot.hidden) close(openId, { instant: true }); else place(drawerOf(openId), ot); }
      var vis = shown();
      if (status) {
        var chip = chips.filter(function (c) { return c.getAttribute("data-filter") === key; })[0];
        status.textContent = "Showing " + vis.length + " of " + tiles.length + " tools" + (key === "all" ? "" : ": " + chip.firstChild.textContent.trim());
      }
      hov.forEach(function (it) { if (it.tile.hidden) it.stop(); });
      if (reduced()) return;
      vis.forEach(function (t) {
        var a = before.get(t), b = t.getBoundingClientRect();
        t.style.transition = "none";
        if (a) { var dx = a.left - b.left, dy = a.top - b.top; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; t.style.transform = "translate(" + dx + "px," + dy + "px)"; }
        else t.style.opacity = "0";
      });
      void grid.offsetHeight;
      vis.forEach(function (t) {
        t.style.transition = "transform .36s cubic-bezier(.4,0,.2,1), opacity .3s ease";
        t.style.transform = ""; t.style.opacity = "";
        t.addEventListener("transitionend", function clean() { t.style.transition = ""; t.removeEventListener("transitionend", clean); });
      });
    }
    chips.forEach(function (c) { c.addEventListener("click", function () { filter(c.getAttribute("data-filter")); }); });
  });

  /* ---------------------------------------------------------------- the feelings flower, live (its tile only) */
  $all("[data-flower]").forEach(function (box) {
    var media = box.closest(".rc-media, .bt-flower");
    var D = window.FEELINGS_DATA;
    if (!D || !window.Flower || !window.Clay) { if (media) media.classList.add("no-flower"); return; }
    var fam = {}, word = {}, ord = {}, by = {};
    D.families.forEach(function (f) { fam[f.id] = f; });
    D.words.forEach(function (w, i) { word[w.id] = w; ord[w.id] = i; });
    D.families.forEach(function (f) { by[f.id] = D.words.filter(function (w) { return w.family === f.id; }).sort(function (a, b) { return a.intensity - b.intensity || ord[a.id] - ord[b.id]; }); });
    var href = box.getAttribute("data-href");
    try {
      window.Flower.create(box, D, {
        statesIn: function (id) { return by[id] || []; },
        faceLook: function (f) { var w = word[f.face] || by[f.id][0]; return window.Clay.look(w, fam[w.family]); },
        onFamily: function (id) { location.href = href + "#family=" + id; }
      });
    } catch (e) { if (media) media.classList.add("no-flower"); }
  });
})();
