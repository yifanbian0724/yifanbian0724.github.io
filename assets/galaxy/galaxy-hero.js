/*! galaxy-hero.js 2.0.2 -- Yifan Bian's Literature Galaxy as a live, data-driven network.
 *
 * Every star is a PDF in the research library, placed where the library's own 3D map puts it and coloured by
 * its topic region; faint lines join each item to the ten items that read most like it, and points of light run
 * along the links. It turns slowly, can be dragged, and names a paper on hover or tap.
 *
 * It draws what the original Literature Galaxy draws (the 3D view of Yifan's own app): the same camera (55 degree
 * field of view, 820 units from the centre, opening straight on), the same star sprite and colour mix (pale, nearly
 * white cores tinted by the topic colour), every link of the 10-nearest-neighbour web in its item's colour at the
 * same strength, with the same depth fog, the same flowing light and the same turning speed. The original turns by a
 * fixed angle per screen frame, so its speed follows the screen (a turn every ~86 s at 60 Hz, every ~43 s at 120 Hz);
 * this galaxy measures the frame rate it is shown at and turns at the original's pace for it (60 to 120 Hz).
 *
 * No dependencies: WebGL, with a Canvas 2D fallback, and the poster image if neither can draw.
 * Auto-mounts on every [data-galaxy] element:
 *   data-src            URL of galaxy-data.json (the only request this script makes, besides a poster)
 *   data-poster         still image: a placeholder if the galaxy is slow to arrive, and the fallback
 *   data-mode           "hero" (behind text, dimmed under it) | "panel" (full interactive)  default panel
 *   data-labels         "none" | "regions" (topic-region names fade in near their centres)   default none
 *   data-interactive    "true" | "false" (false: a pure background, no pointer handling)    default true
 *   data-align          "right" | "center" (where the galaxy's centre sits)                    default center
 * Optional:
 *   data-poster-narrow  poster for a narrow or portrait hero (rendered with that framing)
 *   data-canvas-label   what a screen reader hears for an interactive galaxy (its canvas takes the keyboard focus);
 *                       a host that is itself labelled (role="img" with an aria-label) and not interactive keeps its
 *                       own label, and its canvas is hidden from assistive technology
 *   data-avoid          CSS selector list of the blocks of text laid over the galaxy, up to 4 ("none" to turn
 *                       off): stars under them are dimmed and cannot be picked, the hover card keeps clear of
 *                       them, and in a hero the block with the h1/h2 sets how far the galaxy's dimmed side
 *                       reaches. In a hero the default is the block that holds the h1 (or h2) plus the other
 *                       small blocks of text beside the galaxy (a nav, a caption).
 *   CSS custom properties --galaxy-x / --galaxy-y (centre, fraction of width / height) and --galaxy-size (radius of
 *   the bulk of the galaxy, fraction of the shorter side); read when the element is resized.
 *
 * It never captures page scrolling or zooming (no wheel handler; touch-action pan-y pinch-zoom), creates its
 * renderer only when it comes near the viewport, pauses off screen and in hidden tabs, draws the idle spin at up to
 * 60 fps on a desktop at full quality and ~30 fps on phones and lower tiers, caps devicePixelRatio at 2, adapts its
 * quality both ways, and draws one still frame (no turning, no flowing light) with prefers-reduced-motion.
 * window.GalaxyHero.mount(el) mounts an element added later; add ?gxperf to the page URL for a small frame-time
 * readout.
 */
