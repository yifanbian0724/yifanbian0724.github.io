/* The feelings flower, ported from Self-Discovery.
 *
 * Every family of feelings is a petal with room of its own, pointing the way its words lie on
 * average (pleasant to the right, more energy towards the top). Milder feelings sit near the
 * middle and stronger ones towards the tip, where the colour deepens; across a petal, passing
 * feelings sit on one side and lasting ones on the other. A plain clay face on each petal says
 * which family it is. Like the app's, the flower holds still; pointing at a petal lifts it, and a
 * tap opens its family.
 *
 * Flower.create(container, data, { onFamily, faceLook }) -> { select(id), mark(wordId), resize() }
 */
(function () {
  "use strict";

  var CORE = 0.16;            // the middle's share of the radius
  var WAIST = 0.56;           // where a petal is widest, along it
  var DURATIONS = ["moments", "minutes", "hours", "days"];
  var DEG = Math.PI / 180;

  function norm(a) { var r = a % 360; return r < 0 ? r + 360 : r; }

  /** Petal geometry: direction, share of the circle, length and where each word sits. */
  function layout(data, statesIn) {
    var fams = data.families.map(function (f) {
      var words = statesIn(f.id);
      var v = 0, a = 0;
      words.forEach(function (w) { v += w.valence; a += w.arousal; });
      v /= words.length; a /= words.length;
      return { family: f, words: words, compass: norm(Math.atan2(v, a) / DEG) };
    }).filter(function (f) { return f.words.length; })
      .sort(function (x, y) { return x.compass - y.compass; });
    // Every family gets room of its own, a little more when it has more words...
    var raw = fams.map(function (f) { return 18 + 1.875 * f.words.length; });
    var total = raw.reduce(function (s, x) { return s + x; }, 0);
    var spans = raw.map(function (x) { return x * 360 / total; });
    var middles = [], at = 0;
    spans.forEach(function (s) { middles.push(at + s / 2); at += s; });
    // ...and the whole flower turns so that families sit as near their own directions as they can.
    var sx = 0, cx = 0;
    fams.forEach(function (f, i) { var d = (f.compass - middles[i]) * DEG; sx += Math.sin(d); cx += Math.cos(d); });
    var turn = Math.atan2(sx, cx) / DEG;
    return fams.map(function (f, i) {
      var top = Math.max.apply(null, f.words.map(function (w) { return w.intensity; }));
      var length = 0.64 + 0.36 * top;
      return { id: f.family.id, family: f.family, angle: norm(middles[i] + turn), span: spans[i], length: length,
               seeds: seeds(f.words, length) };
    });
  }

  /** Stronger words further out; across the petal, from passing feelings to lasting ones. */
  function seeds(words, length) {
    var out = [];
    DURATIONS.forEach(function (d, di) {
      var group = words.filter(function (w) { return w.duration === d; })
        .sort(function (x, y) { return x.intensity - y.intensity; });
      var side = [-0.72, -0.24, 0.24, 0.72][di];
      group.forEach(function (w, k) {
        var r = CORE + w.intensity * (1 - CORE) * 0.97;
        out.push({ id: w.id, along: Math.min(0.95, (r - CORE) / (length - CORE)), across: side + (k % 2 === 0 ? -0.12 : 0.12) });
      });
    });
    return out;
  }

  function halfWidth(p) {
    var r = CORE + WAIST * (p.length - CORE);
    return Math.min(Math.tan(p.span / 2 * DEG), 0.5) * r * 1.12;
  }

  /** Where a petal starts and which way it points: (x, y, angle in radians). */
  function placement(p, c, R) {
    var a = p.angle * DEG, base = CORE * R;
    return { x: c.x + Math.sin(a) * base, y: c.y - Math.cos(a) * base, a: a };
  }

  function apply(t, x, y) {
    var cos = Math.cos(t.a), sin = Math.sin(t.a);
    return { x: t.x + x * cos - y * sin, y: t.y + x * sin + y * cos };
  }

  /** A petal's outline, drawn pointing up from its base and turned into place. */
  function petalPath(p, c, R, grow) {
    var L = (p.length - CORE) * R * grow, W = halfWidth(p) * R * grow;
    var t = placement(p, c, R);
    var pts = [
      [0, 0],
      [W * 0.5, -L * 0.04], [W, -L * 0.28], [W, -L * WAIST],
      [W, -L * 0.84], [W * 0.46, -L], [0, -L],
      [-W * 0.46, -L], [-W, -L * 0.84], [-W, -L * WAIST],
      [-W, -L * 0.28], [-W * 0.5, -L * 0.04], [0, 0]
    ].map(function (q) { return apply(t, q[0], q[1]); });
    var path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i += 3) {
      path.bezierCurveTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, pts[i + 2].x, pts[i + 2].y);
    }
    path.closePath();
    var xs = pts.map(function (q) { return q.x; }), ys = pts.map(function (q) { return q.y; });
    return { path: path, box: { minX: Math.min.apply(null, xs), minY: Math.min.apply(null, ys), maxX: Math.max.apply(null, xs), maxY: Math.max.apply(null, ys) } };
  }

  /** A spot on a petal: `along` from base to tip, `across` from one edge to the other. */
  function point(p, along, across, c, R, grow) {
    var L = (p.length - CORE) * R * grow, W = halfWidth(p) * R * grow, t = along;
    var profile = t < WAIST ? Math.sin(t / WAIST * Math.PI / 2)
      : Math.pow(Math.max(0, Math.cos((t - WAIST) / (1 - WAIST) * Math.PI / 2)), 0.8);
    return apply(placement(p, c, R), across * profile * W * 0.62, -t * L);
  }

  function create(container, data, opts) {
    var canvas = container.querySelector("canvas");
    var tag = container.querySelector(".flower__tag");
    var ctx = canvas.getContext("2d");
    var petals = layout(data, opts.statesIn);
    var looks = {};
    petals.forEach(function (p) { looks[p.id] = opts.faceLook(p.family); });
    var colors = {};
    petals.forEach(function (p) { colors[p.id] = Clay.hex(p.family.color); });
    var W = 0, H = 0, dpr = 1, R = 0, c = { x: 0, y: 0 };
    var hover = null, selected = null, marked = null;
    var grows = {};
    petals.forEach(function (p) { grows[p.id] = 1; });
    var WHITE = [1, 1, 1], SHADE = Clay.hex("#4A3A8A");

    function size() {
      var w = container.clientWidth;
      if (!w) return;
      W = w; H = w;
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      R = Math.max(40, Math.min(W, H) / 2 - (W < 420 ? 22 : 30));
      c = { x: W / 2, y: H / 2 };
    }

    function lit() { return hover || selected; }

    function targetGrow(p, i, t) {
      return (p.id === lit() ? 1.07 : 1) * (1 + 0.012 * Math.sin(t * 1.1 + i * 0.9));
    }

    /** One frame. Returns true while a petal is still lifting or settling. */
    function draw() {
      if (!W) return false;
      var t = Clay.clock.still, snap = Clay.clock.reduced, settling = false;
      petals.forEach(function (p, i) {
        var want = targetGrow(p, i, t);
        grows[p.id] = snap ? want : grows[p.id] + (want - grows[p.id]) * 0.35;
        if (Math.abs(want - grows[p.id]) > 0.0008) settling = true;
        else grows[p.id] = want;
      });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var L = lit();
      // A soft glow behind, lavender to peach.
      var glow = ctx.createRadialGradient(c.x, c.y, R * 0.2, c.x, c.y, R * 1.25);
      glow.addColorStop(0, "rgba(183,166,255,0.20)");
      glow.addColorStop(0.55, "rgba(255,181,154,0.06)");
      glow.addColorStop(1, "rgba(183,166,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      var shapes = petals.map(function (p) { return petalPath(p, c, R, grows[p.id]); });
      // One shadow for the whole flower.
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 24 * dpr;
      ctx.shadowOffsetY = 8 * dpr;
      ctx.fillStyle = "#151a2a";
      shapes.forEach(function (s) { ctx.fill(s.path); });
      ctx.restore();
      var order = petals.map(function (_, i) { return i; })
        .sort(function (a, b) { return (petals[a].id === L ? 1 : 0) - (petals[b].id === L ? 1 : 0); });
      order.forEach(function (i) {
        var p = petals[i], g = grows[p.id], s = shapes[i], col = colors[p.id];
        var tip = CORE * R + (p.length - CORE) * R * g;
        ctx.save();
        ctx.globalAlpha = L && L !== p.id ? 0.55 : 1;
        // Paler at the middle, deeper towards the tip: stronger feelings further out.
        var rad = ctx.createRadialGradient(c.x, c.y, CORE * R, c.x, c.y, tip);
        rad.addColorStop(0, Clay.rgba(Clay.mix(col, WHITE, 0.78)));
        rad.addColorStop(0.5, Clay.rgba(Clay.mix(col, WHITE, 0.3)));
        rad.addColorStop(1, Clay.rgba(Clay.mix(col, SHADE, 0.14)));
        ctx.fillStyle = rad;
        ctx.fill(s.path);
        // Clay light from the top left.
        var lin = ctx.createLinearGradient(s.box.minX, s.box.minY, s.box.maxX, s.box.maxY);
        lin.addColorStop(0, "rgba(255,255,255,0.42)");
        lin.addColorStop(0.45, "rgba(255,255,255,0)");
        lin.addColorStop(1, "rgba(90,79,176,0.12)");
        ctx.fillStyle = lin;
        ctx.fill(s.path);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.2;
        ctx.stroke(s.path);
        // A vein, and the words as seeds.
        var v0 = point(p, 0.06, 0, c, R, g), v1 = point(p, 0.86, 0, c, R, g);
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1.3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y); ctx.stroke();
        p.seeds.forEach(function (sd) {
          var q = point(p, sd.along, sd.across, c, R, g);
          ctx.beginPath();
          if (sd.id === marked) {
            ctx.arc(q.x, q.y, 5.5, 0, Math.PI * 2);
            ctx.fillStyle = "#6ea8ff"; ctx.fill();
            ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
          } else {
            ctx.arc(q.x, q.y, 2.3, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.fill();
          }
        });
        ctx.restore();
      });
      // The middle: a small cushion ringed with every family's colour.
      var m = CORE * R * 1.12;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 10 * dpr; ctx.shadowOffsetY = 3 * dpr;
      var cushion = ctx.createRadialGradient(c.x - m * 0.3, c.y - m * 0.3, 0, c.x - m * 0.3, c.y - m * 0.3, m * 1.5);
      cushion.addColorStop(0, "#ffffff"); cushion.addColorStop(0.5, "#FFF3E2"); cushion.addColorStop(1, "#FBE4C4");
      ctx.fillStyle = cushion;
      ctx.beginPath(); ctx.arc(c.x, c.y, m, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      petals.forEach(function (p) {
        var a = p.angle * DEG;
        ctx.fillStyle = p.family.color;
        ctx.beginPath(); ctx.arc(c.x + Math.sin(a) * m * 0.62, c.y - Math.cos(a) * m * 0.62, 2.5, 0, Math.PI * 2); ctx.fill();
      });
      // A face on each petal says which family it is.
      var face = Math.max(22, Math.min(38, R * 0.18));
      petals.forEach(function (p, i) {
        var q = point(p, 0.66, 0, c, R, grows[p.id]);
        Clay.draw(ctx, looks[p.id], { x: q.x, y: q.y, size: face, t: t, intensity: 0.3, seed: i * 0.7, dpr: dpr, plain: true,
                                      alpha: L && L !== p.id ? 0.75 : 1 });
      });
      placeTag();
      return settling;
    }

    // Frames only while a petal is lifting or settling.
    var raf = 0;
    function kick() {
      if (!raf) raf = requestAnimationFrame(function step() { raf = draw() ? requestAnimationFrame(step) : 0; });
    }

    /** The lifted petal's name, just beyond its tip. */
    function placeTag() {
      var id = lit();
      if (!id) { tag.hidden = true; return; }
      var p = petals.find(function (x) { return x.id === id; });
      tag.hidden = false;
      if (tag.dataset.id !== id) {
        tag.dataset.id = id;
        tag.innerHTML = "";
        var dot = document.createElement("span");
        dot.className = "dot"; dot.style.background = p.family.color;
        tag.appendChild(dot);
        tag.appendChild(document.createTextNode(p.family.label));
        tag.style.borderColor = p.family.color;
      }
      var tw = tag.offsetWidth, th = tag.offsetHeight;
      var tip = point(p, 1, 0, c, R, grows[p.id]);
      var a = p.angle * DEG;
      var reach = Math.abs(Math.sin(a)) * tw / 2 + Math.abs(Math.cos(a)) * th / 2 + 6;
      var x = Math.min(Math.max(tip.x + Math.sin(a) * reach, tw / 2 + 2), W - tw / 2 - 2);
      var y = Math.min(Math.max(tip.y - Math.cos(a) * reach, th / 2 + 2), H - th / 2 - 2);
      tag.style.transform = "translate(" + (x - tw / 2) + "px," + (y - th / 2) + "px)";
    }

    /** The petal whose slice holds a point (none in the middle or beyond the tips). */
    function petalAt(x, y) {
      var dx = x - c.x, dy = y - c.y;
      var r = Math.hypot(dx, dy) / R;
      if (r <= CORE * 0.9) return null;
      var angle = norm(Math.atan2(dx, -dy) / DEG);
      return petals.find(function (p) {
        return Math.abs(norm(angle - p.angle + 180) - 180) <= p.span / 2 && r <= p.length + 0.06;
      }) || null;
    }

    function local(e) {
      var b = canvas.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    }
    canvas.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      var q = local(e), p = petalAt(q.x, q.y);
      var id = p ? p.id : null;
      if (id !== hover) { hover = id; canvas.style.cursor = id ? "pointer" : "default"; kick(); }
    });
    canvas.addEventListener("pointerleave", function () { hover = null; kick(); });
    canvas.addEventListener("click", function (e) {
      var q = local(e), p = petalAt(q.x, q.y);
      if (p) opts.onFamily(p.id, "flower");
    });

    size();
    draw();
    if ("ResizeObserver" in window) new ResizeObserver(function () { size(); draw(); }).observe(container);

    return {
      petals: petals,
      select: function (id) { selected = id; kick(); },
      mark: function (wordId) { marked = wordId; kick(); },
      /** Where a petal's face is on screen (client coordinates). */
      where: function (id) {
        var p = petals.find(function (x) { return x.id === id; });
        if (!p) return null;
        var q = point(p, 0.66, 0, c, R, grows[id]), b = canvas.getBoundingClientRect();
        return [b.left + q.x, b.top + q.y];
      },
      redraw: function () { draw(); }
    };
  }

  window.Flower = { create: create, layout: layout };
})();
