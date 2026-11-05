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
  // Clear over the galaxy at the top of Home; solid as soon as the first line of the hero's text would reach it, so
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