(function (global) {
  "use strict";
  if (global.GalaxyHero && global.GalaxyHero.version) return;

  var doc = global.document;
  var VERSION = "2.0.2";
  var DPR_CAP = 2;
  var DATA = {};
  var INSTANCES = [];
  var reducedQuery = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
  // Node fields (galaxy-data.json v2 and v3): x, y, z, group, year, first author, title.
  var NG = 3, NY = 4, NA = 5, NT = 6;
  // How the shipped posters were rendered: the render's CSS size, and the
  // galaxy's centre and radius in it. A poster is scaled and placed so that its galaxy lands exactly where the
  // live one will be drawn, whatever the container's shape.
  var POSTER_FRAMES = {
    wide: { w: 1440, h: 900, cx: 979.2, cy: 468, R: 324 },
    narrow: { w: 390, h: 844, cx: 195, cy: 590.8, R: 148.2 }
  };
  // The original Literature Galaxy's 3D view (three.js r147), in its own units: the data's coordinates are the
  // original's.
  var ORIG = {
    dist: 820,             // the camera's distance from the centre (R3_HOME_DISTANCE), looking straight on
    fov: 55,               // vertical field of view, degrees (PerspectiveCamera(55, ...))
    star: 12,              // star sprite, device px at 820 units away (base 12 for a paper); never under 3 px
    starMin: 3,
    link: 0.2,             // a link's colour: its item's colour x 0.2 (r3Refresh), at opacity 0.5, added
    linkOpacity: 0.5,
    fog: 0.0005,           // FogExp2(0x03040a, 0.0005): links and the light fade a little with depth
    fogColour: [3 / 255, 4 / 255, 10 / 255],
    flowSize: 6.5,         // the light: PointsMaterial size 6.5 with size attenuation
    flowTrip: 9000,        // ms for one trip along a link at speed 1 (FLOW_MS_PER_TRIP)
    // OrbitControls autoRotateSpeed 0.7, which three.js r147 applies once per animation frame (2 pi / 3600 x 0.7 rad
    // each time the original draws): 0.0733 rad/s at 60 Hz, 0.147 rad/s at 120 Hz (a MacBook Pro screen in Chrome)
    spinFrame: 2 * Math.PI / 3600 * 0.7,
    hzMin: 60, hzMax: 120, // the frame rates the turn follows: slower screens turn as at 60 Hz, faster ones as at 120
    prCap: 2               // the original caps the pixel ratio at 2; its star size is in device px
  };
  // The bulk radius (CSS px) at which the original's look is matched one to one: the original full screen at
  // 900 px tall. Stars and the number of links scale gently away from it, so a small galaxy keeps the same look.
  var R_REF = 374;

  // ------------------------------------------------------------------ small helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(e0, e1, x) { var t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
  function ease(cur, target, dt, tau) { return cur + (target - cur) * (1 - Math.exp(-dt / tau)); }
  function hexRgb(h) { var n = parseInt(String(h).slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function cssRgba(s) {   // "rgb(11, 13, 20)" / "rgba(0, 0, 0, 0)" -> [r, g, b, a] (0..1), or null
    var m = /^rgba?\(([^)]*)\)/.exec(String(s || "").trim());
    if (!m) return null;
    var p = m[1].split(/[\s,\/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(function (v) { return !isFinite(v); })) return null;
    return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function clipWords(s, n) {
    s = String(s || "");
    if (s.length <= n) return s;
    var c = s.slice(0, n - 1), k = c.lastIndexOf(" ");
    return (k > n * 0.6 ? c.slice(0, k) : c) + "…";
  }
  function now() { return global.performance && performance.now ? performance.now() : Date.now(); }
  function cssNum(style, name) { var v = parseFloat(style.getPropertyValue(name)); return isFinite(v) ? v : null; }
  function median(arr) { if (!arr.length) return null; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[s.length >> 1]; }
  function isWide(W, H) { return W >= 720 && W / H >= 1.05; }
  function overlap(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    return w > 0 && h > 0 ? w * h : 0;
  }
  function listen(mq, fn, on) {
    if (!mq) return;
    if (on) { if (mq.addEventListener) mq.addEventListener("change", fn); else if (mq.addListener) mq.addListener(fn); }
    else if (mq.removeEventListener) mq.removeEventListener("change", fn); else if (mq.removeListener) mq.removeListener(fn);
  }

  // The box a block of text really covers (its line boxes, controls and filled shapes such as buttons and chips),
  // in viewport coordinates, or null.
  function textBox(root) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    function add(r) {
      if (!r || r.width < 1 || r.height < 1) return;
      if (r.left < b[0]) b[0] = r.left; if (r.top < b[1]) b[1] = r.top;
      if (r.right > b[2]) b[2] = r.right; if (r.bottom > b[3]) b[3] = r.bottom;
    }
    var range = doc.createRange(), walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null), n, k;
    while ((n = walker.nextNode())) {
      if (!/\S/.test(n.nodeValue)) continue;
      range.selectNodeContents(n);
      var rs = range.getClientRects();
      for (k = 0; k < rs.length; k++) add(rs[k]);
    }
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll ? root.querySelectorAll("*") : []));
    for (k = 0; k < all.length; k++) {
      var e = all[k];
      if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|IMG|SVG|VIDEO)$/i.test(e.tagName)) { add(e.getBoundingClientRect()); continue; }
      var st = global.getComputedStyle(e);
      if (st.boxShadow !== "none" || st.backgroundImage !== "none" || !/^(transparent|rgba\(\d+, \d+, \d+, 0\))$/.test(st.backgroundColor)) add(e.getBoundingClientRect());
    }
    return b[0] < b[2] && b[1] < b[3] ? b : null;
  }

  // ------------------------------------------------------------------ styles (scoped, injected once)
  var CSS = [
    ".gx-host{--gx-surface:rgba(20,24,36,.97);--gx-line:#262d40;--gx-text:#e7eaf3;--gx-muted:#8a93a8;--gx-soft:#b6bdd0;",
    "--gx-font:Sora,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--gx-mono:'DM Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
    // lighten: the poster's dark ground never covers the page's own background (no seam where the image ends)
    ".gx-poster{position:absolute;inset:0;background-repeat:no-repeat;pointer-events:none;transition:opacity .9s ease;mix-blend-mode:lighten}",
    ".gx-poster.gx-off{opacity:0}",
    ".gx-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity .9s ease;outline:none;",
    "-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}",
    ".gx-canvas.gx-on{opacity:1}",
    // vertical swipes scroll the page and two fingers zoom it; only horizontal drags turn the galaxy
    ".gx-canvas.gx-int{touch-action:pan-y;touch-action:pan-y pinch-zoom;cursor:grab}",
    ".gx-canvas.gx-int.gx-point{cursor:pointer}",
    ".gx-canvas.gx-int.gx-drag{cursor:grabbing}",
    ".gx-canvas:focus-visible{box-shadow:inset 0 0 0 2px rgba(110,168,255,.55);border-radius:inherit}",
    ".gx-labels{position:absolute;inset:0;overflow:hidden;pointer-events:none}",
    ".gx-label{position:absolute;left:0;top:0;white-space:nowrap;padding:3px 7px 3px 6px;border-radius:6px;background:rgba(11,13,20,.62);",
    "font:500 10.5px/1.2 var(--gx-mono);letter-spacing:.08em;text-transform:uppercase;color:rgba(231,234,243,.88);opacity:0;",
    "transition:opacity .45s ease;will-change:transform,opacity}",
    ".gx-label i{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:7px;vertical-align:1px;box-shadow:0 0 8px currentColor}",
    ".gx-ring{position:absolute;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;pointer-events:none;opacity:0;",
    "box-shadow:0 0 0 1.5px rgba(255,255,255,.92),0 0 14px 2px rgba(110,168,255,.45);transition:opacity .15s ease}",
    ".gx-tip{position:absolute;left:0;top:0;z-index:2;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100% - 16px));",
    "padding:10px 12px 11px;border-radius:10px;background:var(--gx-surface);color:var(--gx-text);",
    "box-shadow:0 0 0 1px var(--gx-line),0 14px 34px -14px rgba(0,0,0,.8);font:500 13px/1.38 var(--gx-font);",
    "pointer-events:none;opacity:0;transition:opacity .14s ease}",
    ".gx-tip.gx-show{opacity:1}",
    ".gx-narrow .gx-tip{padding:9px 11px 10px;font-size:12.5px}",
    ".gx-tip-t{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;letter-spacing:-.005em}",
    ".gx-tip-m{margin-top:7px;font:400 11px/1.3 var(--gx-mono);color:var(--gx-muted);letter-spacing:.02em}",
    ".gx-tip-r{margin-top:5px;font:400 11px/1.3 var(--gx-mono);color:var(--gx-soft);letter-spacing:.02em}",
    ".gx-tip-r i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:0}",
    ".gx-perf{position:fixed;left:8px;bottom:8px;z-index:2147483000;max-width:calc(100% - 16px);padding:6px 8px;border-radius:6px;",
    "background:rgba(0,0,0,.78);color:#e7eaf3;font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none}"
  ].join("");
  function injectStyle() {
    if (doc.getElementById("gx-style")) return;
    var s = doc.createElement("style");
    s.id = "gx-style";
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  // ------------------------------------------------------------------ data
  function loadData(url) {
    var key = new URL(url, doc.baseURI).href;
    if (!DATA[key]) {
      // credentials "same-origin" matches a <link rel="preload" as="fetch" crossorigin> in the page's head
      DATA[key] = fetch(key, { credentials: "same-origin" }).then(function (r) {
        if (!r.ok) throw new Error("galaxy data: HTTP " + r.status);
        return r.json();
      }).then(prepare);
    }
    return DATA[key];
  }

  // Positions are scaled so the bulk of the library (90% of items) sits inside radius 1 (R90 data units), turning
  // about the data's origin as the original does (older files: about their mean); the few items far out may leave
  // the frame, as they do in the original. y is flipped, as the original draws (x, -y, z).
  // The links are rebuilt the way the original builds them: every pair in the items' nearest-
  // neighbour lists once, in the colour of the item whose list names it first. They are kept ordered by the
  // closest rank that made them, so a prefix is a lighter web of each item's nearest links (quality tiers).
  // The light (the original's flowEdges): from every item along its strongest link, 0.6 + s trips per 9 s.
  function prepare(raw) {
    var nodes = raw.nodes, groups = raw.groups, i, j, r, d;
    var ver = raw.v || 1, links = raw.links || [];
    if (ver < 2) {   // a version-1 file: [x, y, z, g, cluster, year, author, title] and [a, b, s] links
      nodes = nodes.map(function (q) { return [q[0], q[1], q[2], q[3], q[5], q[6], q[7]]; });
      groups = groups.map(function (g) { return [g[0], g[1], g[2], 0]; });
      var flat = [];
      links.forEach(function (l) { flat.push(l[0], l[1]); });
      links = flat;
    }
    var n = nodes.length;
    var mx = 0, my = 0, mz = 0;
    if (ver < 3) {
      for (i = 0; i < n; i++) { mx += nodes[i][0]; my += nodes[i][1]; mz += nodes[i][2]; }
      mx /= n; my /= n; mz /= n;
    }
    var r2 = new Float64Array(n);
    for (i = 0; i < n; i++) {
      d = nodes[i];
      r2[i] = (d[0] - mx) * (d[0] - mx) + (d[1] - my) * (d[1] - my) + (d[2] - mz) * (d[2] - mz);
    }
    var sorted = Array.prototype.slice.call(r2).sort(function (a, b) { return a - b; });
    var R = Math.sqrt(sorted[Math.floor(n * 0.9)]) || 1;
    var gcol = groups.map(function (g) { return hexRgb(g[1]); });
    var pos = new Float32Array(n * 3), col = new Float32Array(n * 3), misc = new Float32Array(n * 3);
    for (i = 0; i < n; i++) {
      d = nodes[i];
      pos[3 * i] = (d[0] - mx) / R; pos[3 * i + 1] = -(d[1] - my) / R; pos[3 * i + 2] = (d[2] - mz) / R;
      var c = gcol[d[NG]] || [0.8, 0.85, 1];
      col[3 * i] = c[0]; col[3 * i + 1] = c[1]; col[3 * i + 2] = c[2];
      misc[3 * i] = 1;                 // size: every paper the same, as in the original (the highlight enlarges)
      misc[3 * i + 1] = 0;
      misc[3 * i + 2] = d[NG];         // group, for focus
    }
    // links: ea[k] (whose colour), eb[k], er[k] (the closest neighbour rank that made the pair)
    var ea = [], eb = [], er = [], flowTo = new Int32Array(n), flowV = new Float32Array(n), key, e;
    for (i = 0; i < n; i++) flowTo[i] = -1;
    if (raw.nb) {
      var k = raw.k || 10, nb = raw.nb, seen = new Map();
      for (i = 0; i < n; i++) {
        for (r = 0; r < k; r++) {
          j = nb[i * k + r];
          if (j == null || j < 0 || j >= n || j === i) continue;
          key = i < j ? i * 65536 + j : j * 65536 + i;
          e = seen.get(key);
          if (e === undefined) { seen.set(key, ea.length); ea.push(i); eb.push(j); er.push(r); }
          else if (r < er[e]) er[e] = r;
        }
        j = nb[i * k];
        if (j != null && j >= 0 && j < n && j !== i) {
          flowTo[i] = j;
          flowV[i] = 0.6 + (raw.flow && raw.flow[i] != null ? raw.flow[i] / 10 : 0.8);
        }
      }
    } else {
      // v1/v2: the file's own pairs, strongest first within each tier; each item's light runs along its first link
      var tiers = raw.tiers || [links.length >> 1];
      for (i = 0; i < links.length >> 1; i++) {
        var a0 = links[2 * i], b0 = links[2 * i + 1];
        for (r = 0; r < tiers.length - 1 && i >= tiers[r]; r++) { /* the tier this pair is in */ }
        ea.push(a0); eb.push(b0); er.push(r);
        if (flowTo[a0] < 0) { flowTo[a0] = b0; flowV[a0] = 1.4; }
        if (flowTo[b0] < 0) { flowTo[b0] = a0; flowV[b0] = 1.4; }
      }
    }
    var L = ea.length, order = new Array(L);
    for (i = 0; i < L; i++) order[i] = i;
    order.sort(function (p, q) { return er[p] - er[q] || p - q; });
    var lpos = new Float32Array(L * 6), lcol = new Float32Array(L * 6), lflat = new Uint16Array(L * 2), rankCum = [];
    for (var o = 0; o < L; o++) {
      i = order[o];
      var a = ea[i], b = eb[i];
      lflat[2 * o] = a; lflat[2 * o + 1] = b;
      lpos[6 * o] = pos[3 * a]; lpos[6 * o + 1] = pos[3 * a + 1]; lpos[6 * o + 2] = pos[3 * a + 2];
      lpos[6 * o + 3] = pos[3 * b]; lpos[6 * o + 4] = pos[3 * b + 1]; lpos[6 * o + 5] = pos[3 * b + 2];
      for (var m = 0; m < 2; m++) { lcol[6 * o + 3 * m] = col[3 * a]; lcol[6 * o + 3 * m + 1] = col[3 * a + 1]; lcol[6 * o + 3 * m + 2] = col[3 * a + 2]; }
      rankCum[er[i]] = o + 1;
    }
    for (r = 1; r < rankCum.length; r++) if (rankCum[r] == null) rankCum[r] = rankCum[r - 1] || 0;
    // the light: start, end, (phase, speed)
    var F = 0;
    for (i = 0; i < n; i++) if (flowTo[i] >= 0) F++;
    var fa = new Float32Array(F * 3), fb = new Float32Array(F * 3), fp = new Float32Array(F * 2), f = 0;
    for (i = 0; i < n; i++) {
      j = flowTo[i];
      if (j < 0) continue;
      fa.set(pos.subarray(3 * i, 3 * i + 3), 3 * f); fb.set(pos.subarray(3 * j, 3 * j + 3), 3 * f);
      fp[2 * f] = (i * 0.6180339) % 1; fp[2 * f + 1] = flowV[i];
      f++;
    }
    var adj = [];
    for (i = 0; i < n; i++) adj.push([]);
    for (i = 0; i < L; i++) { adj[ea[i]].push(eb[i]); adj[eb[i]].push(ea[i]); }
    var cent = groups.map(function () { return [0, 0, 0, 0]; });
    for (i = 0; i < n; i++) {
      var g = cent[nodes[i][NG]];
      g[0] += pos[3 * i]; g[1] += pos[3 * i + 1]; g[2] += pos[3 * i + 2]; g[3]++;
    }
    cent.forEach(function (q) { if (q[3]) { q[0] /= q[3]; q[1] /= q[3]; q[2] /= q[3]; } });
    var listed = 0;
    for (i = 0; i < n; i++) if (nodes[i][NT]) listed++;
    var counts = raw.counts || {};
    return {
      raw: raw, nodes: nodes, groups: groups, links: lflat, n: n, L: L, pos: pos, col: col, misc: misc,
      lpos: lpos, lcol: lcol, rankCum: rankCum, adj: adj, cent: cent, gcol: gcol, listed: listed,
      fa: fa, fb: fb, fp: fp, F: F,
      R90: R, dist: ORIG.dist / R,       // the original's camera, in units of R90
      counts: {
        items: counts.items || counts.papers || n,
        topics: counts.topicRegions || groups.filter(function (q) { return !q[3]; }).length
      }
    };
  }
  // How many links make up the web of each item's nearest `rank` + 1 neighbours (a prefix of data.links).
  function linksUpTo(data, rank) {
    var rc = data.rankCum;
    return rc.length ? rc[Math.min(rank, rc.length - 1)] : data.L;
  }

  // ------------------------------------------------------------------ WebGL
  // The dimming that keeps text readable: a ramp along a direction (fractions of the view), a soft box around a
  // centred text block, up to MAX_BOXES soft boxes under every other block of text laid over the galaxy (all in
  // device px), and a vignette at the edges so stars far out dissolve instead of being cut.
  var MAX_BOXES = 4;
  var FADE_FN = [
    "uniform vec4 uFade; uniform float uFadeMin; uniform vec4 uMask; uniform float uMaskSoft; uniform vec2 uEdge;",
    "uniform vec4 uBox[" + MAX_BOXES + "]; uniform float uBoxSoft; uniform float uBoxMin;",
    "float fadeAt(vec2 s, vec2 view){",
    "  vec2 q = s / view; float f = 1.0;",
    "  if (uFade.w > uFade.z) f = mix(uFadeMin, 1.0, smoothstep(uFade.z, uFade.w, dot(q, uFade.xy)));",
    "  if (uMaskSoft > 0.0) { vec2 d = max(max(uMask.xy - s, s - uMask.zw), vec2(0.0)); f = min(f, mix(uFadeMin, 1.0, smoothstep(0.0, uMaskSoft, length(d)))); }",
    "  for (int k = 0; k < " + MAX_BOXES + "; k++) {",
    "    vec4 b = uBox[k];",
    "    if (b.z > b.x) { vec2 d = max(max(b.xy - s, s - b.zw), vec2(0.0)); f = min(f, mix(uBoxMin, 1.0, smoothstep(0.0, uBoxSoft, length(d)))); }",
    "  }",
    "  if (uEdge.x > 0.0) { vec2 e = clamp(min(q, 1.0 - q) / uEdge, 0.0, 1.0); f *= smoothstep(0.0, 1.0, e.x) * smoothstep(0.0, 1.0, e.y); }",
    "  return f;",
    "}"
  ].join("\n");
  // All three passes add light, as the original does (additive blending, no depth test), blended ONE, ONE. The
  // canvas is composited over the page as premultiplied colour (out = rgb + (1 - a) x page), so each contribution o
  // is written as (o + a x page, a) with the smallest valid a: the page shows through unchanged and the light lands
  // on it exactly as the original's light lands on its own dark ground (uBg: the page colour under the galaxy).
  var ADD_LIGHT = [
    "uniform vec3 uBg; uniform vec3 uBgK;",       // uBgK = 1 / (1 - uBg)
    "vec4 addLight(vec3 o){",
    "  vec3 r = o * uBgK; float a = min(1.0, max(max(r.r, r.g), r.b));",
    "  return vec4(o + a * uBg, a);",
    "}"
  ].join("\n");
  var PROJECT = [
    "  vec3 p = uRot * q; float depth = max(0.05, uD - p.z); float k = uF / depth;",
    "  vec2 s = uCenter + vec2(p.x, -p.y) * k;",
    "  gl_Position = vec4(s.x / uView.x * 2.0 - 1.0, 1.0 - s.y / uView.y * 2.0, 0.0, 1.0);"
  ].join("\n");
  // Stars: the original's sprite and colour mix (30-render3d.js R3_VERTEX / R3_FRAGMENT): size 12 px at the
  // camera's distance (here in canvas px, never under 3 px), colour mix(colour * 1.3, white, t.r * 0.5) times the
  // sprite's alpha, at alpha min(1, 1.25 t.a), added.
  var VS_POINTS = [
    "attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aMisc;",
    "uniform mat3 uRot; uniform vec2 uCenter; uniform vec2 uView; uniform float uF; uniform float uD;",
    "uniform float uSize; uniform float uMin; uniform float uAlpha; uniform float uFocus; uniform float uFocusMix;",
    "varying vec3 vCol; varying float vA;",
    FADE_FN,
    "void main(){",
    "  vec3 q = aPos;",
    PROJECT,
    "  float focus = (uFocus < -0.5 || abs(aMisc.z - uFocus) < 0.5) ? 1.0 : 1.0 - 0.62 * uFocusMix;",
    "  gl_PointSize = clamp(uSize * aMisc.x * (uD / depth), uMin, 160.0);",
    "  vA = uAlpha * fadeAt(s, uView) * focus;",
    "  vCol = aCol;",
    "}"
  ].join("\n");
  var FS_POINTS = [
    "precision mediump float; uniform sampler2D uTex; varying vec3 vCol; varying float vA;",
    ADD_LIGHT,
    "void main(){",
    "  vec4 t = texture2D(uTex, gl_PointCoord);",
    "  vec3 c = clamp(mix(vCol * 1.3, vec3(1.0), t.r * 0.5) * t.a, 0.0, 1.0);",
    "  vec3 o = c * clamp(min(1.0, t.a * 1.25) * vA, 0.0, 1.0);",
    "  gl_FragColor = addLight(o);",
    "}"
  ].join("\n");
  // Links: one canvas pixel wide; colour = the item's colour x uMul (0.2), fogged with depth like the original's
  // FogExp2, at opacity uOpacity (0.5), added. The highlight uses the same pass in white.
  var VS_LINES = [
    "attribute vec3 aPos; attribute vec3 aCol;",
    "uniform mat3 uRot; uniform vec2 uCenter; uniform vec2 uView; uniform float uF; uniform float uD;",
    "uniform float uAlpha; uniform float uFogK;",
    "varying vec3 vCol; varying float vA; varying float vFog;",
    FADE_FN,
    "void main(){",
    "  vec3 q = aPos;",
    PROJECT,
    "  float fd = depth * uFogK;",
    "  vCol = aCol; vA = uAlpha * fadeAt(s, uView); vFog = 1.0 - exp(-fd * fd);",
    "}"
  ].join("\n");
  var FS_LINES = [
    "precision mediump float; uniform float uMul; uniform float uOpacity; uniform vec3 uFogCol;",
    "varying vec3 vCol; varying float vA; varying float vFog;",
    ADD_LIGHT,
    "void main(){",
    "  gl_FragColor = addLight(clamp(mix(vCol * uMul, uFogCol, vFog), 0.0, 1.0) * uOpacity * vA);",
    "}"
  ].join("\n");
  // The light flowing along the links (the original's flow points): a white sprite of 6.5 units with size
  // attenuation, fogged, added; its place along the link is worked out here from the clock.
  var VS_FLOW = [
    "attribute vec3 aA; attribute vec3 aB; attribute vec2 aPh;",
    "uniform mat3 uRot; uniform vec2 uCenter; uniform vec2 uView; uniform float uF; uniform float uD;",
    "uniform float uAlpha; uniform float uClock; uniform float uSpark; uniform float uFogK;",
    "varying float vA; varying float vFog;",
    FADE_FN,
    "void main(){",
    "  vec3 q = mix(aA, aB, fract(aPh.x + uClock * aPh.y));",
    PROJECT,
    "  float fd = depth * uFogK;",
    "  gl_PointSize = clamp(uSpark * k, 1.0, 64.0);",
    "  vA = uAlpha * fadeAt(s, uView); vFog = 1.0 - exp(-fd * fd);",
    "}"
  ].join("\n");
  var FS_FLOW = [
    "precision mediump float; uniform sampler2D uTex; uniform vec3 uFogCol;",
    "varying float vA; varying float vFog;",
    ADD_LIGHT,
    "void main(){",
    "  vec4 t = texture2D(uTex, gl_PointCoord);",
    "  gl_FragColor = addLight(clamp(mix(t.rgb, uFogCol, vFog), 0.0, 1.0) * t.a * vA);",
    "}"
  ].join("\n");

  // The original's star sprite (r3Init): a 64 px canvas with a white radial gradient, used as a mipmapped texture.
  var SPRITE = null;
  function spriteCanvas() {
    if (SPRITE) return SPRITE;
    var c = doc.createElement("canvas");
    c.width = c.height = 64;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.2, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.5, "rgba(255,255,255,0.22)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    SPRITE = c;
    return c;
  }
  // The sprite's alpha at a distance from its centre (fraction of its radius), for the 2D fallback.
  function spriteAlpha(u) {
    return u < 0.2 ? 1 - 0.75 * u : u < 0.5 ? 0.85 - 2.1 * (u - 0.2) : u < 1 ? 0.22 * (1 - u) / 0.5 : 0;
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { var log = gl.getShaderInfoLog(sh); gl.deleteShader(sh); throw new Error(log || "shader"); }
    return sh;
  }
  function program(gl, vs, fs, names) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    var u = {};
    names.forEach(function (nm) { u[nm] = gl.getUniformLocation(p, nm); });
    var at = {};
    ["aPos", "aCol", "aMisc", "aA", "aB", "aPh"].forEach(function (nm) { at[nm] = gl.getAttribLocation(p, nm); });
    return { p: p, u: u, aPos: at.aPos, aCol: at.aCol, aMisc: at.aMisc, aA: at.aA, aB: at.aB, aPh: at.aPh };
  }
  var COMMON_UNIFORMS = ["uRot", "uCenter", "uView", "uF", "uD", "uAlpha", "uFade", "uFadeMin", "uMask", "uMaskSoft", "uEdge", "uBox", "uBoxSoft", "uBoxMin"];
  var POINT_UNIFORMS = COMMON_UNIFORMS.concat(["uSize", "uMin", "uFocus", "uFocusMix", "uTex", "uBg", "uBgK"]);
  var LINE_UNIFORMS = COMMON_UNIFORMS.concat(["uMul", "uOpacity", "uFogK", "uFogCol", "uBg", "uBgK"]);
  var FLOW_UNIFORMS = COMMON_UNIFORMS.concat(["uClock", "uSpark", "uTex", "uFogK", "uFogCol", "uBg", "uBgK"]);

  function GLRenderer(canvas, data, antialias) {
    // Multisampled like the original (antialias: true), except on phones and small or slow devices, where
    // multisampling a full-screen canvas costs most; there the hairlines are drawn without it.
    var opts = { alpha: true, premultipliedAlpha: true, antialias: !!antialias, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "low-power" };
    var gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) throw new Error("no webgl");
    this.gl = gl;
    this.data = data;
    this.kind = "webgl";
    this.init();
  }
  GLRenderer.prototype.init = function () {
    var gl = this.gl, data = this.data;
    this.enabled = {};
    var info = gl.getExtension("WEBGL_debug_renderer_info");
    var name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || "");
    this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    var ca = gl.getContextAttributes && gl.getContextAttributes();
    this.msaa = !!(ca && ca.antialias);
    this.pp = program(gl, VS_POINTS, FS_POINTS, POINT_UNIFORMS);
    this.lp = program(gl, VS_LINES, FS_LINES, LINE_UNIFORMS);
    this.fp = program(gl, VS_FLOW, FS_FLOW, FLOW_UNIFORMS);
    function buf(arr) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW); return b; }
    this.bPos = buf(data.pos); this.bCol = buf(data.col); this.bMisc = buf(data.misc);
    this.bLPos = buf(data.lpos); this.bLCol = buf(data.lcol);
    this.bFA = buf(data.fa); this.bFB = buf(data.fb); this.bFP = buf(data.fp);
    // the sprite, as three.js uploads a CanvasTexture: not premultiplied, mipmapped, linear filtering, clamped
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, spriteCanvas());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    // Highlight of the paper under the pointer: its links (white), itself (larger), its neighbours, and light
    // running out along every one of its links, as the original shows a selected paper. Rewritten when it changes.
    this.bHLPos = gl.createBuffer(); this.bHLCol = gl.createBuffer(); this.hlCount = 0;
    this.bHPPos = gl.createBuffer(); this.bHPCol = gl.createBuffer(); this.bHPMisc = gl.createBuffer(); this.hpCount = 0;
    this.bHFA = gl.createBuffer(); this.bHFB = gl.createBuffer(); this.bHFP = gl.createBuffer(); this.hfCount = 0;
  };
  GLRenderer.prototype.setHighlight = function (idx) {
    var gl = this.gl, data = this.data;
    if (idx < 0) { this.hlCount = this.hpCount = this.hfCount = 0; return; }
    var nb = data.adj[idx], k, j, r, m = nb.length;
    var lp = new Float32Array(m * 6), lc = new Float32Array(m * 6).fill(1);
    var pp = new Float32Array((m + 1) * 3), pc = new Float32Array((m + 1) * 3), pm = new Float32Array((m + 1) * 3);
    var fa = new Float32Array(m * 9), fb = new Float32Array(m * 9), fq = new Float32Array(m * 6);
    var me = data.pos.subarray(3 * idx, 3 * idx + 3);
    for (k = 0; k < m; k++) {
      j = nb[k];
      var at = data.pos.subarray(3 * j, 3 * j + 3);
      lp.set(me, 6 * k); lp.set(at, 6 * k + 3);
      pp.set(at, 3 * k); pc.set(data.col.subarray(3 * j, 3 * j + 3), 3 * k);
      pm.set([1, 0, data.misc[3 * j + 2]], 3 * k);
      for (r = 0; r < 3; r++) {          // three points of light per link (the original's flowEdges for a node)
        fa.set(me, 9 * k + 3 * r); fb.set(at, 9 * k + 3 * r);
        fq[6 * k + 2 * r] = r / 3 + (j % 7) / 21; fq[6 * k + 2 * r + 1] = 1.6;
      }
    }
    pp.set(me, 3 * m);
    pc.set(data.col.subarray(3 * idx, 3 * idx + 3), 3 * m);
    pm.set([2.2, 0, data.misc[3 * idx + 2]], 3 * m);      // the original draws the picked paper 2.2 times larger
    function put(b, arr) { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW); }
    put(this.bHLPos, lp); put(this.bHLCol, lc); put(this.bHPPos, pp); put(this.bHPCol, pc); put(this.bHPMisc, pm);
    put(this.bHFA, fa); put(this.bHFB, fb); put(this.bHFP, fq);
    this.hlCount = m * 2; this.hpCount = m + 1; this.hfCount = m * 3;
  };
  // Enables exactly the attribute arrays one draw uses: an array left enabled from the other program would be
  // read past its end by a longer draw (and WebGL refuses the call).
  GLRenderer.prototype.attribs = function (specs) {
    var gl = this.gl, want = {}, k;
    this.enabled = this.enabled || {};
    for (k = 0; k < specs.length; k++) {
      var loc = specs[k][0];
      if (loc < 0) continue;
      want[loc] = true;
      gl.bindBuffer(gl.ARRAY_BUFFER, specs[k][1]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, specs[k][2], gl.FLOAT, false, 0, 0);
    }
    for (k in this.enabled) if (!want[k]) gl.disableVertexAttribArray(+k);
    this.enabled = want;
  };
  GLRenderer.prototype.render = function (f) {
    var gl = this.gl;
    if (gl.isContextLost()) return;
    gl.viewport(0, 0, f.vw, f.vh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    var m = f.mask || [0, 0, 0, 0], fog = ORIG.fogColour;
    var common = function (pr) {
      gl.uniformMatrix3fv(pr.u.uRot, false, f.rot);
      gl.uniform2f(pr.u.uCenter, f.cx, f.cy);
      gl.uniform2f(pr.u.uView, f.vw, f.vh);
      gl.uniform1f(pr.u.uF, f.focal);
      gl.uniform1f(pr.u.uD, f.dist);
      gl.uniform4f(pr.u.uFade, f.fade[0], f.fade[1], f.fade[2], f.fade[3]);
      gl.uniform1f(pr.u.uFadeMin, f.fadeMin);
      gl.uniform4f(pr.u.uMask, m[0], m[1], m[2], m[3]);
      gl.uniform1f(pr.u.uMaskSoft, f.mask ? f.maskSoft : 0);
      gl.uniform2f(pr.u.uEdge, f.edge[0], f.edge[1]);
      gl.uniform4fv(pr.u.uBox, f.boxes);
      gl.uniform1f(pr.u.uBoxSoft, f.boxSoft);
      gl.uniform1f(pr.u.uBoxMin, f.boxMin);
      if (pr.u.uFogK) { gl.uniform1f(pr.u.uFogK, f.fogK); gl.uniform3f(pr.u.uFogCol, fog[0], fog[1], fog[2]); }
      if (pr.u.uTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(pr.u.uTex, 0); }
      gl.uniform3f(pr.u.uBg, f.bg[0], f.bg[1], f.bg[2]);
      gl.uniform3f(pr.u.uBgK, 1 / (1 - f.bg[0]), 1 / (1 - f.bg[1]), 1 / (1 - f.bg[2]));
    }.bind(this);
    // links: the whole web, then the picked paper's links in white (the original draws those at opacity 0.9)
    var lp = this.lp;
    gl.useProgram(lp.p);
    common(lp);
    if (f.linkCount > 0 && f.linkAlpha > 0) {
      gl.uniform1f(lp.u.uAlpha, f.linkAlpha * (1 - 0.55 * f.focusMix));
      gl.uniform1f(lp.u.uMul, ORIG.link);
      gl.uniform1f(lp.u.uOpacity, ORIG.linkOpacity);
      this.attribs([[lp.aPos, this.bLPos, 3], [lp.aCol, this.bLCol, 3]]);
      gl.drawArrays(gl.LINES, 0, f.linkCount * 2);
    }
    if (this.hlCount && f.hlAlpha > 0) {
      gl.uniform1f(lp.u.uAlpha, f.hlAlpha * f.linkAlpha);
      gl.uniform1f(lp.u.uMul, 1);
      gl.uniform1f(lp.u.uOpacity, 0.9);
      this.attribs([[lp.aPos, this.bHLPos, 3], [lp.aCol, this.bHLCol, 3]]);
      gl.drawArrays(gl.LINES, 0, this.hlCount);
    }
    // stars
    var pp = this.pp;
    gl.useProgram(pp.p);
    common(pp);
    gl.uniform1f(pp.u.uSize, f.size);
    gl.uniform1f(pp.u.uMin, f.sizeMin);
    gl.uniform1f(pp.u.uAlpha, f.alpha);
    gl.uniform1f(pp.u.uFocus, f.focus);
    gl.uniform1f(pp.u.uFocusMix, f.focusMix);
    this.attribs([[pp.aPos, this.bPos, 3], [pp.aCol, this.bCol, 3], [pp.aMisc, this.bMisc, 3]]);
    gl.drawArrays(gl.POINTS, 0, this.data.n);
    if (this.hpCount && f.hlAlpha > 0) {
      gl.uniform1f(pp.u.uAlpha, f.hlAlpha);
      gl.uniform1f(pp.u.uFocus, -1);
      this.attribs([[pp.aPos, this.bHPPos, 3], [pp.aCol, this.bHPCol, 3], [pp.aMisc, this.bHPMisc, 3]]);
      gl.drawArrays(gl.POINTS, 0, this.hpCount);
    }
    // the light along the links
    var fp = this.fp, flowOn = f.flow && f.flowAlpha > 0 && this.data.F > 0, hfOn = f.flow && this.hfCount && f.hlAlpha > 0;
    if (flowOn || hfOn) {
      gl.useProgram(fp.p);
      common(fp);
      gl.uniform1f(fp.u.uSpark, f.spark);
      gl.uniform1f(fp.u.uClock, f.clock);
      if (flowOn) {
        gl.uniform1f(fp.u.uAlpha, f.flowAlpha * (1 - 0.55 * f.focusMix));
        this.attribs([[fp.aA, this.bFA, 3], [fp.aB, this.bFB, 3], [fp.aPh, this.bFP, 2]]);
        gl.drawArrays(gl.POINTS, 0, this.data.F);
      }
      if (hfOn) {
        gl.uniform1f(fp.u.uAlpha, f.hlAlpha);
        this.attribs([[fp.aA, this.bHFA, 3], [fp.aB, this.bHFB, 3], [fp.aPh, this.bHFP, 2]]);
        gl.drawArrays(gl.POINTS, 0, this.hfCount);
      }
    }
  };
  GLRenderer.prototype.release = function () {
    var ext = this.gl.getExtension("WEBGL_lose_context");
    if (ext) ext.loseContext();
  };

  // ------------------------------------------------------------------ Canvas 2D fallback
  // Used where WebGL is missing, which is mostly on weak devices: one pixel per CSS pixel, each item's two nearest
  // links stroked in one path per colour and strength step, the stars as the original's sprite (one per topic
  // colour), no flowing light, and (see Galaxy.check2d) a still picture if even that is too slow.
  function Canvas2DRenderer(canvas, data) {
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    this.ctx = ctx; this.data = data; this.kind = "2d"; this.hl = -1;
    // The original's star, pre-added: each pixel holds what the WebGL pass adds there (premultiplied), so drawing
    // it with "lighter" adds the same light.
    this.sprites = data.gcol.map(function (c) {
      var S = 32, s = doc.createElement("canvas"); s.width = s.height = S;
      var g = s.getContext("2d"), img = g.createImageData(S, S), px = img.data;
      var base = [Math.min(1, c[0] * 0.65 + 0.5), Math.min(1, c[1] * 0.65 + 0.5), Math.min(1, c[2] * 0.65 + 0.5)];
      for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
          var u = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2), ta = spriteAlpha(u), w = ta * Math.min(1, 1.25 * ta);
          var o = [base[0] * ta * w, base[1] * ta * w, base[2] * ta * w], a = Math.max(o[0], o[1], o[2]), q = 4 * (y * S + x);
          if (a <= 0) continue;
          px[q] = Math.round(o[0] / a * 255); px[q + 1] = Math.round(o[1] / a * 255); px[q + 2] = Math.round(o[2] / a * 255);
          px[q + 3] = Math.round(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
      return s;
    });
    this.strokes = data.gcol.map(function (c) { return "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")"; });
    // link indices grouped by the colour they are drawn in, in the data's order (so a prefix stays a prefix)
    var by = data.groups.map(function () { return []; });
    for (var i = 0; i < data.L; i++) by[data.nodes[data.links[2 * i]][NG]].push(i);
    this.byGroup = by;
    this.fd = new Float32Array(data.n);
  }
  Canvas2DRenderer.prototype.setHighlight = function (idx) { this.hl = idx; };
  Canvas2DRenderer.prototype.render = function (f, P, gx) {
    var ctx = this.ctx, data = this.data, links = data.links, nodes = data.nodes, fd = this.fd, i, k, a, b;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, f.vw, f.vh);
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);          // P is in CSS pixels
    ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < data.n; i++) fd[i] = gx.fadeAt(P.x[i], P.y[i]);
    // a link adds its item's colour x 0.2 x 0.5, one device pixel wide: at one pixel per CSS pixel, half as strong
    var LV = 4, top = ORIG.link * ORIG.linkOpacity * f.linkAlpha, count = f.linkCount;
    ctx.lineWidth = 1;
    for (var g = 0; g < this.byGroup.length; g++) {
      var list = this.byGroup[g], buckets = [];
      for (k = 0; k < list.length; k++) {
        i = list[k];
        if (i >= count) break;
        a = links[2 * i]; b = links[2 * i + 1];
        var al = Math.min(fd[a], fd[b]);
        if (al < 0.03) continue;
        var lv = Math.min(LV - 1, Math.floor(al * LV));
        (buckets[lv] || (buckets[lv] = [])).push(P.x[a], P.y[a], P.x[b], P.y[b]);
      }
      ctx.strokeStyle = this.strokes[g];
      for (var v = 0; v < LV; v++) {
        var q = buckets[v];
        if (!q) continue;
        ctx.globalAlpha = top * (v + 1) / LV;
        ctx.beginPath();
        for (k = 0; k < q.length; k += 4) { ctx.moveTo(q[k], q[k + 1]); ctx.lineTo(q[k + 2], q[k + 3]); }
        ctx.stroke();
      }
    }
    var dprInv = 1 / f.dpr;
    for (i = 0; i < data.n; i++) {
      var gr = nodes[i][NG];
      var focus = f.focus < 0 || gr === f.focus ? 1 : 1 - 0.62 * f.focusMix;
      var alpha = clamp(f.alpha * focus * fd[i], 0, 1);
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      var r = Math.max(f.sizeMin, f.size * data.misc[3 * i] * P.k[i]) * dprInv * 0.5;
      if (i === this.hl) r *= 2.2;
      ctx.drawImage(this.sprites[gr], P.x[i] - r, P.y[i] - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
  Canvas2DRenderer.prototype.release = function () {};

  // ------------------------------------------------------------------ one galaxy
  function Galaxy(el) {
    this.el = el;
    var ds = el.dataset;
    this.mode = ds.mode === "hero" ? "hero" : "panel";
    this.labelsOn = ds.labels === "regions";
    this.interactive = ds.interactive !== "false";
    this.align = ds.align === "right" ? "right" : "center";
    this.src = ds.src;
    this.poster = ds.poster || null;
    this.posterNarrow = ds.posterNarrow || null;
    this.avoidSel = ds.avoid || null;
    this.reduced = !!(reducedQuery && reducedQuery.matches);
    this.visible = false; this.near = false; this.pageVisible = !doc.hidden;
    this.raf = 0; this.lastRaf = 0; this.lastDraw = 0; this.t0 = now();
    // The original's opening view (camera straight on, at the height of the centre) and its turning speed, the same
    // in a hero and in a panel: the original's angle per frame at the frame rate of this screen (noteRefresh), as
    // at 60 Hz until that is known.
    this.yaw = 0; this.pitch0 = 0; this.pitch = this.pitch0;
    this.hz = ORIG.hzMin;
    this.base = ORIG.spinFrame * this.hz;
    this.omega = this.reduced ? 0 : this.base;
    this.par = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hold = 0; this.focusMix = 0;
    this.hover = -1; this.pinned = -1; this.pointer = null; this.drag = null; this.releasedAt = -1e9; this.multi = false;
    this.quality = 0; this.frames = 0; this.intervals = []; this.work = []; this.sinceCheck = 0;
    this.qSince = 0; this.lastUp = -1e9; this.noUp = false; this.still = false;
    this.avoid = []; this.avoidMain = null; this.keep = [];
    this.ready = false; this.failed = false; this.started = false; this.live = false; this.destroyed = false;
    this.mount();
  }
  var G = Galaxy.prototype;

  G.mount = function () {
    var el = this.el, self = this;
    injectStyle();
    el.classList.add("gx-host");
    if (global.getComputedStyle(el).position === "static") el.style.position = "relative";
    if (this.poster || this.posterNarrow) {
      this.posterEl = doc.createElement("div");
      this.posterEl.className = "gx-poster";
      el.appendChild(this.posterEl);
    }
    var cv = this.canvas = doc.createElement("canvas");
    cv.className = "gx-canvas" + (this.interactive ? " gx-int" : "");
    // What assistive technology hears. A host that is labelled itself (role="img" with an aria-label) and is a pure
    // background keeps that label, and its canvas is hidden; an interactive galaxy's canvas takes the focus, so it
    // carries the label (data-canvas-label, else the host's aria-label), with how to turn it added once it is drawn.
    var hostLabel = (el.getAttribute("data-canvas-label") || el.getAttribute("aria-label") || "").trim();
    this.canvasLabel = hostLabel || "A live 3D map of a research library: each point is a document, coloured by its topic group.";
    if (!this.interactive && el.getAttribute("role") === "img" && el.getAttribute("aria-label")) {
      cv.setAttribute("aria-hidden", "true");
    } else {
      cv.setAttribute("role", "img");
      cv.setAttribute("aria-label", this.canvasLabel);
      if (this.interactive && el.getAttribute("role") === "img") { el.removeAttribute("role"); el.removeAttribute("aria-label"); }
    }
    if (!this.interactive) cv.style.pointerEvents = "none";
    el.appendChild(cv);
    if (this.labelsOn) { this.labelsEl = doc.createElement("div"); this.labelsEl.className = "gx-labels"; this.labelsEl.setAttribute("aria-hidden", "true"); el.appendChild(this.labelsEl); }
    if (this.interactive) {
      this.ring = doc.createElement("div"); this.ring.className = "gx-ring"; el.appendChild(this.ring);
      this.tip = doc.createElement("div"); this.tip.className = "gx-tip"; this.tip.setAttribute("aria-hidden", "true"); el.appendChild(this.tip);
    }

    this.onVis = function () { self.pageVisible = !doc.hidden; self.schedule(); };
    doc.addEventListener("visibilitychange", this.onVis);
    if ("IntersectionObserver" in global) {
      // running: on screen (with a small margin); starting: within a quarter of a screen of it
      this.io = new IntersectionObserver(function (entries) {
        self.visible = entries[entries.length - 1].isIntersecting;
        if (self.visible) self.maybeStart();
        else if (self.mode === "hero" && self.pinned >= 0) self.pin(-1);   // a background never stays stopped
        self.schedule();
      }, { rootMargin: "80px 0px" });
      this.io.observe(el);
      this.ioNear = new IntersectionObserver(function (entries) {
        if (!entries[entries.length - 1].isIntersecting || self.near) return;
        self.near = true;
        if (self.failed) self.showPoster(true); else self.armPoster();
        self.maybeStart();
      }, { rootMargin: "25% 0px" });
      this.ioNear.observe(el);
    } else { this.visible = this.near = true; }
    this.onResize = function () { if (self.ready) self.resize(); else if (self.posterShown) self.showPoster(self.failed); };
    if ("ResizeObserver" in global) { this.ro = new ResizeObserver(this.onResize); this.ro.observe(el); }
    else global.addEventListener("resize", this.onResize);
    if (reducedQuery) {
      this.onReduced = function () { self.reduced = reducedQuery.matches; if (self.reduced) self.omega = 0; self.schedule(); self.requestStill(); };
      listen(reducedQuery, this.onReduced, true);
    }
    this.watchDpr();
    if (this.interactive) this.bindPointer();
    if (this.mode === "hero" && !this.reduced) {
      // A little depth parallax as the mouse moves over the hero; passive, so it never blocks scrolling.
      this.onWinMove = function (e) {
        if (e.pointerType && e.pointerType !== "mouse") return;
        if (!self.visible) return;
        var r = el.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom) { self.par.tx = self.par.ty = 0; return; }
        self.par.tx = clamp((e.clientX - r.left) / Math.max(1, r.width) - 0.5, -0.5, 0.5) * 0.16;
        self.par.ty = clamp((e.clientY - r.top) / Math.max(1, r.height) - 0.5, -0.5, 0.5) * 0.08;
      };
      global.addEventListener("pointermove", this.onWinMove, { passive: true });
    }
    if (this.near) this.armPoster();          // otherwise armed when the IntersectionObserver finds it near
    if (!this.src) { this.fail("no data-src"); return; }
    loadData(this.src).then(function (data) {
      if (self.destroyed) return;
      self.data = data;
      self.maybeStart();
    }, function (err) { if (!self.destroyed) self.fail(err); });
  };

  // The poster is a placeholder only when the galaxy is slow: it is requested if nothing has been drawn 300 ms
  // after the element comes near the viewport, so a fast connection never downloads it.
  G.armPoster = function () {
    var self = this;
    if (this.posterTimer || !this.posterEl) return;
    this.posterTimer = setTimeout(function () { if (!self.live && !self.failed && !self.destroyed) self.showPoster(false); }, 300);
  };
  G.showPoster = function (failure) {
    var pe = this.posterEl;
    if (!pe || this.destroyed) return;
    var W = this.el.clientWidth, H = this.el.clientHeight, fr = null;
    if (W && H) { this.W = W; this.H = H; this.measureAvoid(); fr = this.frameFor(W, H); }
    // Each poster is scaled and placed so that its galaxy lands where the live one will be drawn. The one rendered
    // at the nearest size is used, so its stars look about as large as the live ones. While loading, a poster far
    // off in size is not shown at all (it would look wrong and then jump); if the galaxy cannot draw, the nearest
    // one is used anyway.
    var best = null, bd = Infinity;
    [[this.poster, POSTER_FRAMES.wide], [this.posterNarrow, POSTER_FRAMES.narrow]].forEach(function (c) {
      if (!c[0]) return;
      var d = fr ? Math.abs(Math.log(fr.R / c[1].R)) : c[1] === POSTER_FRAMES.wide ? 0 : 1;
      if (d < bd) { bd = d; best = c; }
    });
    if (!best || (!failure && bd > Math.log(1.6))) return;
    var src = best[0], meta = best[1];
    pe.style.backgroundImage = "url(\"" + String(src).replace(/"/g, "%22") + "\")";
    var mk = "none";
    if (fr) {
      var s = fr.R / meta.R;
      pe.style.backgroundSize = (meta.w * s).toFixed(1) + "px " + (meta.h * s).toFixed(1) + "px";
      pe.style.backgroundPosition = (fr.cx - meta.cx * s).toFixed(1) + "px " + (fr.cy - meta.cy * s).toFixed(1) + "px";
      // The posters carry no dimming of their own: the live galaxy's ramp under the text is laid on as a mask,
      // so the text stays readable over the poster in any layout.
      if (fr.fade[3] > fr.fade[2]) {
        var span = fr.fade[0] ? W : H, a = fr.fade[2] * span, z = fr.fade[3] * span, stops = [];
        for (var k = 0; k <= 4; k++) {
          var u = k / 4, v = fr.fadeMin + (1 - fr.fadeMin) * u * u * (3 - 2 * u);
          stops.push("rgba(0,0,0," + v.toFixed(3) + ") " + (a + (z - a) * u).toFixed(1) + "px");
        }
        mk = "linear-gradient(" + (fr.fade[0] ? "to right" : "to bottom") + "," + stops.join(",") + ")";
      } else if (fr.mask) mk = "linear-gradient(rgba(0,0,0,.4),rgba(0,0,0,.4))";
    } else {
      pe.style.backgroundSize = "cover"; pe.style.backgroundPosition = "50% 50%";
    }
    pe.style.webkitMaskImage = mk; pe.style.maskImage = mk;
    pe.style.display = "";
    pe.classList.remove("gx-off");
    this.posterShown = true;
  };

  G.fail = function (err) {
    if (this.destroyed) return;
    this.failed = true;
    this.stop();
    if (this.canvas) this.canvas.style.display = "none";
    // the poster stands in for the galaxy: the host carries the label again (an interactive canvas had taken it)
    if (this.canvasLabel && !this.el.getAttribute("aria-label")) { this.el.setAttribute("role", "img"); this.el.setAttribute("aria-label", this.canvasLabel); }
    if (this.near) this.showPoster(true);       // a galaxy further down the page gets its poster when it comes near
    this.el.classList.add("gx-fallback");
    if (global.console && console.warn) console.warn("galaxy-hero: showing the poster instead (" + (err && err.message ? err.message : err) + ")");
  };

  // The renderer is created when the element first comes near the viewport (a galaxy further down the page costs
  // nothing at load), in a task of its own, so the data's preparation and each renderer's set-up never add up to
  // one long task.
  G.maybeStart = function () {
    if (this.started || this.destroyed || this.failed || !this.data || !this.near) return;
    this.started = true;
    var self = this;
    this.startTimer = setTimeout(function () { self.start(self.data); }, 0);
  };

  G.start = function (data) {
    var self = this;
    if (this.destroyed || this.ready || this.failed) return;
    this.data = data;
    var smallOrSlow = Math.min(global.innerWidth || 1e4, global.innerHeight || 1e4) < 560 ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 2);
    this.smallOrSlow = !!smallOrSlow;
    try {
      this.r = new GLRenderer(this.canvas, data, !smallOrSlow);
      if (this.r.software && this.r.msaa) {
        // Software GL (no usable GPU): multisampling costs far more than it shows. Start again without it, on a
        // fresh canvas (a context's antialias setting cannot be changed).
        this.r.release();
        var plain = this.canvas.cloneNode(false);
        this.el.replaceChild(plain, this.canvas);
        this.canvas = plain;
        if (this.interactive) this.bindPointer();
        this.r = new GLRenderer(this.canvas, data, false);
      }
    }
    catch (e) {
      try {
        // A canvas that has been asked for "webgl" cannot give a 2D context: start again with a fresh one.
        var fresh = this.canvas.cloneNode(false);
        this.el.replaceChild(fresh, this.canvas);
        this.canvas = fresh;
        if (this.interactive) this.bindPointer();
        this.r = new Canvas2DRenderer(this.canvas, data);
      } catch (e2) { this.fail(e2); return; }
    }
    if (this.r.kind === "webgl") {
      this.canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); self.stop(); }, false);
      this.canvas.addEventListener("webglcontextrestored", function () {
        if (self.destroyed) return;
        try { self.r.init(); self.r.setHighlight(self.pinned >= 0 ? self.pinned : self.hover); self.schedule(); self.requestStill(); } catch (e) { self.fail(e); }
      }, false);
    }
    // 0 every link, DPR <= 2, up to 60 fps at rest | 1 each item's 5 nearest links, DPR <= 1.5, ~30 fps at rest |
    // 2 its 2 nearest, DPR <= 1.25 | 3 same, 30 fps while dragged too
    // (the 2D fallback always draws the 2 nearest at one pixel per CSS pixel)
    this.quality = this.r.kind === "2d" ? 2 : this.r.software || smallOrSlow ? 1 : 0;
    this.qSince = now();
    if (this.canvas.getAttribute("aria-hidden") !== "true") {
      // no counts here (the page says how many papers it shows); a star names its paper only when the data has titles
      var titled = data.nodes.some(function (d) { return !!d[NT]; });
      this.canvas.setAttribute("aria-label", this.canvasLabel +
        (this.interactive ? " Drag to turn it" + (this.mode === "panel" ? " or use the arrow keys" : "") + "; hover or tap a star to see " +
          (titled ? "the paper." : "its topic.") : ""));
    }
    if (this.labelsOn) this.buildLabels();
    this.ready = true;
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { if (!self.destroyed) self.resize(); });
    this.resize();
    this.renderFrame(now());
    var cv = this.canvas;
    global.requestAnimationFrame(function () {
      if (self.destroyed || self.failed) return;
      cv.classList.add("gx-on");
      self.live = true;
      clearTimeout(self.posterTimer);
      if (self.posterEl) {
        if (self.posterShown) {
          self.posterEl.classList.add("gx-off");
          // Once the live galaxy has faded in, the poster leaves the layout (less to composite on a phone).
          setTimeout(function () { if (!self.failed && self.posterEl) self.posterEl.style.display = "none"; }, 1400);
        } else self.posterEl.style.display = "none";
      }
    });
    this.schedule();
  };

  // ------------------------------------------------------------------ framing
  // Text blocks laid over the galaxy, as boxes in the container's CSS pixels: from data-avoid, or in a hero the
  // block of text that holds the h1 (or h2) plus any other small blocks of text beside the galaxy (a nav, a
  // caption). The block with the heading drives the dimming ramp; stars under every block are dimmed and cannot
  // be picked, and the hover card keeps clear of them all.
  G.measureAvoid = function () {
    var self = this, W = this.W, H = this.H, boxes = [], main = null, els = [], el = this.el;
    this.avoid = boxes; this.avoidMain = null;
    if (this.avoidSel === "none" || !W || !H) return;
    var r0 = el.getBoundingClientRect();
    var rel = function (bx) { return bx && [bx[0] - r0.left, bx[1] - r0.top, bx[2] - r0.left, bx[3] - r0.top]; };
    if (this.avoidSel) {
      try { els = Array.prototype.slice.call(doc.querySelectorAll(this.avoidSel)); }
      catch (e) { if (!this.warnedAvoid && global.console) { console.warn("galaxy-hero: bad data-avoid selector", this.avoidSel); this.warnedAvoid = true; } }
    } else if (this.mode === "hero" && el.parentElement) {
      var p = el.parentElement, h = p.querySelector("h1") || p.querySelector("h2");
      if (h && !el.contains(h)) {
        // From the heading up to the block that holds it with its lede and buttons, but not to a wrapper that also
        // holds a full-width nav or footer.
        var b = h, bb = textBox(h);
        while (bb && b.parentElement && !b.parentElement.contains(el)) {
          var nb = textBox(b.parentElement);
          if (!nb || nb[2] - nb[0] > Math.max(1.5 * (bb[2] - bb[0]), 0.7 * W) || (nb[2] - nb[0]) * (nb[3] - nb[1]) > 0.5 * W * H) break;
          b = b.parentElement; bb = nb;
        }
        els = [b];
        Array.prototype.forEach.call(p.children, function (c) {
          if (c === el || c.contains(b) || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(c.tagName)) return;
          var cb = textBox(c);
          if (cb && (cb[2] - cb[0]) * (cb[3] - cb[1]) < 0.3 * W * H) els.push(c);
        });
      }
    }
    if (!els.length) return;
    els.forEach(function (e) {
      if (el.contains(e) || e.contains(el)) return;
      var bx = rel(textBox(e));
      if (!bx) return;
      if (bx[2] <= 0 || bx[3] <= 0 || bx[0] >= W || bx[1] >= H) return;
      if ((bx[2] - bx[0]) * (bx[3] - bx[1]) > 0.9 * W * H) return;          // a wrapper, not a block of text
      if (!main && ((e.matches && e.matches("h1,h2")) || e.querySelector("h1,h2"))) main = bx;
      boxes.push(bx);
    });
    if (boxes.length > MAX_BOXES) {
      // the heading's block and the largest of the others
      boxes.sort(function (a, b) { return (b === main) - (a === main) || (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]); });
      boxes.length = MAX_BOXES;
    }
    if (this.mode === "hero") this.avoidMain = main || boxes[0] || null;
    // a reflow of the text (fonts arriving, a new wrap) re-frames the galaxy
    if (this.ro && !this.avoidObserved) { els.forEach(function (e) { self.ro.observe(e); }); this.avoidObserved = true; }
  };
  function inBoxes(boxes, x, y, pad) {
    for (var k = 0; k < boxes.length; k++) {
      var b = boxes[k];
      if (x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad) return true;
    }
    return false;
  }

  G.frameFor = function (W, H) {
    var st = global.getComputedStyle(this.el);
    var ox = cssNum(st, "--galaxy-x"), oy = cssNum(st, "--galaxy-y"), os = cssNum(st, "--galaxy-size");
    var wide = isWide(W, H), main = this.avoidMain, right = this.align === "right";
    var cx, cy, R, fade = [0, 0, 0, 0], fadeMin = 1, mask = null, maskSoft = 0, edge;
    if (this.mode === "hero") {
      if (wide) {
        // On narrower wide screens the text column takes more of the width: the galaxy moves right and the
        // dimmed zone under the text reaches further (unchanged from 1280 px up).
        var t = clamp((W - 720) / 560, 0, 1);
        cx = (right ? 0.74 - 0.06 * t : 0.5) * W; cy = 0.52 * H;
        R = Math.min(H * 0.36, W * 0.27);
        fadeMin = 0.14;
        if (right) {
          var s0 = (0.3 - 0.04 * t) * W, e0 = (0.68 - 0.08 * t) * W, s = s0, e = e0;
          if (main) {
            // Full brightness only from 96 px past the text's right edge, dim all across the text; if the text
            // reaches into the bright zone, the galaxy moves right (and shrinks a little) to make room.
            e = Math.max(e0, main[2] + 96);
            s = Math.min(Math.max(s0, main[2] - 64), e - 120);
            var shift = e - e0;
            if (shift > 0) { cx += 0.6 * shift; R *= clamp(1 - shift / W, 0.8, 1); }
          }
          fade = [1, 0, s / W, e / W];
        } else if (main) { mask = [main[0] - 16, main[1] - 16, main[2] + 16, main[3] + 16]; maskSoft = 90; }
      } else {
        // Phone or portrait: the galaxy sits low and centred, under the stacked text, and fades out towards the top.
        cx = 0.5 * W; cy = 0.7 * H;
        R = Math.min(W * 0.38, H * 0.28);
        fadeMin = 0.22;
        var s1 = 0.22 * H, e1 = 0.62 * H;
        if (main) {
          e1 = Math.max(e1, main[3] + 40);
          s1 = Math.min(Math.max(s1, main[3] - 120), e1 - 120);
          var down = e1 - 0.62 * H;
          if (down > 0) { cy = Math.min(cy + 0.6 * down, 0.8 * H); R *= clamp(1 - down / H, 0.8, 1); }
        }
        fade = [0, 1, s1 / H, e1 / H];
      }
      edge = [0.06, 0.05];
    } else {
      cx = (right ? 0.58 : 0.5) * W; cy = 0.5 * H;
      R = Math.min(W * (W < H * 1.1 ? 0.42 : 0.36), H * 0.45);
      edge = [0.035, 0.04];
    }
    if (ox != null) cx = ox * W;
    if (oy != null) cy = oy * H;
    if (os != null) R = Math.min(W, H) * os;
    // Stars under any block of text are dimmed as far as under the text column (a little less in a panel, where
    // the blocks are small tags), with a soft edge, so a caption or a nav link never sits on a bright star.
    var boxes = this.avoid.map(function (b) { return [b[0] - 6, b[1] - 4, b[2] + 6, b[3] + 4]; });
    return { cx: cx, cy: cy, R: R, fade: fade, fadeMin: fadeMin, mask: mask, maskSoft: maskSoft, edge: edge, wide: wide,
      boxes: boxes, boxMin: this.mode === "hero" ? fadeMin : 0.3, boxSoft: 28 };
  };

  // The colour of the page behind the galaxy (the backgrounds of its ancestors, laid over each other), which the
  // light is added onto. A light page (or none found) counts as black: the light is then simply drawn.
  G.pageBg = function () {
    var stack = [], n = this.el, c, k;
    while (n && n.nodeType === 1) {
      c = cssRgba(global.getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
      n = n.parentElement;
    }
    var bg = [0, 0, 0];
    for (k = stack.length - 1; k >= 0; k--) { c = stack[k]; bg = [bg[0] + (c[0] - bg[0]) * c[3], bg[1] + (c[1] - bg[1]) * c[3], bg[2] + (c[2] - bg[2]) * c[3]]; }
    return Math.max(bg[0], bg[1], bg[2]) > 0.35 ? [0, 0, 0] : bg;
  };

  G.resize = function () {
    if (!this.ready || this.destroyed) return;
    var el = this.el, W = el.clientWidth, H = el.clientHeight;
    this.W = W; this.H = H;
    if (!W || !H) { this.stop(); return; }
    this.bg = this.pageBg();
    this.lastDpr = global.devicePixelRatio || 1;
    var dpr = Math.min(DPR_CAP, this.lastDpr);
    if (this.quality >= 1) dpr = Math.min(dpr, 1.5);
    if (this.quality >= 2) dpr = Math.min(dpr, 1.25);
    if (this.quality >= 3 || this.r.kind === "2d") dpr = 1;
    this.dpr = dpr;
    var vw = Math.max(1, Math.round(W * dpr)), vh = Math.max(1, Math.round(H * dpr));
    if (this.canvas.width !== vw || this.canvas.height !== vh) { this.canvas.width = vw; this.canvas.height = vh; }
    el.classList.toggle("gx-narrow", W < 520);
    this.measureAvoid();
    this.frame = this.frameFor(W, H);
    this.keepOut();
    this.measureLabels();
    if (this.posterShown && !this.live) this.showPoster(this.failed);
    if (!this.raf) this.renderFrame(now());
    this.schedule();
  };

  // Where the hover card may not go (CSS px): the text blocks, or, with none found, the dimmed zone.
  G.keepOut = function () {
    var fr = this.frame, W = this.W, H = this.H, keep = [];
    this.avoid.forEach(function (b) { keep.push([b[0] - 10, b[1] - 10, b[2] + 10, b[3] + 10]); });
    if (!keep.length && this.mode === "hero" && fr.fade[3] > fr.fade[2]) {
      var at = fr.fade[2] + 0.75 * (fr.fade[3] - fr.fade[2]);            // ~90% brightness
      keep.push(fr.fade[0] ? [-1e4, -1e4, at * W, 1e4] : [-1e4, -1e4, 1e4, at * H]);
    }
    this.keep = keep;
    if (this.tip) {
      var max = Math.min(W < 520 ? 250 : 300, W - 16), m = this.avoidMain;
      if (this.mode === "hero" && fr.wide && this.align === "right" && m) max = Math.min(max, Math.max(200, W - (m[2] + 12) - 8));
      this.tip.style.maxWidth = max + "px";
      this.tipSize = null;
    }
  };

  // The same dimming as the shaders, for picking, the hover card and the 2D fallback (CSS px).
  G.fadeAt = function (x, y) {
    var fr = this.frame, W = this.W, H = this.H, f = 1, qx = x / W, qy = y / H;
    if (fr.fade[3] > fr.fade[2]) f = fr.fadeMin + (1 - fr.fadeMin) * smooth(fr.fade[2], fr.fade[3], qx * fr.fade[0] + qy * fr.fade[1]);
    if (fr.mask) {
      var dx = Math.max(fr.mask[0] - x, x - fr.mask[2], 0), dy = Math.max(fr.mask[1] - y, y - fr.mask[3], 0);
      f = Math.min(f, fr.fadeMin + (1 - fr.fadeMin) * smooth(0, fr.maskSoft, Math.sqrt(dx * dx + dy * dy)));
    }
    for (var k = 0; k < fr.boxes.length && k < MAX_BOXES; k++) {
      var b = fr.boxes[k], bx = Math.max(b[0] - x, x - b[2], 0), by = Math.max(b[1] - y, y - b[3], 0);
      f = Math.min(f, fr.boxMin + (1 - fr.boxMin) * smooth(0, fr.boxSoft, Math.sqrt(bx * bx + by * by)));
    }
    if (fr.edge) {
      var ex = clamp(Math.min(qx, 1 - qx) / fr.edge[0], 0, 1), ey = clamp(Math.min(qy, 1 - qy) / fr.edge[1], 0, 1);
      f *= smooth(0, 1, ex) * smooth(0, 1, ey);
    }
    return f;
  };

  G.watchDpr = function () {
    if (!global.matchMedia || this.destroyed) return;
    var self = this, mq = global.matchMedia("(resolution: " + (global.devicePixelRatio || 1) + "dppx)");
    var on = function () { self.unwatchDpr(); self.watchDpr(); self.resize(); };   // e.g. moved to a retina screen
    listen(mq, on, true);
    this.dprWatch = [mq, on];
  };
  G.unwatchDpr = function () { if (this.dprWatch) { listen(this.dprWatch[0], this.dprWatch[1], false); this.dprWatch = null; } };

  // ------------------------------------------------------------------ motion and the loop
  G.running = function () { return this.ready && !this.failed && !this.destroyed && !this.frozen && this.visible && this.pageVisible && this.W > 0 && this.H > 0; };
  G.isStill = function () { return this.reduced || this.still; };
  G.schedule = function () {
    var self = this;
    if (this.running() && !this.isStill()) {
      // One loop only: a resize inside a frame (a change of quality tier, say) must not start a second one.
      if (!this.raf && !this.inLoop) {
        this.lastRaf = this.lastDraw = 0;
        this.raf = global.requestAnimationFrame(function loop(ts) {
          self.raf = 0;
          self.inLoop = true;
          try {
            if (self.lastRaf) self.noteInterval(ts - self.lastRaf);
            self.lastRaf = ts;
            var gap = self.minGap();
            if (!gap || !self.lastDraw || ts - self.lastDraw >= gap - 2) self.tick(ts);
          } finally { self.inLoop = false; }
          if (self.running() && !self.isStill() && !self.raf) self.raf = global.requestAnimationFrame(loop);
        });
      }
    } else this.stop();
  };
  // At rest the spin moves a star by a pixel or two per drawn frame (it turns twice as fast on a 120 Hz screen, as
  // the original does). On a desktop at full quality it is drawn at up to 60 fps (every other frame at 120 Hz); on
  // phones and lower tiers at ~30 fps (20 fps in 2D): the same picture for half the GPU work. The turn itself goes by
  // the clock, so its speed does not depend on how often it is drawn. Drags, hovers and their easing run at the
  // full rate.
  G.minGap = function () {
    // a mouse resting over the galaxy (not on a star) counts as idle too
    var idle = !this.drag && (!this.pointer || now() - this.pointer.t > 500) && this.hover < 0 && this.pinned < 0 && this.hold < 0.003 && this.focusMix < 0.003 &&
      Math.abs(this.omega - (this.isStill() ? 0 : this.base)) < 0.002 && Math.abs(this.pitch - this.pitch0) < 0.003 &&
      Math.abs(this.par.x - this.par.tx) < 0.002 && Math.abs(this.par.y - this.par.ty) < 0.002;
    if (this.r.kind === "2d") return idle ? 50 : 0;
    if (this.quality >= 3 && !this.drag) return 33;
    return idle ? (this.quality === 0 && !this.smallOrSlow ? 15 : 33) : 0;
  };
  G.stop = function () { if (this.raf) { global.cancelAnimationFrame(this.raf); this.raf = 0; } };
  G.requestStill = function () {
    var self = this;
    if (this.raf || this.inLoop || !this.ready || this.stillPending || this.destroyed) return;
    this.stillPending = true;
    global.requestAnimationFrame(function (ts) { self.stillPending = false; if (!self.raf) self.renderFrame(ts || now()); });
  };

  G.tick = function (ts) {
    var t0 = now();
    var dt = this.lastDraw ? Math.min(0.1, (ts - this.lastDraw) / 1000) : 1 / 60;
    this.lastDraw = ts;
    this.step(dt, ts);
    this.renderFrame(ts);
    this.work.push(now() - t0);
    if (this.work.length > 240) this.work.shift();
  };

  G.step = function (dt, ts) {
    var holding = this.pinned >= 0 || this.hover >= 0, hero = this.mode === "hero";
    this.hold = ease(this.hold, holding ? 1 : 0, dt, 0.12);
    this.focusMix = ease(this.focusMix, holding && !hero ? 1 : 0, dt, 0.25);
    if (!this.drag) {
      var target = this.isStill() ? 0 : this.base * (1 - this.hold);
      // A star under the pointer brakes the turn quickly so it stays put to be read; otherwise the turn
      // eases back to the slow spin (sooner in a hero, which should stay calm behind the text).
      this.omega = ease(this.omega, target, dt, holding ? 0.22 : hero ? 0.8 : 1.4);
      this.yaw += this.omega * dt;
      if (ts - this.releasedAt > 700) this.pitch = ease(this.pitch, this.pitch0, dt, 2.2);
    }
    this.par.x = ease(this.par.x, this.par.tx, dt, 0.8);
    this.par.y = ease(this.par.y, this.par.ty, dt, 0.8);
  };

  // Rolling rAF intervals. A device that cannot keep up gets fewer links, less glow and fewer pixels; one that
  // has kept up for a while gets a tier back (once it fails to hold a tier it was given back, it stays down).
  G.noteInterval = function (ms) {
    // A gap of over a second is a stall (or the tab coming back), not the device's pace; anything shorter counts,
    // so a device drawing only a few frames a second is still seen as slow.
    if (ms > 1000) return;
    this.intervals.push(ms);
    if (this.intervals.length > 240) this.intervals.shift();
    this.frames++;
    this.sinceCheck += ms;
    if (this.frames >= 20 && this.frames % 30 === 0) this.noteRefresh();
    if (this.r.kind === "2d") { this.check2d(); return; }
    if (this.frames < 20 || this.sinceCheck < 1500) return;
    this.sinceCheck = 0;
    var recent = this.intervals.slice(-Math.min(this.intervals.length, 60)).sort(function (a, b) { return a - b; });
    var med = recent[recent.length >> 1], fast = recent[Math.floor(recent.length * 0.1)], t = now();
    if (med > (this.quality >= 2 ? 30 : 24)) {
      if (this.quality >= 3) return;
      // Frame skipping only when the browser does offer ~60 Hz and we miss it; a browser that paces at 30 Hz
      // (battery saver, low-power mode) just gets the lighter tiers.
      if (this.quality >= 2 && fast > 20) return;
      if (t - this.lastUp < 15000) this.noUp = true;
      this.quality++; this.qSince = t; this.intervals.length = 0; this.resize();
    } else if (this.quality > (this.r.software ? 1 : 0) && !this.noUp && med <= 17.5 && t - this.qSince > 10000 && t - this.lastUp > 20000) {
      // (software GL never climbs back to the full web: its frames are cheap on average but stall now and then)
      this.quality--; this.qSince = this.lastUp = t; this.intervals.length = 0; this.resize();
    }
  };
  // The screen's frame rate, from the shortest tenth of the recent frame intervals (a busy frame only ever comes late,
  // never early), kept between 60 and 120 Hz. The original turns by a fixed angle each frame it draws, so on the same
  // screen this galaxy turns by that angle per frame too: once every ~86 s at 60 Hz, every ~43 s at 120 Hz. A change
  // eases in through omega (see step); small wobbles of the estimate are ignored.
  G.noteRefresh = function () {
    var recent = this.intervals.slice(-60).sort(function (a, b) { return a - b; });
    if (recent.length < 20) return;
    var hz = clamp(1000 / Math.max(1, recent[Math.floor(recent.length * 0.1)]), ORIG.hzMin, ORIG.hzMax);
    // the usual screen rates exactly, so timing jitter does not make it a few per cent fast
    [60, 75, 90, 100, 120].forEach(function (r) { if (Math.abs(hz - r) < 0.06 * r) hz = r; });
    if (Math.abs(hz - this.hz) > 0.04 * this.hz) { this.hz = hz; this.base = ORIG.spinFrame * hz; }
  };
  // The 2D fallback: if it costs more than ~8 ms a frame, or the page drops to under ~25 fps, it stops
  // animating and redraws only when someone drags or hovers.
  G.check2d = function () {
    if (this.still || this.frames < 12 || this.sinceCheck < 1500) return;   // ~1.5 s of frames, however slow
    this.sinceCheck = 0;
    var wk = median(this.work.slice(-40)), iv = median(this.intervals.slice(-40));
    if ((wk != null && wk > 8) || iv > 40) { this.still = true; this.omega = 0; this.stop(); this.requestStill(); }
  };

  G.view = function () {
    var yaw = this.yaw + this.par.x, pitch = this.pitch + this.par.y;
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // column-major mat3 for p' = Rx(pitch) * Ry(yaw) * p
    return [cy, sy * sp, -sy * cp, 0, cp, sp, sy, -cy * sp, cy * cp];
  };

  // Everything the renderers need for one frame. The look is the original's, one to one at R_REF: its camera
  // (distance 820 units, so the perspective is the same), star sprites of 12 px of the original's own pixel ratio
  // (min(2, devicePixelRatio)) at that distance, links one pixel wide, the light 6.5 units across. Away from R_REF
  // the stars change size gently (square root) and a smaller galaxy draws proportionally fewer links, so a phone's
  // galaxy has the same density of light as the original on a laptop. In a hero nothing is dimmed except under the
  // text: the dimming (fadeAt) is a brightness ramp, the same as laying the page colour over the galaxy as a
  // gradient, so no star or link changes its hue.
  G.frameParams = function (ts) {
    var fr = this.frame, dpr = this.dpr, hero = this.mode === "hero", q = this.quality, data = this.data;
    var dist = data.dist;
    var prO = Math.min(ORIG.prCap, global.devicePixelRatio || 1), px = dpr / prO, rel = fr.R / R_REF;
    var linkCount = this.r.kind === "2d" || q >= 2 ? linksUpTo(data, 1) : q === 1 ? linksUpTo(data, 4) : data.L;
    linkCount = Math.min(linkCount, Math.round(data.L * clamp(rel / 0.95, 0.2, 1)));
    var sizeK = clamp(Math.sqrt(rel), 0.6, 1.5);
    var boxes = this.boxBuf || (this.boxBuf = new Float32Array(4 * MAX_BOXES));
    boxes.fill(0);
    for (var k = 0; k < fr.boxes.length && k < MAX_BOXES; k++) for (var c = 0; c < 4; c++) boxes[4 * k + c] = fr.boxes[k][c] * dpr;
    // the light's clock, in trips at speed 1; every speed is a whole number of tenths, so wrapping it every 10
    // trips moves no point of light
    var clock = ((ts - this.t0) / ORIG.flowTrip) % 10;
    return {
      rot: this.view(), cx: fr.cx * dpr, cy: fr.cy * dpr, vw: this.canvas.width, vh: this.canvas.height, dpr: dpr,
      dist: dist, focal: fr.R * dpr * dist,
      size: ORIG.star * px * sizeK, sizeMin: ORIG.starMin * px,
      alpha: 1,
      linkAlpha: px,                      // one canvas pixel wide: as strong per CSS pixel as the original's
      linkCount: linkCount,
      flow: !this.isStill(), flowAlpha: 1, clock: clock < 0 ? clock + 10 : clock,
      spark: ORIG.flowSize * Math.tan(ORIG.fov / 2 * Math.PI / 180) / data.R90,
      fogK: ORIG.fog * data.R90, bg: this.bg || [0, 0, 0],
      fade: fr.fade, fadeMin: fr.fadeMin, edge: fr.edge,
      mask: fr.mask ? [fr.mask[0] * dpr, fr.mask[1] * dpr, fr.mask[2] * dpr, fr.mask[3] * dpr] : null, maskSoft: fr.maskSoft * dpr,
      boxes: boxes, boxSoft: fr.boxSoft * dpr, boxMin: fr.boxMin,
      focus: this.focusGroup(), focusMix: this.focusMix,
      hlAlpha: this.hover >= 0 || this.pinned >= 0 ? (hero ? 0.75 : 1) : 0
    };
  };
  G.focusGroup = function () {
    var i = this.pinned >= 0 ? this.pinned : this.hover;
    return i >= 0 ? this.data.nodes[i][NG] : -1;
  };

  // The same projection as the shaders, for picking, labels, the ring and the 2D fallback (CSS px).
  G.project = function (f) {
    var data = this.data, n = data.n, pos = data.pos, m = f.rot, P = this.P;
    if (!P || P.x.length !== n) P = this.P = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), k: new Float32Array(n), near: new Float32Array(n) };
    var ox = f.cx / f.dpr, oy = f.cy / f.dpr, F = f.focal / f.dpr, D = f.dist;
    for (var i = 0; i < n; i++) {
      var x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      var px = m[0] * x + m[3] * y + m[6] * z, py = m[1] * x + m[4] * y + m[7] * z, pz = m[2] * x + m[5] * y + m[8] * z;
      var depth = Math.max(0.05, D - pz), k = F / depth;
      P.x[i] = ox + px * k; P.y[i] = oy - py * k; P.z[i] = depth; P.k[i] = D / depth;
      P.near[i] = 0.3 + 0.7 * clamp((D + 1 - depth) * 0.5, 0, 1);
    }
    return P;
  };
  G.projectPoint = function (f, x, y, z) {
    var m = f.rot, D = f.dist;
    var px = m[0] * x + m[3] * y + m[6] * z, py = m[1] * x + m[4] * y + m[7] * z, pz = m[2] * x + m[5] * y + m[8] * z;
    var depth = Math.max(0.05, D - pz), k = f.focal / f.dpr / depth;
    return { x: f.cx / f.dpr + px * k, y: f.cy / f.dpr - py * k, depth: depth, near: clamp((D + 1 - depth) * 0.5, 0, 1) };
  };

  G.renderFrame = function (ts) {
    if (!this.ready || !this.W || !this.H || this.destroyed) return;
    // The screen's pixel density changed (a window moved to another screen) without a resize: re-fit the canvas.
    // The media-query listener catches this too, but not in every browser; this check costs one read a frame.
    if ((global.devicePixelRatio || 1) !== this.lastDpr) this.resize();
    var f = this.lastF = this.frameParams(ts);
    var needP = this.r.kind === "2d" || this.pointer || this.pinned >= 0 || this.hover >= 0;
    var P = needP ? this.project(f) : null;
    if (this.pointer && !this.drag && P) this.updateHover(P);
    this.r.render(f, P, this);
    this.updateOverlays(f, P);
  };

  // ------------------------------------------------------------------ hover, tap, drag
  G.bindPointer = function () {
    var self = this, cv = this.canvas, down = {};
    var count = function () { var k = 0; for (var id in down) k++; return k; };
    cv.addEventListener("pointerdown", function (e) {
      if (!self.ready || (e.button != null && e.button > 0)) return;
      down[e.pointerId] = true;
      if (count() > 1) {
        // A second finger: a pinch, which the browser turns into a page zoom. It never turns the galaxy.
        if (self.drag) { self.drag = null; cv.classList.remove("gx-drag"); }
        self.multi = true;
        return;
      }
      if (e.pointerType === "mouse") {
        e.preventDefault();
        if (self.mode === "panel" && cv.focus) { try { cv.focus({ preventScroll: true }); } catch (err) { /* old browsers */ } }
      }
      self.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now(), moved: false, vx: 0, lt: now() };
      if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ } }
      self.setPointer(e);
    });
    cv.addEventListener("pointermove", function (e) {
      if (!self.ready) return;
      var d = self.drag;
      if (self.multi) return;
      self.setPointer(e);
      if (!d || d.id !== e.pointerId) { if (self.isStill() || !self.raf) self.requestStill(); return; }
      var dx = e.clientX - d.x, dy = e.clientY - d.y, t = now(), dtm = Math.max(1, t - d.lt);
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5) { d.moved = true; cv.classList.add("gx-drag"); self.setHover(-1); }
      if (d.moved) {
        self.yaw += dx * 0.0062;
        self.pitch = clamp(self.pitch + dy * 0.0045, -1.05, 1.05);
        d.vx = 0.75 * (dx * 0.0062 / (dtm / 1000)) + 0.25 * d.vx;
        if (self.isStill() || !self.raf) self.requestStill();
      }
      d.x = e.clientX; d.y = e.clientY; d.lt = t;
    });
    var end = function (e) {
      delete down[e.pointerId];
      if (!count()) self.multi = false;
      var d = self.drag;
      if (!d || d.id !== e.pointerId) return;
      self.drag = null;
      cv.classList.remove("gx-drag");
      if (d.moved && e.type === "pointerup") {
        // Let go: it keeps the turn it was given, then eases back to the slow spin. A hero stays calm: a flick
        // gives it at most about a sixth of a turn per second.
        var vmax = self.mode === "hero" ? 1.0 : 2.6;
        self.omega = self.isStill() ? 0 : clamp(now() - d.lt > 80 ? 0 : d.vx, -vmax, vmax);
        self.releasedAt = now();
      } else if (!d.moved && e.type === "pointerup") {
        self.tap(e);
      }
      if (e.pointerType !== "mouse") self.pointer = null;
      self.requestStill();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);           // e.g. the browser took the gesture for a scroll or a zoom
    cv.addEventListener("pointerleave", function (e) {
      if (self.drag && e.pointerType === "mouse") return;
      if (e.pointerType === "mouse") {
        self.pointer = null; self.setHover(-1);
        if (self.mode === "hero" && self.pinned >= 0) self.pin(-1);   // a background never stays stopped
        self.requestStill();
      }
    });
    cv.addEventListener("lostpointercapture", function () { if (self.drag) { self.drag = null; cv.classList.remove("gx-drag"); } });
    if (this.mode === "panel") {
      cv.tabIndex = 0;
      cv.addEventListener("keydown", function (e) {
        if (!self.ready) return;
        var k = e.key;
        if (k === "ArrowLeft" || k === "ArrowRight") { self.yaw += (k === "ArrowLeft" ? -1 : 1) * 0.12; self.releasedAt = now(); }
        else if (k === "ArrowUp" || k === "ArrowDown") { self.pitch = clamp(self.pitch + (k === "ArrowUp" ? -1 : 1) * 0.1, -1.05, 1.05); self.releasedAt = now(); }
        else if (k === "Escape") { self.pin(-1); }
        else return;
        e.preventDefault();
        self.requestStill();
      });
    }
  };
  G.setPointer = function (e) {
    var r = this.el.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, touch: e.pointerType !== "mouse", t: now() };
  };
  G.pick = function (P, x, y, touch) {
    var nodes = this.data.nodes, best = -1, bd = touch ? 26 * 26 : 15 * 15, bz = 1e9, av = this.avoid;
    for (var i = 0; i < this.data.n; i++) {
      if (!nodes[i][NT]) continue;                         // drawn, but not listed publicly
      var dx = P.x[i] - x, dy = P.y[i] - y, d2 = dx * dx + dy * dy;
      if (d2 > bd) continue;
      if (this.fadeAt(P.x[i], P.y[i]) < 0.5) continue;     // dimmed under the text or at an edge: not offered
      if (inBoxes(av, P.x[i], P.y[i], 4)) continue;         // under a block of text, which is what is read there
      // nearest to the pointer, and in a tie the one in front
      var score = d2 + P.z[i] * 12;
      if (best < 0 || score < bz) { best = i; bz = score; }
    }
    return best;
  };
  G.updateHover = function (P) {
    if (this.pointer.touch) return;                         // touch names a star on tap only
    var x = this.pointer.x, y = this.pointer.y, i = this.pick(P, x, y, false), h = this.hover;
    // a little hysteresis: the star being read stays named while the pointer is still close to it
    if (i < 0 && h >= 0 && (P.x[h] - x) * (P.x[h] - x) + (P.y[h] - y) * (P.y[h] - y) < 26 * 26) i = h;
    this.setHover(i);
  };
  G.tap = function (e) {
    var r = this.el.getBoundingClientRect(), f = this.lastF || this.frameParams(now());
    var P = this.project(f), touch = e.pointerType !== "mouse", i = this.pick(P, e.clientX - r.left, e.clientY - r.top, touch);
    this.pin(i === this.pinned ? -1 : i, touch);
  };
  G.pin = function (i, touch) {
    var self = this;
    this.pinned = i;
    clearTimeout(this.pinTimer);
    // In a hero a tapped paper is let go after a while: the background never stays stopped.
    if (i >= 0 && touch && this.mode === "hero") this.pinTimer = setTimeout(function () { if (self.pinned === i) self.pin(-1); }, 6000);
    this.r.setHighlight(i >= 0 ? i : this.hover);
    this.showTip(i >= 0 ? i : this.hover);
    this.requestStill();
  };
  G.setHover = function (i) {
    if (i === this.hover) return;
    this.hover = i;
    if (this.pinned >= 0) return;
    this.r.setHighlight(i);
    this.showTip(i);
    this.canvas.classList.toggle("gx-point", i >= 0);
  };
  G.showTip = function (i) {
    if (!this.tip) return;
    if (i < 0) { this.tip.classList.remove("gx-show"); this.ring.style.opacity = "0"; this.tipFor = -1; this.tipBox = this.tipStar = null; return; }
    var d = this.data.nodes[i], g = this.data.groups[d[NG]];
    var meta = [d[NA], d[NY] || ""].filter(Boolean).join(" · ");
    // a group that is not a topic (kind 1: the file's text could not be read) is named as such
    var region = g[3] ? "topic unknown: " + g[0] : g[0];
    this.tip.innerHTML = (d[NT] ? '<div class="gx-tip-t">' + esc(d[NT]) + "</div>" : "") +
      (meta ? '<div class="gx-tip-m">' + esc(meta) + "</div>" : "") +
      '<div class="gx-tip-r"><i style="background:' + esc(g[1]) + '"></i>' + esc(region) + "</div>";
    this.tip.classList.add("gx-show");
    this.tipFor = i;
    this.tipSize = null;
  };

  // The card goes beside the star, never over it, inside the frame, and clear of the text blocks (which sit
  // above the galaxy, so a card under them would be overprinted).
  G.placeTip = function (x, y) {
    if (!this.tipSize) this.tipSize = [this.tip.offsetWidth, this.tip.offsetHeight];
    var w = this.tipSize[0], h = this.tipSize[1], W = this.W, H = this.H, m = 8, keep = this.keep;
    var safeX = m;
    if (this.avoidMain && this.mode === "hero" && this.frame.wide && this.align === "right") safeX = Math.max(m, this.avoidMain[2] + 12);
    var hiX = Math.max(m, W - w - m), hiY = Math.max(m, H - h - m);
    var cands = [
      [x + 16, y + 14], [x + 16, y - 14 - h], [x - 16 - w, y + 14], [x - 16 - w, y - 14 - h],
      [clamp(x - w / 2, Math.min(safeX, hiX), hiX), y + 20], [clamp(x - w / 2, Math.min(safeX, hiX), hiX), y - 20 - h]
    ];
    var best = null, bs = Infinity;
    for (var k = 0; k < cands.length; k++) {
      var tx = clamp(cands[k][0], m, hiX), ty = clamp(cands[k][1], m, hiY);
      var box = [tx, ty, tx + w, ty + h];
      var covers = x > tx - 8 && x < tx + w + 8 && y > ty - 8 && y < ty + h + 8;
      var ov = 0;
      for (var j = 0; j < keep.length; j++) ov += overlap(box, keep[j]);
      var score = (covers ? 1e7 : 0) + ov * 20 + Math.abs(tx - cands[k][0]) + Math.abs(ty - cands[k][1]) + k * 4;
      if (score < bs) { bs = score; best = [tx, ty]; }
    }
    this.tip.style.transform = "translate3d(" + Math.round(best[0]) + "px," + Math.round(best[1]) + "px,0)";
    this.tipBox = [best[0] - 4, best[1] - 4, best[0] + w + 4, best[1] + h + 4];
    this.tipStar = [x, y];
  };

  G.updateOverlays = function (f, P) {
    var i = this.pinned >= 0 ? this.pinned : this.hover;
    if (this.tip && i >= 0 && P) {
      var x = P.x[i], y = P.y[i];
      this.ring.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0)";
      this.ring.style.opacity = "1";
      this.placeTip(x, y);
    }
    if (this.labelsOn && this.labels) this.placeLabels(f);
  };

  // ------------------------------------------------------------------ region labels
  G.buildLabels = function () {
    var self = this, groups = this.data.groups;
    this.labels = [];
    groups.forEach(function (g, r) {
      if (g[3]) return;                                   // not a topic (text not readable): no name on the map
      var s = doc.createElement("span");
      s.className = "gx-label";
      s.innerHTML = '<i style="background:' + esc(g[1]) + ";color:" + esc(g[1]) + '"></i>' + esc(clipWords(g[0], 44));
      self.labelsEl.appendChild(s);
      self.labels.push({ el: s, r: r, n: g[2], w: 0, h: 0 });
    });
  };
  G.measureLabels = function () {
    if (!this.labels) return;
    this.labels.forEach(function (l) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; });
  };
  G.placeLabels = function (f) {
    var self = this, data = this.data, placed = [], W = this.W, H = this.H;
    var fi = this.focusGroup();
    var order = this.labels.slice().sort(function (a, b) { return (b.r === fi) - (a.r === fi) || b.n - a.n; });
    var budget = W < 520 ? 8 : W < 900 ? 14 : order.length;   // fewer names in a small galaxy
    order.forEach(function (l, rank) {
      var c = data.cent[l.r], p = self.projectPoint(f, c[0], c[1], c[2]);
      var w = l.w || 120, h = l.h || 18;
      var x = clamp(p.x - w / 2, 6, W - w - 6), y = p.y - h / 2;
      var box = [x - 4, y - 3, x + w + 4, y + h + 3];
      var clash = placed.some(function (b) { return box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]; });
      var inside = y > 4 && y + h < H - 4;
      var op = 0;
      // a name the card would half cover, or one on top of the star being read, is hidden (the card names the region)
      var underTip = self.tipBox && (overlap(box, self.tipBox) > 0 || inBoxes([box], self.tipStar[0], self.tipStar[1], 10));
      if (inside && !clash && !underTip && (rank < budget || l.r === fi)) {
        placed.push(box);
        op = 0.5 + 0.5 * smooth(0.05, 0.75, p.near);
        if (fi >= 0) op = l.r === fi ? 1 : op * 0.6;
      }
      l.el.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
      var o = op.toFixed(2);
      if (l.el.style.opacity !== o) l.el.style.opacity = o;
    });
  };

  // ------------------------------------------------------------------ for tests, the perf readout and the poster
  G.perf = function () {
    var iv = this.intervals.slice().sort(function (a, b) { return a - b; }), wk = this.work.slice().sort(function (a, b) { return a - b; });
    var q = function (arr, p) { return arr.length ? +arr[Math.min(arr.length - 1, Math.floor(arr.length * p))].toFixed(2) : null; };
    var mean = iv.length ? iv.reduce(function (a, b) { return a + b; }, 0) / iv.length : 0;
    return { renderer: this.r ? this.r.kind : null, quality: this.quality, dpr: this.dpr, frames: this.frames, still: this.still,
      links: this.lastF ? this.lastF.linkCount : null, fps: mean ? +(1000 / mean).toFixed(1) : null,
      hz: this.hz, turn: this.base ? +(2 * Math.PI / this.base).toFixed(1) : null,
      interval: { p50: q(iv, 0.5), p95: q(iv, 0.95) }, work: { p50: q(wk, 0.5), p95: q(wk, 0.95) } };
  };
  G.framing = function () { var f = this.frame; return f ? { W: this.W, H: this.H, cx: f.cx, cy: f.cy, R: f.R, fade: f.fade, mask: f.mask, wide: f.wide } : null; };
  G.setView = function (o) {
    if (o.yaw != null) this.yaw = o.yaw;
    if (o.pitch != null) this.pitch = this.pitch0 = o.pitch;
    if (o.time != null) this.t0 = now() - o.time * 1000;
    if (o.freeze != null) { this.frozen = !!o.freeze; if (this.frozen) { this.stop(); this.omega = 0; } else this.schedule(); }
    this.par.x = this.par.y = this.par.tx = this.par.ty = 0;
    this.renderFrame(now());
  };
  G.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    clearTimeout(this.posterTimer); clearTimeout(this.startTimer); clearTimeout(this.pinTimer);
    if (this.io) this.io.disconnect();
    if (this.ioNear) this.ioNear.disconnect();
    if (this.ro) this.ro.disconnect(); else global.removeEventListener("resize", this.onResize);
    doc.removeEventListener("visibilitychange", this.onVis);
    if (this.onWinMove) global.removeEventListener("pointermove", this.onWinMove);
    if (this.onReduced) listen(reducedQuery, this.onReduced, false);
    this.unwatchDpr();
    if (this.r && this.r.release) { try { this.r.release(); } catch (e) { /* already gone */ } }
    [this.canvas, this.posterEl, this.labelsEl, this.tip, this.ring].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    this.el.classList.remove("gx-host", "gx-narrow", "gx-fallback");
    this.el.__galaxy = null;
    var k = INSTANCES.indexOf(this);
    if (k >= 0) INSTANCES.splice(k, 1);
  };

  // ------------------------------------------------------------------ mounting
  function mount(el) {
    if (!el || el.__galaxy) return el && el.__galaxy;
    var g = new Galaxy(el);
    el.__galaxy = g;
    INSTANCES.push(g);
    return g;
  }
  function mountAll() {
    Array.prototype.forEach.call(doc.querySelectorAll("[data-galaxy]"), mount);
    perfReadout();
  }
  // ?gxperf in the page URL: a small readout of each galaxy's renderer, tier and frame times (for checking a
  // real phone or laptop; nothing is sent anywhere).
  function perfReadout() {
    if (!/[?&]gxperf\b/.test((global.location && global.location.search) || "") || doc.querySelector(".gx-perf")) return;
    injectStyle();
    var box = doc.createElement("div");
    box.className = "gx-perf";
    doc.body.appendChild(box);
    setInterval(function () {
      box.textContent = INSTANCES.map(function (g, k) {
        var p = g.perf();
        return "galaxy " + k + " (" + g.mode + "): " + (p.renderer || "loading") + ", tier " + p.quality + ", dpr " + p.dpr + ", " + p.links + " links" +
          (p.still ? ", still" : "") + "\n  frame p50 " + p.interval.p50 + " ms, p95 " + p.interval.p95 + " ms (" + p.fps + " fps); work p50 " + p.work.p50 + " ms" +
          "\n  screen " + p.hz + " Hz: a turn every " + p.turn + " s";
      }).join("\n") || "no galaxy";
    }, 1000);
  }

  global.GalaxyHero = { version: VERSION, mount: mount, mountAll: mountAll, instances: INSTANCES };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})(window);
