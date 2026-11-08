/* Feelings as little clay characters, drawn on a 2D canvas.
 *
 * A port of Self-Discovery's own character code: the same wobbly clay blob, the same faces
 * (where the eyes look, brows, mouths that laugh, grit their teeth or smirk, blush, sweat and
 * tears), the same colours (a family's colour, paler when a word is usually mild, deeper when it
 * is usually strong), the same 22 ways of moving (anxious jitters, afraid trembles, dread sinks;
 * stronger feelings move more) and, once a character is 24 px or more, the same picture round
 * it: who is with it (two faces for connected), what its hands do (afraid holds its cheeks) and
 * what is round it (a rain cloud for sad, a lightbulb for inspired).
 *
 * The app draws a few of those things with Apple's SF Symbols, which may not be used on a
 * website; GLYPHS below draws each of them in its own simple way, at the same place, size and
 * colour.
 *
 * Clay.look(word, family)            -> what a word looks like
 * Clay.draw(ctx, look, options)      -> draw one character into any canvas
 * Clay.mount(box, look, options)     -> a canvas character inside an element, animated or still
 * Clay.clock                         -> the shared animation clock (still when motion is reduced)
 */
(function () {
  "use strict";

  var INK = "#2E2A4A";
  var STILL_T = 0.6;                 // the app's still frame, used when motion is reduced
  // In the app's own renders (checked pixel by pixel against its face sheet, 6 Nov 2026) six small
  // shapes are never filled: each is a path of just two segments, one of them a curve. Narrow eyes
  // (contempt, resentful, jealous...), the laughing mouth (amused, amazed) and sweat drops (anxious,
  // stressed...) do not show at all; leaves, the banana peel and the lotus show only their outline.
  // The web shows what the app shows. Set this to true once the app fills them.
  var APP_DRAWS_ALL = false;
  var DEG = Math.PI / 180;

  function hex(h) {
    var n = parseInt(String(h).replace("#", ""), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function mix(a, b, f) {
    var g = 1 - f;
    return [a[0] * g + b[0] * f, a[1] * g + b[1] * f, a[2] * g + b[2] * f];
  }
  function rgba(c, alpha) {
    return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + (alpha == null ? 1 : alpha) + ")";
  }
  function css(h, alpha) { return rgba(hex(h), alpha); }

  var WHITE = [1, 1, 1];
  var SHADE = hex("#4A3A8A");        // clay shading and shadow tint
  var DEEPEN = hex("#3A2A6A");       // stronger words deepen towards this
  var MUTED = hex("#C9C7D9");        // washed-out words (numb, empty, unseen)
  var EDGE = hex("#2A1E5C");         // outlines of hands and arms
  var INK_RGB = hex(INK);
  var MARK = "#9C8FE8";              // lines that show movement or breath
  var WATER = "#7FD3FF";
  var PINK = "#FF7B9C";

  var FACE = { mouth: 0.3, eyes: "open", brows: 0, lift: false, wobble: false, oMouth: false, sweat: false, tear: false,
               blush: false, lookX: 0, lookY: 0, split: false, iris: null, shape: "curve", streams: false, joyTears: false };
  function face(f) {
    var out = {}, k;
    for (k in FACE) out[k] = FACE[k];
    for (k in f) out[k] = f[k];
    return out;
  }

  /** A word's look: its family's colour (paler when mild, deeper when strong), face, motion and picture. */
  function look(word, family) {
    var base = hex(family.color), k = word.intensity;
    var color = k < 0.45 ? mix(base, WHITE, (0.45 - k) * 0.8) : mix(base, DEEPEN, (k - 0.45) * 0.28);
    return { color: color, face: face(word.face || {}), motion: word.motion, muted: !!word.muted, scene: word.scene || null };
  }

  // ---------------------------------------------------------------------------------------
  // Motion: a pose at time t (seconds) for intensity k (0...1) and a character `size` px wide.

  function pose(motion, t, k, size) {
    var a = (0.35 + 0.9 * k) * Math.max(0.7, size / 60);   // movement in px
    var s = 0.35 + 0.9 * k;                                 // relative scale changes
    var p = { dx: 0, dy: 0, sx: 1, sy: 1, rotation: 0, opacity: 1 };
    var sin = Math.sin, cos = Math.cos, abs = Math.abs, max = Math.max, pow = Math.pow, h, e, d, r, l, w;
    switch (motion) {
      case "still": break;
      case "breathe": p.sx = p.sy = 1 + sin(t * 1.2) * 0.05 * s; break;
      case "bounce":
        h = abs(sin(t * (3.2 + 1.6 * k)));
        p.dy = -h * 9 * a;
        e = max(0, 0.25 - h) * 0.5 * s;
        p.sx = 1 + e; p.sy = 1 - e; break;
      case "giggle": p.dy = sin(t * 15) * 1.4 * a; p.rotation = sin(t * 7) * 4 * s; break;
      case "rise":
        r = (1 - cos(t * 1.1)) / 2;
        p.dy = -r * 6 * a; p.sx = p.sy = 1 + r * 0.04 * s; break;
      case "lean":
        l = (1 + sin(t * 1.3)) / 2;
        p.dx = l * 3 * a; p.rotation = l * 7 * s; break;
      case "sway":
        w = sin(t * 1.4);
        p.dx = w * 3 * a; p.rotation = w * 9 * s; break;
      case "ripple": p.sx = p.sy = 1 + sin(t * 0.9) * 0.06 * s; p.rotation = sin(t * 0.45) * 3; break;
      case "pop":
        e = pow(max(0, sin(t * 2.2)), 8);
        p.sx = p.sy = 1 + e * 0.18 * s; p.dy = -e * 4 * a; break;
      case "flicker": p.opacity = 1 - (0.15 + 0.3 * k) * abs(sin(t * 2.6) * cos(t * 1.1)); break;
      case "jitter":
        p.dx = (sin(t * 23) * 1.6 + sin(t * 37) * 0.9) * a;
        p.dy = cos(t * 29) * 1.3 * a; break;
      case "fidget": p.dx = (sin(t * 9) * 1.8 + sin(t * 5) * 1.2) * a; break;
      case "pulse": p.sx = p.sy = 1 + max(0, sin(t * 6.5)) * 0.08 * s; break;
      case "heavy":
        h = abs(sin(t * 1.2));
        p.dy = h * 4 * a; p.sx = 1 + h * 0.07 * s; p.sy = 1 - h * 0.07 * s; break;
      case "tremble":
        p.dx = sin(t * 41) * 1.1 * a;
        p.sx = p.sy = 1 - 0.04 * s + sin(t * 2) * 0.02; break;
      case "sink":
        d = (1 - cos(t * 0.9)) / 2;
        p.dy = d * 7 * a; p.opacity = 1 - d * 0.25 * k;
        p.sx = 1 + d * 0.03; p.sy = 1 - d * 0.04; break;
      case "droop":
        d = (1 + sin(t * 0.8)) / 2;
        p.dy = d * 3 * a; p.rotation = -d * 6 * s; p.sy = 1 - d * 0.04 * s; break;
      case "shrink":
        d = (1 + sin(t * 1.6)) / 2;
        p.sx = p.sy = 1 - d * 0.08 * s; p.dy = d * 2 * a; break;
      case "shake": p.dx = sin(t * 18) * max(0, sin(t * 2.1)) * 2.6 * a; break;
      case "sharp":
        e = pow(max(0, sin(t * 3)), 6);
        p.sx = p.sy = 1 + e * 0.14 * s;
        if (k > 0.8) p.dx = sin(t * 45) * 0.8 * a;
        break;
      case "recoil":
        r = (1 + sin(t * 1.5)) / 2;
        p.dx = -r * 3 * a; p.rotation = -r * 8 * s; break;
      case "simmer":
        e = (1 + sin(t * 1.8)) / 2;
        p.sx = p.sy = 1 + e * 0.05 * s; p.dx = sin(t * 30) * 0.4 * a * e; break;
    }
    return p;
  }

  // ---------------------------------------------------------------------------------------
  // Paths

  /** A rounded rectangle into `path` (corner radius clamped, as SwiftUI does). */
  function rr(path, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    path.moveTo(x + r, y);
    path.lineTo(x + w - r, y);
    path.arcTo(x + w, y, x + w, y + r, r);
    path.lineTo(x + w, y + h - r);
    path.arcTo(x + w, y + h, x + w - r, y + h, r);
    path.lineTo(x + r, y + h);
    path.arcTo(x, y + h, x, y + h - r, r);
    path.lineTo(x, y + r);
    path.arcTo(x, y, x + r, y, r);
    path.closePath();
    return path;
  }
  function rrect(x, y, w, h, r) { return rr(new Path2D(), x, y, w, h, r); }
  function ell(path, cx, cy, rx, ry) {
    path.moveTo(cx + rx, cy);
    path.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
    path.closePath();
    return path;
  }
  /** An ellipse filling the rectangle (x, y, w, h), as SwiftUI's Path(ellipseIn:). */
  function ovalIn(x, y, w, h) { return ell(new Path2D(), x + w / 2, y + h / 2, w / 2, h / 2); }
  function circle(p, r) { return ell(new Path2D(), p[0], p[1], r, r); }
  function oval(p, w, h) { return ell(new Path2D(), p[0], p[1], w / 2, h / 2); }
  function poly(pts, close) {
    var p = new Path2D();
    pts.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); });
    if (close) p.closePath();
    return p;
  }
  /** A polyline arc from a0 to a1 degrees (clockwise on screen from the right), as the app draws it. */
  function arcLine(c, r, a0, a1) {
    var pts = [];
    for (var i = 0; i <= 10; i++) {
      var a = (a0 + (a1 - a0) * i / 10) * DEG;
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return poly(pts);
  }
  /** A path turned by `deg` and then moved to (x, y). */
  function turned(path, deg, x, y) {
    var out = new Path2D();
    var m = new DOMMatrix().translateSelf(x, y).rotateSelf(deg);
    out.addPath(path, m);
    return out;
  }
  function starPath(c, r, points, inner) {
    points = points || 5; inner = inner == null ? 0.45 : inner;
    var pts = [];
    for (var i = 0; i < points * 2; i++) {
      var a = i * Math.PI / points - Math.PI / 2, rr2 = i % 2 === 0 ? r : r * inner;
      pts.push([c[0] + rr2 * Math.cos(a), c[1] + rr2 * Math.sin(a)]);
    }
    return poly(pts, true);
  }
  function stroke(ctx, path, style, width, cap) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = cap || "butt";
    ctx.lineJoin = cap === "round" ? "round" : "miter";
    ctx.stroke(path);
  }
  function fill(ctx, path, style, rule) { ctx.fillStyle = style; ctx.fill(path, rule || "nonzero"); }
  function lin(ctx, x0, y0, x1, y1, stops) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s, i) { g.addColorStop(s[1] == null ? i / (stops.length - 1) : s[1], s[0]); });
    return g;
  }
  function shadow(ctx, color, radius, dx, dy, dpr) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 2 * radius * dpr;
    ctx.shadowOffsetX = (dx || 0) * dpr;
    ctx.shadowOffsetY = (dy || 0) * dpr;
  }
  function noShadow(ctx) { ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

  /** The clay body: a circle whose edge wobbles slowly, smoothed through 36 points. */
  function blob(cx, cy, r, phase, wobble) {
    wobble = wobble == null ? 0.045 : wobble;
    var n = 36, pts = [], path = new Path2D(), i;
    for (i = 0; i < n; i++) {
      var ang = i / n * 2 * Math.PI;
      var k = 1 + wobble * (Math.sin(3 * ang + phase) * 0.6 + Math.sin(5 * ang - phase * 1.3) * 0.4);
      var rr2 = r * k / (1 + wobble);
      pts.push([cx + rr2 * Math.cos(ang), cy + rr2 * Math.sin(ang)]);
    }
    function mid(p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }
    var m = mid(pts[n - 1], pts[0]);
    path.moveTo(m[0], m[1]);
    for (i = 0; i < n; i++) {
      var q = mid(pts[i], pts[(i + 1) % n]);
      path.quadraticCurveTo(pts[i][0], pts[i][1], q[0], q[1]);
    }
    path.closePath();
    return path;
  }

  /** A prickly body (irritated): spikes all round. */
  function spiky(r, phase) {
    var n = 28, pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * 2 * Math.PI + phase * 0.04, rr2 = i % 2 === 0 ? r : r * 0.8;
      pts.push([rr2 * Math.cos(a), rr2 * Math.sin(a)]);
    }
    return poly(pts, true);
  }

  // ---------------------------------------------------------------------------------------
  // Faces

  /** Eyes, brows and mouth, centred on (cx, cy) for a face `u` px across. */
  function drawFace(ctx, f, cx, cy, u) {
    var eyeY = cy - u * 0.04 + f.lookY * u * 0.03;
    var line = Math.max(1.2, u * 0.032);
    var eyeInk = f.iris || INK;
    var p, sx;
    for (var side = 0; side < 2; side++) {
      sx = side === 0 ? -1 : 1;
      var ex = cx + sx * u * 0.16 + (f.split ? sx : f.lookX) * u * 0.035;
      if (f.eyes === "closed") {
        p = new Path2D();
        p.moveTo(ex - u * 0.05, eyeY);
        p.quadraticCurveTo(ex, eyeY + (f.mouth >= 0 ? -u * 0.06 : u * 0.05), ex + u * 0.05, eyeY);
        stroke(ctx, p, INK, line, "round");
      } else if (f.eyes === "sleepy") {
        stroke(ctx, poly([[ex - u * 0.05, eyeY + u * 0.01], [ex + u * 0.05, eyeY + u * 0.01]]), INK, line, "round");
        fill(ctx, ovalIn(ex - u * 0.035, eyeY + u * 0.01, u * 0.07, u * 0.04), eyeInk);
      } else if (f.eyes === "narrow") {
        if (APP_DRAWS_ALL) {
          var w = u * 0.09, h = u * 0.06;
          p = new Path2D();
          p.moveTo(ex - w / 2, eyeY - h * 0.2);
          p.lineTo(ex + w / 2, eyeY - h * 0.2);
          p.quadraticCurveTo(ex, eyeY + h * 1.3, ex - w / 2, eyeY - h * 0.2);
          fill(ctx, p, eyeInk);
        }
      } else if (f.eyes === "squeeze") {
        stroke(ctx, poly([[ex + sx * u * 0.045, eyeY - u * 0.045], [ex - sx * u * 0.045, eyeY], [ex + sx * u * 0.045, eyeY + u * 0.045]]), INK, line, "round");
      } else if (f.eyes === "stars") {
        var star = starPath([ex, eyeY], u * 0.095);
        fill(ctx, star, "#FFC83D");
        stroke(ctx, star, rgba(INK_RGB, 0.75), Math.max(0.7, u * 0.016));
      } else {
        var wide = f.eyes === "wide";
        var ew = u * (wide ? 0.10 : 0.085), eh = u * (wide ? 0.15 : 0.12);
        fill(ctx, ovalIn(ex - ew / 2, eyeY - eh / 2, ew, eh), eyeInk);
        fill(ctx, ovalIn(ex - u * 0.004, eyeY - eh * 0.36, u * 0.03, u * 0.03), "#FFFFFF");
      }
      if (f.brows !== 0 || f.lift) {
        var by = eyeY - u * (f.lift ? 0.17 : 0.125);
        stroke(ctx, poly([[ex + sx * u * 0.065, by], [ex - sx * u * 0.055, by - f.brows * u * 0.05]]), INK, Math.max(1, u * 0.026), "round");
      }
    }
    var my = cy + u * 0.13, i, x;
    if (f.oMouth) {
      fill(ctx, ovalIn(cx - u * 0.045, my - u * 0.03, u * 0.09, u * 0.11), INK);
    } else if (f.shape === "teeth") {
      var tx = cx - u * 0.13, ty = my - u * 0.05, tw = u * 0.26, th = u * 0.1;
      var m = rrect(tx, ty, tw, th, u * 0.04);
      fill(ctx, m, "#FFFFFF");
      p = new Path2D();
      p.moveTo(tx, ty + th / 2); p.lineTo(tx + tw, ty + th / 2);
      for (i = 1; i <= 3; i++) { x = tx + tw * i / 4; p.moveTo(x, ty); p.lineTo(x, ty + th); }
      stroke(ctx, p, rgba(INK_RGB, 0.55), Math.max(0.6, u * 0.014));
      stroke(ctx, m, INK, Math.max(1, u * 0.026));
    } else if (f.shape === "laugh") {
      if (APP_DRAWS_ALL) {
        var lm = new Path2D();
        lm.moveTo(cx - u * 0.14, my - u * 0.03);
        lm.lineTo(cx + u * 0.14, my - u * 0.03);
        lm.quadraticCurveTo(cx, my + u * 0.25, cx - u * 0.14, my - u * 0.03);
        lm.closePath();
        fill(ctx, lm, INK);
        ctx.save();
        ctx.clip(lm);
        fill(ctx, ovalIn(cx - u * 0.08, my + u * 0.05, u * 0.16, u * 0.12), PINK);
        ctx.restore();
      }
    } else if (f.shape === "tongue") {
      var gw = u * 0.12;
      p = new Path2D();
      p.moveTo(cx - gw, my);
      for (i = 1; i <= 6; i++) p.lineTo(cx - gw + i * gw / 3, my + (i % 2 === 1 ? -u * 0.02 : u * 0.012));
      var tongue = rrect(cx - u * 0.02, my - u * 0.005, u * 0.1, u * 0.12, u * 0.05);
      fill(ctx, tongue, PINK);
      stroke(ctx, tongue, rgba(INK_RGB, 0.6), Math.max(0.6, u * 0.016));
      stroke(ctx, p, INK, line, "round");
    } else if (f.shape === "zip") {
      stroke(ctx, poly([[cx - u * 0.14, my], [cx + u * 0.14, my]]), INK, line, "round");
      p = new Path2D();
      for (i = 0; i < 6; i++) { x = cx - u * 0.11 + i * u * 0.044; p.moveTo(x, my - u * 0.028); p.lineTo(x, my + u * 0.028); }
      stroke(ctx, p, INK, Math.max(0.6, u * 0.018));
      fill(ctx, rrect(cx + u * 0.13, my - u * 0.01, u * 0.05, u * 0.08, u * 0.014), "#B9B3D6");
    } else if (f.shape === "smirk") {
      p = new Path2D();
      p.moveTo(cx - u * 0.1, my + u * 0.02);
      p.quadraticCurveTo(cx + u * 0.05, my + u * 0.06, cx + u * 0.13, my - u * 0.05);
      stroke(ctx, p, INK, line, "round");
    } else if (f.wobble) {
      var ww = u * 0.12;
      p = new Path2D();
      p.moveTo(cx - ww, my);
      for (i = 1; i <= 6; i++) p.lineTo(cx - ww + i * ww / 3, my + (i % 2 === 1 ? -u * 0.025 : u * 0.012) - f.mouth * u * 0.04);
      stroke(ctx, p, INK, line, "round");
    } else {
      var mw = u * (0.09 + Math.max(0, f.mouth) * 0.05);
      p = new Path2D();
      p.moveTo(cx - mw, my);
      p.quadraticCurveTo(cx, my + f.mouth * u * 0.13, cx + mw, my);
      stroke(ctx, p, INK, line, "round");
    }
    if (f.mouth > 0.3 || f.blush) {
      for (var b = -1; b <= 1; b += 2) fill(ctx, ovalIn(cx + b * u * 0.27 - u * 0.05, cy + u * 0.07, u * 0.10, u * 0.055), "rgba(255,111,145," + (f.blush ? 0.6 : 0.4) + ")");
    }
    if (f.sweat && APP_DRAWS_ALL) {
      var wx = cx + u * 0.30, wy = cy - u * 0.26;
      p = new Path2D();
      p.moveTo(wx, wy - u * 0.07);
      p.quadraticCurveTo(wx + u * 0.06, wy + u * 0.02, wx, wy + u * 0.04);
      p.quadraticCurveTo(wx - u * 0.06, wy + u * 0.02, wx, wy - u * 0.07);
      fill(ctx, p, WATER);
    }
    if (f.tear) fill(ctx, ovalIn(cx - u * 0.17 - u * 0.025, eyeY + u * 0.1, u * 0.05, u * 0.075), WATER);
    if (f.streams) {
      for (var s1 = -1; s1 <= 1; s1 += 2) fill(ctx, rrect(cx + s1 * u * 0.16 - u * 0.03, eyeY + u * 0.05, u * 0.06, u * 0.36, u * 0.03), css(WATER, 0.85));
    }
    if (f.joyTears) {
      for (var s2 = -1; s2 <= 1; s2 += 2) {
        fill(ctx, turned(ovalIn(-u * 0.03, -u * 0.05, u * 0.06, u * 0.09), s2 * 0.9 / DEG, cx + s2 * u * 0.31, eyeY - u * 0.02), WATER);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Bodies

  var STRETCH = { flat: [1.16, 0.55], wide: [1.12, 0.92], squashed: [1.12, 0.8] };

  /** One clay body and its face, centred on (0, 0), `size` px across. */
  function drawBody(ctx, color, f, size, phase, shape, faceAlpha, dpr) {
    var r = size / 2, body;
    var shadeCol = rgba(mix(color, SHADE, 0.45), 0.4);
    var gradient = lin(ctx, -r, -r, r, r, [[rgba(mix(color, WHITE, 0.35))], [rgba(color)], [rgba(mix(color, SHADE, 0.18))]]);
    ctx.save();
    if (shape === "hollow") {
      body = blob(0, 0, r - size * 0.07, phase);
      shadow(ctx, shadeCol, size * 0.08, size * 0.04, size * 0.07, dpr);
      stroke(ctx, body, rgba(mix(color, WHITE, 0.15)), size * 0.14);
    } else if (shape === "ghost") {
      body = blob(0, 0, r, phase);
      fill(ctx, body, rgba(color, 0.38));
      ctx.setLineDash([size * 0.1, size * 0.08]);
      stroke(ctx, body, rgba(mix(color, WHITE, 0.25)), Math.max(1, size * 0.045), "round");
      ctx.setLineDash([]);
    } else if (shape === "spiky") {
      body = spiky(r, phase);
      shadow(ctx, shadeCol, size * 0.1, size * 0.05, size * 0.1, dpr);
      fill(ctx, body, gradient);
    } else {
      body = blob(0, 0, r, phase);
      shadow(ctx, shadeCol, size * 0.1, size * 0.05, size * 0.1, dpr);
      fill(ctx, body, gradient);
      noShadow(ctx);
      // Light from the top left: a soft white rim inside the edge.
      ctx.save();
      ctx.clip(body);
      ctx.translate(-size * 0.03, -size * 0.04);
      var soft = [4, 2.6, 1.3, 0];
      for (var i = 0; i < soft.length; i++) stroke(ctx, body, "rgba(255,255,255,0.12)", size * 0.07 + soft[i] * size * 0.045);
      ctx.restore();
    }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= faceAlpha;
    drawFace(ctx, f, 0, 0, size);
    ctx.restore();
  }

  /** The faces in a picture: one, two leaning together, or three huddled. */
  function bodies(scene, f) {
    var at = scene.at, l, r;
    if (scene.figure === "pair") {
      l = face(f); r = face(f);
      l.lookX = 0.7; r.lookX = -0.7;
      return [{ x: 0.29, y: at[1], r: at[2], tilt: 9, face: l, phase: 0 }, { x: 0.71, y: at[1], r: at[2], tilt: -9, face: r, phase: 1.7 }];
    }
    if (scene.figure === "trio") {
      l = face(f); r = face(f);
      l.lookX = 0.5; r.lookX = -0.5;
      return [{ x: 0.21, y: at[1] + 0.05, r: 0.2, tilt: 10, face: l, phase: 0.8 },
              { x: 0.79, y: at[1] + 0.05, r: 0.2, tilt: -10, face: r, phase: 2.1 },
              { x: 0.5, y: at[1], r: at[2], tilt: 0, face: f, phase: 0 }];
    }
    return [{ x: at[0], y: at[1], r: at[2], tilt: scene.tilt || 0, face: f, phase: 0 }];
  }

  var PLAIN = { at: [0.5, 0.5, 0.5], figure: "one", shape: "round", tilt: 0, hands: null, friend: null, props: [] };
  var BEHIND = { spotlight: 1, starArc: 1, ripples: 1, roof: 1, wall: 1, halo: 1 };
  function hasArt(sc) { return !!(sc.hands || sc.friend || (sc.props && sc.props.length)); }

  // ---------------------------------------------------------------------------------------
  // Things the app draws with SF Symbols: drawings of our own, centred, one size across.

  var GLYPHS = (function () {
    function light(c, k) { return rgba(mix(c.__glyph, WHITE, k)); }
    /** A chunky fist with the thumb up (dir 1) or down (-1), the cuff at the wrist side. */
    function thumb(c, s, dir) {
      c.scale(s, s * dir);
      var p = new Path2D();
      rr(p, -0.5, -0.04, 0.17, 0.52, 0.05);
      rr(p, -0.3, -0.06, 0.66, 0.54, 0.17);
      p.addPath(rrect(-0.12, -0.25, 0.24, 0.5, 0.12), new DOMMatrix().translateSelf(-0.05, -0.24).rotateSelf(-12));
      c.fill(p);
      var gaps = new Path2D();
      [0.08, 0.2, 0.32].forEach(function (y) { gaps.moveTo(0.12, y); gaps.lineTo(0.33, y); });
      stroke(c, gaps, light(c, 0.5), 0.022, "round");
    }
    return {
      "hand.thumbsup.fill": function (c, s) { thumb(c, s, 1); },
      "hand.thumbsdown.fill": function (c, s) { thumb(c, s, -1); },
      "sun.horizon.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        p.moveTo(-0.27, 0.13); p.arc(0, 0.13, 0.27, Math.PI, 2 * Math.PI); p.closePath();
        rr(p, -0.5, 0.19, 1, 0.09, 0.045);
        c.fill(p);
        var rays = new Path2D();
        [180, 225, 270, 315, 360].forEach(function (d) {
          var a = d * DEG;
          rays.moveTo(0.36 * Math.cos(a), 0.13 + 0.36 * Math.sin(a));
          rays.lineTo(0.46 * Math.cos(a), 0.13 + 0.46 * Math.sin(a));
        });
        stroke(c, rays, c.fillStyle, 0.075, "round");
      },
      "arrow.left.and.right": function (c, s) {
        c.scale(s, s);
        var p = poly([[-0.44, 0], [0.44, 0]]);
        p.moveTo(-0.26, -0.17); p.lineTo(-0.44, 0); p.lineTo(-0.26, 0.17);
        p.moveTo(0.26, -0.17); p.lineTo(0.44, 0); p.lineTo(0.26, 0.17);
        stroke(c, p, c.fillStyle, 0.1, "round");
      },
      "bolt.fill": function (c, s) {
        c.scale(s, s);
        var p = poly([[0.1, -0.5], [-0.27, 0.08], [-0.03, 0.08], [-0.12, 0.5], [0.27, -0.1], [0.03, -0.1]], true);
        c.fill(p);
        stroke(c, p, c.fillStyle, 0.04, "round");
      },
      "alarm.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        ell(p, -0.28, -0.34, 0.12, 0.12); ell(p, 0.28, -0.34, 0.12, 0.12); ell(p, 0, 0.05, 0.38, 0.38);
        c.fill(p);
        stroke(c, poly([[-0.2, 0.36], [-0.3, 0.47]]), c.fillStyle, 0.08, "round");
        stroke(c, poly([[0.2, 0.36], [0.3, 0.47]]), c.fillStyle, 0.08, "round");
        stroke(c, poly([[0, -0.14], [0, 0.06], [0.13, 0.13]]), light(c, 0.8), 0.06, "round");
      },
      "arrow.uturn.backward": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        p.moveTo(-0.36, -0.2); p.lineTo(0.1, -0.2); p.arc(0.1, 0.06, 0.26, -Math.PI / 2, Math.PI / 2); p.lineTo(-0.12, 0.32);
        p.moveTo(-0.18, -0.38); p.lineTo(-0.36, -0.2); p.lineTo(-0.18, -0.02);
        stroke(c, p, c.fillStyle, 0.1, "round");
      },
      "gift.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        rr(p, -0.46, -0.2, 0.92, 0.2, 0.05);
        rr(p, -0.4, 0.02, 0.8, 0.44, 0.06);
        c.fill(p);
        c.fill(turned(ovalIn(-0.15, -0.09, 0.3, 0.18), -28, -0.15, -0.31));
        c.fill(turned(ovalIn(-0.15, -0.09, 0.3, 0.18), 28, 0.15, -0.31));
        fill(c, rrect(-0.07, -0.2, 0.14, 0.66, 0.01), light(c, 0.5));
      },
      "trophy.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        p.moveTo(-0.3, -0.46); p.lineTo(0.3, -0.46); p.lineTo(0.28, -0.2);
        p.quadraticCurveTo(0.24, 0.1, 0, 0.12); p.quadraticCurveTo(-0.24, 0.1, -0.28, -0.2); p.closePath();
        rr(p, -0.06, 0.08, 0.12, 0.22, 0.02);
        rr(p, -0.24, 0.28, 0.48, 0.16, 0.04);
        c.fill(p);
        var h = new Path2D();
        h.moveTo(-0.3, -0.38); h.arc(-0.3, -0.26, 0.12, -Math.PI / 2, Math.PI / 2, true);
        h.moveTo(0.3, -0.38); h.arc(0.3, -0.26, 0.12, -Math.PI / 2, Math.PI / 2);
        stroke(c, h, c.fillStyle, 0.07, "round");
      },
      "hands.clap.fill": function (c, s) {
        c.scale(s, s);
        [-1, 1].forEach(function (sd) {
          c.save();
          c.translate(sd * 0.11, 0.06);
          c.rotate(sd * 20 * DEG);
          var p = new Path2D();
          rr(p, -0.13, -0.4, 0.26, 0.72, 0.13);
          rr(p, sd > 0 ? -0.24 : 0.04, -0.02, 0.2, 0.1, 0.05);
          c.fill(p);
          c.restore();
        });
        var t = new Path2D();
        t.moveTo(-0.3, -0.38); t.lineTo(-0.4, -0.48); t.moveTo(0, -0.5); t.lineTo(0, -0.6); t.moveTo(0.3, -0.38); t.lineTo(0.4, -0.48);
        c.scale(1, 1);
        stroke(c, t, c.fillStyle, 0.05, "round");
      },
      "party.popper.fill": function (c, s) {
        c.scale(s, s);
        c.fill(poly([[-0.46, 0.46], [-0.16, -0.18], [0.18, 0.16]], true));
        var st = new Path2D();
        st.moveTo(-0.02, -0.04); st.quadraticCurveTo(0.22, -0.1, 0.18, -0.34);
        st.moveTo(0.06, 0.06); st.quadraticCurveTo(0.24, -0.12, 0.42, -0.04);
        stroke(c, st, c.fillStyle, 0.06, "round");
        var d = new Path2D();
        ell(d, 0.32, -0.42, 0.05, 0.05); ell(d, 0.45, -0.22, 0.045, 0.045); ell(d, 0.08, -0.44, 0.04, 0.04);
        c.fill(d);
        stroke(c, poly([[-0.31, 0.15], [-0.08, 0.36]]), light(c, 0.55), 0.04, "round");
      },
      "binoculars.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        rr(p, -0.44, -0.12, 0.36, 0.5, 0.16); rr(p, 0.08, -0.12, 0.36, 0.5, 0.16);
        rr(p, -0.12, -0.02, 0.24, 0.16, 0.05);
        rr(p, -0.38, -0.36, 0.24, 0.28, 0.06); rr(p, 0.14, -0.36, 0.24, 0.28, 0.06);
        c.fill(p);
        var lens = new Path2D();
        ell(lens, -0.26, 0.2, 0.1, 0.1); ell(lens, 0.26, 0.2, 0.1, 0.1);
        fill(c, lens, light(c, 0.35));
      },
      "lightbulb.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        ell(p, 0, -0.14, 0.3, 0.3);
        p.moveTo(-0.17, 0.06); p.lineTo(0.17, 0.06); p.lineTo(0.12, 0.26); p.lineTo(-0.12, 0.26); p.closePath();
        rr(p, -0.13, 0.28, 0.26, 0.07, 0.03); rr(p, -0.11, 0.37, 0.22, 0.07, 0.03); rr(p, -0.06, 0.45, 0.12, 0.05, 0.025);
        c.fill(p);
        stroke(c, poly([[-0.07, 0.02], [-0.03, -0.1], [0, 0], [0.03, -0.1], [0.07, 0.02]]), light(c, 0.65), 0.03, "round");
      },
      "hand.point.down.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        rr(p, -0.28, -0.5, 0.52, 0.42, 0.13);
        rr(p, -0.07, -0.16, 0.15, 0.66, 0.075);
        rr(p, 0.16, -0.44, 0.14, 0.3, 0.07);
        c.fill(p);
        var cr = new Path2D();
        cr.moveTo(-0.22, -0.38); cr.lineTo(0.12, -0.38); cr.moveTo(-0.22, -0.27); cr.lineTo(0.12, -0.27);
        stroke(c, cr, light(c, 0.45), 0.03, "round");
      },
      "ant.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        ell(p, 0.3, -0.04, 0.11, 0.11); ell(p, 0.08, 0, 0.12, 0.09); ell(p, -0.24, 0.02, 0.2, 0.14);
        c.fill(p);
        var legs = new Path2D();
        [[-0.1, 0.26], [0.08, 0.28], [0.24, 0.24], [-0.1, -0.24], [0.08, -0.26], [0.24, -0.22]].forEach(function (q) {
          legs.moveTo(0.08, 0); legs.lineTo(q[0], q[1]);
        });
        legs.moveTo(0.36, -0.12); legs.lineTo(0.44, -0.26); legs.moveTo(0.38, -0.08); legs.lineTo(0.5, -0.14);
        stroke(c, legs, c.fillStyle, 0.035, "round");
      },
      "cup.and.saucer.fill": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        p.moveTo(-0.3, -0.24); p.lineTo(0.22, -0.24); p.lineTo(0.2, 0.04);
        p.quadraticCurveTo(0.2, 0.2, 0.06, 0.2); p.lineTo(-0.16, 0.2); p.quadraticCurveTo(-0.29, 0.2, -0.29, 0.04); p.closePath();
        ell(p, -0.04, 0.3, 0.46, 0.08);
        c.fill(p);
        var h = new Path2D();
        h.moveTo(0.22, -0.16); h.arc(0.24, -0.06, 0.1, -Math.PI / 2, Math.PI / 2);
        stroke(c, h, c.fillStyle, 0.07, "round");
      },
      "music.note": function (c, s) {
        c.scale(s, s);
        var p = new Path2D();
        p.addPath(ovalIn(-0.19, -0.14, 0.38, 0.28), new DOMMatrix().translateSelf(-0.14, 0.32).rotateSelf(-20));
        rr(p, 0.02, -0.5, 0.08, 0.82, 0.03);
        p.moveTo(0.1, -0.5); p.bezierCurveTo(0.12, -0.3, 0.36, -0.3, 0.34, -0.1);
        p.bezierCurveTo(0.3, -0.2, 0.16, -0.27, 0.1, -0.26); p.closePath();
        c.fill(p);
      }
    };
  })();

  // ---------------------------------------------------------------------------------------
  // The rest of a feeling's picture: who is with it, its hands, what is round it.

  function Art(ctx, scene, color, S, dpr) {
    this.ctx = ctx; this.sc = scene; this.S = S; this.dpr = dpr;
    this.u = 2 * scene.at[2] * S;
    this.skin = mix(color, WHITE, 0.3);
    this.edge = mix(color, EDGE, 0.5);
  }
  var A = Art.prototype;
  A.B = function (dx, dy) { return [this.sc.at[0] * this.S + dx * this.u, this.sc.at[1] * this.S + dy * this.u]; };
  A.P = function (x, y) { return [x * this.S, y * this.S]; };
  A.L = function (v) { return v * this.u; };
  /** A context moved to p and turned by deg, for the duration of fn. */
  A.at = function (p, deg, fn) {
    var c = this.ctx;
    c.save();
    c.translate(p[0], p[1]);
    if (deg) c.rotate(deg * DEG);
    fn.call(this, c);
    c.restore();
  };

  A.draw = function (front) {
    var c = this.ctx, sc = this.sc;
    c.save();
    c.beginPath();
    c.rect(-0.3 * this.S, -0.3 * this.S, 1.6 * this.S, 1.6 * this.S);       // the app's picture canvas
    c.clip();
    if (sc.friend) this.friend(sc.friend, front);
    var self = this;
    (sc.props || []).forEach(function (p) { if (!!BEHIND[p[0]] !== front) self.prop(p); });
    if (front && sc.hands) this.hands(sc.hands);
    c.restore();
  };

  A.heartPath = function (p, s) {
    var x = p[0], y = p[1], h = new Path2D();
    h.moveTo(x, y + s * 0.42);
    h.bezierCurveTo(x - s * 0.18, y + s * 0.28, x - s * 0.5, y + s * 0.14, x - s * 0.5, y - s * 0.08);
    h.bezierCurveTo(x - s * 0.5, y - s * 0.4, x - s * 0.08, y - s * 0.44, x, y - s * 0.24);
    h.bezierCurveTo(x + s * 0.08, y - s * 0.44, x + s * 0.5, y - s * 0.4, x + s * 0.5, y - s * 0.08);
    h.bezierCurveTo(x + s * 0.5, y + s * 0.14, x + s * 0.18, y + s * 0.28, x, y + s * 0.42);
    h.closePath();
    return h;
  };
  A.heart = function (p, s, col) {
    col = col || "#FF5C8A";
    var c = this.ctx, h = this.heartPath(p, s);
    stroke(c, h, css("#B0244F", 0.45), Math.max(0.8, this.L(0.03)));
    fill(c, h, lin(c, p[0] - s / 2, p[1] - s / 2, p[0] + s / 2, p[1] + s / 2, [[rgba(mix(hex(col), WHITE, 0.35))], [col]]));
  };
  /** A four-pointed twinkle with a soft glow. */
  A.sparkle = function (p, s, col) {
    col = col || "#FFD86B";
    var c = this.ctx, x = p[0], y = p[1], r = s / 2, k = r * 0.16, path = new Path2D();
    path.moveTo(x, y - r);
    path.quadraticCurveTo(x + k, y - k, x + r, y);
    path.quadraticCurveTo(x + k, y + k, x, y + r);
    path.quadraticCurveTo(x - k, y + k, x - r, y);
    path.quadraticCurveTo(x - k, y - k, x, y - r);
    path.closePath();
    c.save();
    shadow(c, css(col, 0.8), r * 0.5, 0, 0, this.dpr);
    fill(c, path, col);
    c.restore();
  };
  /** Overlapping circles filled as one, outlined only round the outside. */
  A.puff = function (parts, fillCol, line) {
    var c = this.ctx, all = new Path2D();
    parts.forEach(function (q) { ell(all, q[0][0], q[0][1], q[1], q[1]); });
    stroke(c, all, line || rgba(INK_RGB, 0.22), Math.max(0.8, this.L(0.03)));
    fill(c, all, fillCol || "#FFFFFF");
  };
  A.cloud = function (p, w, col) {
    var c = this.ctx, x = p[0], y = p[1], cl = new Path2D();
    ell(cl, x - w * 0.24, y + w * 0.04, w * 0.2, w * 0.2);
    ell(cl, x + w * 0.02, y - w * 0.06, w * 0.26, w * 0.26);
    ell(cl, x + w * 0.27, y + w * 0.06, w * 0.18, w * 0.18);
    rr(cl, x - w * 0.44, y + w * 0.02, w * 0.88, w * 0.22, w * 0.11);
    stroke(c, cl, rgba(INK_RGB, 0.25), Math.max(0.8, this.L(0.03)));
    fill(c, cl, lin(c, x, y - w * 0.32, x, y + w * 0.24, [[rgba(mix(hex(col), WHITE, 0.4))], [col]]));
  };
  A.drop = function (p, r) {
    var x = p[0], y = p[1], d = new Path2D();
    d.moveTo(x, y - r * 1.9);
    d.quadraticCurveTo(x + r * 0.85, y - r * 0.8, x + r, y + r * 0.1);
    d.bezierCurveTo(x + r, y + r * 1.45, x - r, y + r * 1.45, x - r, y + r * 0.1);
    d.quadraticCurveTo(x - r * 0.85, y - r * 0.8, x, y - r * 1.9);
    d.closePath();
    return d;
  };
  A.leaf = function (p, len, deg, col) {
    this.at(p, deg, function (c) {
      var l = new Path2D();
      l.moveTo(-len / 2, 0);
      l.quadraticCurveTo(0, -len * 0.42, len / 2, 0);
      l.quadraticCurveTo(0, len * 0.42, -len / 2, 0);
      if (APP_DRAWS_ALL) fill(c, l, col || "#6CC17A");
      stroke(c, l, css("#3F7F4B", 0.6), Math.max(0.6, this.L(0.015)));
    });
  };
  A.flame = function (p, h) {
    var c = this.ctx;
    function shape(k) {
      var w = h * 0.62 * k, hh = h * k, x = p[0], y = p[1] + (h - hh) * 0.4, f = new Path2D();
      f.moveTo(x, y - hh / 2);
      f.quadraticCurveTo(x + w * 0.5, y - hh * 0.12, x + w / 2, y + hh * 0.12);
      f.quadraticCurveTo(x + w * 0.5, y + hh * 0.5, x, y + hh / 2);
      f.quadraticCurveTo(x - w * 0.5, y + hh * 0.5, x - w / 2, y + hh * 0.12);
      f.quadraticCurveTo(x - w * 0.5, y - hh * 0.12, x, y - hh / 2);
      f.closePath();
      return f;
    }
    fill(c, shape(1), "#FF7A33");
    fill(c, shape(0.55), "#FFD34D");
  };
  /** A hand `s` long, centred on its palm, fingers up before turning by `deg`: a palm, four fingers a
   *  little apart and a thumb on the `thumb` side (-1 left, 1 right, 0 none), or a fist. */
  A.hand = function (p, s, o) {
    var deg = o.deg || 0, th = o.thumb || 0, spread = o.spread == null ? 1 : o.spread, thumbDeg = o.thumbDeg == null ? 50 : o.thumbDeg;
    var width = o.width == null ? 1 : o.width;
    this.at(p, deg, function (c) {
      var pw = s * 0.6 * width, ph = s * 0.52, parts = [], i;
      if (o.fist) {
        parts.push(rrect(-pw / 2, -ph * 0.55, pw, ph * 1.05, pw * 0.36));
        for (i = 0; i < 4; i++) {
          var x = -pw / 2 + pw * (0.125 + 0.25 * i);
          parts.push(ovalIn(x - pw * 0.135, -ph * 0.68, pw * 0.27, pw * 0.3));
        }
        if (th !== 0) parts.push(rrect(th > 0 ? -pw * 0.08 : -pw * 0.52, -ph * 0.08, pw * 0.6, s * 0.17, s * 0.085));
      } else {
        var fw = pw * 0.2, lengths = [0.34, 0.42, 0.4, 0.3];
        if (th !== 0) parts.push(turned(rrect(-fw * 0.6, -s * 0.36, fw * 1.2, s * 0.4, fw * 0.6), th * thumbDeg, th * pw * 0.36, ph * 0.12));
        for (i = 0; i < 4; i++) {
          var len = s * lengths[th > 0 ? 3 - i : i];
          parts.push(turned(rrect(-fw / 2, -len, fw, len + ph * 0.3, fw / 2), (i - 1.5) * 7 * spread, -pw / 2 + pw * (0.125 + 0.25 * i), -ph * 0.3));
        }
        parts.push(rrect(-pw / 2, -ph / 2, pw, ph, pw * 0.34));
      }
      // Outlines first, then the fills over them, so only the outer edge and the gaps stay drawn.
      var self = this;
      parts.forEach(function (part) { stroke(c, part, rgba(self.edge, 0.85), Math.max(1, self.L(0.032))); });
      var g = lin(c, -pw / 2, -s * 0.5, pw / 2, ph / 2, [[rgba(mix(self.skin, WHITE, 0.4))], [rgba(self.skin)]]);
      parts.forEach(function (part) { fill(c, part, g); });
    });
  };
  /** A hand with its arm, which runs from `elbow` to the hand's wrist (under the hand). */
  A.limb = function (p, s, o) {
    var d = s * 0.52 * 0.42, a = (o.deg || 0) * DEG;
    this.arm(o.elbow, [p[0] - d * Math.sin(a), p[1] + d * Math.cos(a)], o.width);
    // `width` is the arm's thickness; the hand itself keeps its usual palm.
    this.hand(p, s, { deg: o.deg, thumb: o.thumb, fist: o.fist, thumbDeg: o.thumbDeg });
  };
  A.arm = function (a, b, w) {
    var c = this.ctx, path = poly([a, b]);
    stroke(c, path, rgba(this.edge, 0.75), w + this.L(0.05), "round");
    stroke(c, path, rgba(this.skin), w, "round");
  };
  /** One of the app's SF Symbol pictures, drawn our own way: `s` across, centred on p, turned by deg. */
  A.glyph = function (name, p, s, col, deg) {
    var draw = GLYPHS[name];
    if (!draw) return;
    var self = this, c = this.ctx, rgb = Array.isArray(col) ? col : hex(col);
    [[rgba(INK_RGB, 0.3), Math.max(0.6, this.L(0.025)), this.L(0.015)], ["rgba(255,255,255,0.45)", Math.max(0.8, this.L(0.035)), 0]].forEach(function (sh) {
      self.at(p, deg, function (cc) {
        shadow(cc, sh[0], sh[1], 0, sh[2], self.dpr);
        cc.fillStyle = rgba(rgb);
        cc.__glyph = rgb;
        draw(cc, s);
      });
    });
    noShadow(c);
  };
  A.text = function (str, p, size, col, deg) {
    var self = this;
    this.at(p, deg, function (c) {
      shadow(c, rgba(INK_RGB, 0.35), Math.max(0.6, self.L(0.025)), 0, self.L(0.015), self.dpr);
      c.font = "900 " + size + "px ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = col;
      c.fillText(str, 0, 0);
    });
  };
  /** Someone else: a small clay face in another colour. */
  A.buddy = function (p, r, col, f) {
    var c = this.ctx, R = r * this.S, colRGB = hex(col);
    var body = blob(p[0], p[1], R, 2.1);
    c.save();
    shadow(c, rgba(mix(colRGB, SHADE, 0.5), 0.35), R * 0.2, R * 0.08, R * 0.18, this.dpr);
    fill(c, body, lin(c, p[0] - R, p[1] - R, p[0] + R, p[1] + R, [[rgba(mix(colRGB, WHITE, 0.35))], [col], [rgba(mix(colRGB, SHADE, 0.18))]]));
    c.restore();
    fill(c, oval([p[0] - R * 0.28, p[1] - R * 0.45], R * 0.75, R * 0.3), "rgba(255,255,255,0.3)");
    drawFace(c, face(f), p[0], p[1], 2 * R);
  };

  A.friend = function (kind, front) {
    var c = this.ctx, S = this.S, other = "#C6BEEA", blue = "#8FB0EC", r, P = this.P.bind(this);
    switch (kind) {
      case "star":
        if (front) this.glyph("hands.clap.fill", this.B(-0.4, 0.4), this.L(0.34), "#E89B2A", -12);
        else {
          this.buddy(P(0.8, 0.68), 0.16, other, { mouth: 0.7, eyes: "closed" });
          fill(c, starPath(P(0.8, 0.36), 0.11 * S), "#FFC94A");
        }
        break;
      case "pedestal":
        if (front) break;
        r = [P(0.62, 0)[0], P(0, 0.56)[1], 0.32 * S, 0.34 * S];
        var ped = rrect(r[0], r[1], r[2], r[3], S * 0.035);
        fill(c, ped, lin(c, r[0], r[1], r[0], r[1] + r[3], [["#F1EEFB"], ["#CFC7EE"]]));
        stroke(c, ped, "#A79CDF", Math.max(0.8, S * 0.015));
        this.buddy(P(0.78, 0.38), 0.18, other, { mouth: 0.7, eyes: "closed" });
        fill(c, starPath(P(0.78, 0.08), 0.1 * S), "#FFC94A");
        break;
      case "sad":
        if (front) this.hand(P(0.74, 0.55), 0.18 * S, { deg: 72, thumb: -1, thumbDeg: 30 });
        else this.buddy(P(0.79, 0.74), 0.16, blue, { mouth: -0.5, brows: 0.6, tear: true });
        break;
      case "held":
        if (!front) break;
        this.buddy(P(0.33, 0.77), 0.17, blue, { mouth: -0.6, eyes: "closed", brows: 0.7, tear: true });
        this.hand(P(0.15, 0.72), 0.17 * S, { deg: 20, thumb: 1, thumbDeg: 30 });
        this.hand(P(0.5, 0.85), 0.17 * S, { deg: -70, thumb: -1, thumbDeg: 30 });
        break;
      case "below":
        if (!front) this.buddy(P(0.85, 0.86), 0.11, other, { mouth: -0.3, brows: 0.4 });
        break;
      case "faraway":
        if (front) break;
        this.buddy(P(0.76, 0.36), 0.09, other, { mouth: 0.6, lookX: 0.7 });
        this.buddy(P(0.92, 0.38), 0.09, other, { mouth: 0.6, lookX: -0.7 });
        break;
      case "apart":
        if (front) {
          r = [P(0.5, 0)[0], P(0, 0.2)[1], 0.07 * S, 0.8 * S];
          var pane = rrect(r[0], r[1], r[2], r[3], S * 0.025);
          fill(c, pane, css("#D6ECFF", 0.6));
          stroke(c, pane, "rgba(255,255,255,0.95)", Math.max(0.8, S * 0.014));
          stroke(c, poly([[r[0] + r[2] * 0.35, r[1] + r[3] * 0.1], [r[0] + r[2] * 0.35, r[1] + r[3] * 0.4]]), "#FFFFFF", Math.max(0.8, S * 0.012), "round");
        } else this.buddy(P(0.79, 0.62), 0.19, other, { mouth: 0.1, lookX: -0.6 });
        break;
    }
  };

  A.hands = function (h) {
    var B = this.B.bind(this), L = this.L.bind(this), self = this;
    function both(fn) { [-1, 1].forEach(fn); }
    switch (h) {
      case "prayer":
        this.hand(B(-0.06, 0.38), L(0.34), { deg: 4, thumb: 1, spread: 0, thumbDeg: 12, width: 0.62 });
        this.hand(B(0.06, 0.38), L(0.34), { deg: -4, thumb: -1, spread: 0, thumbDeg: 12, width: 0.62 });
        break;
      case "fists":
        both(function (sd) { self.limb(B(0.6 * sd, -0.42), L(0.3), { deg: 12 * sd, thumb: -sd, elbow: B(0.36 * sd, 0.1), width: L(0.11), fist: true }); });
        break;
      case "cheeks":
        both(function (sd) { self.limb(B(0.37 * sd, 0.12), L(0.4), { deg: 10 * sd, thumb: -sd, elbow: B(0.46 * sd, 0.62), width: L(0.12), thumbDeg: 40 }); });
        break;
      case "cover":
        both(function (sd) { self.limb(B(0.165 * sd, -0.06), L(0.44), { deg: -7 * sd, thumb: -sd, elbow: B(0.34 * sd, 0.6), width: L(0.13), thumbDeg: 28 }); });
        break;
      case "facepalm":
        this.limb(B(0.08, -0.14), L(0.5), { deg: -28, thumb: -1, elbow: B(0.46, 0.56), width: L(0.13), thumbDeg: 40 });
        break;
      case "clutch":
        both(function (sd) { self.limb(B(0.33 * sd, -0.4), L(0.36), { deg: -42 * sd, thumb: sd, elbow: B(0.66 * sd, 0.14), width: L(0.12), thumbDeg: 36 }); });
        break;
      case "shrug":
        both(function (sd) { self.limb(B(0.66 * sd, 0.04), L(0.3), { deg: 62 * sd, thumb: -sd, elbow: B(0.38 * sd, 0.24), width: L(0.1), thumbDeg: 30 }); });
        break;
      case "chin":
        this.limb(B(0.06, 0.45), L(0.3), { deg: 0, thumb: -1, elbow: B(0.1, 0.72), width: L(0.13), fist: true });
        break;
      case "mouth":
        this.limb(B(0.08, 0.16), L(0.34), { deg: -72, thumb: -1, elbow: B(0.42, 0.5), width: L(0.12), thumbDeg: 30 });
        break;
      case "stop":
        this.limb(B(0.66, -0.02), L(0.38), { deg: 8, thumb: -1, elbow: B(0.36, 0.2), width: L(0.1) });
        break;
      case "push":
        this.limb(B(0.64, -0.14), L(0.32), { deg: 10, thumb: -1, elbow: B(0.38, -0.02), width: L(0.1) });
        this.limb(B(0.62, 0.24), L(0.32), { deg: 14, thumb: -1, elbow: B(0.36, 0.3), width: L(0.1) });
        break;
      case "crossed":
        this.arm(B(-0.42, 0.25), B(0.3, 0.44), L(0.16));
        this.arm(B(0.42, 0.25), B(-0.3, 0.44), L(0.16));
        break;
      case "onHeart":
        this.heart(B(-0.06, 0.38), L(0.32));
        this.hand(B(0.16, 0.42), L(0.32), { deg: -58, thumb: -1, thumbDeg: 30 });
        break;
      case "hugHeart":
        this.heart(B(0, 0.38), L(0.36));
        this.hand(B(-0.22, 0.42), L(0.28), { deg: 22, thumb: 1, thumbDeg: 30 });
        this.hand(B(0.22, 0.42), L(0.28), { deg: -22, thumb: -1, thumbDeg: 30 });
        break;
      case "wave":
        this.limb(B(0.62, -0.2), L(0.38), { deg: 16, thumb: -1, elbow: B(0.36, 0.14), width: L(0.1) });
        [0.24, 0.32].forEach(function (r) { stroke(self.ctx, arcLine(B(0.62, -0.2), L(r), -70, -15), MARK, L(0.03), "round"); });
        break;
    }
  };

  A.prop = function (p) {
    var c = this.ctx, S = this.S, self = this, i, path, x, y;
    var B = this.B.bind(this), P = this.P.bind(this), L = this.L.bind(this);
    function line(pts, col, w, cap) { stroke(c, poly(pts), col, w, cap || "round"); }
    switch (p[0]) {
      case "symbol":
        this.glyph(p[1], B(p[2], p[3]), L(p[4]), p[5] || this.edge, p[6]);
        break;
      case "text":
        this.text(p[1], B(p[2], p[3]), L(p[4]), p[5], p[6]);
        break;
      case "sparkle":
        this.sparkle(B(p[1], p[2]), L(p[3]));
        break;
      case "heart":
        this.heart(B(p[1], p[2]), L(p[3]));
        break;
      case "exhale":
        path = new Path2D();
        path.moveTo.apply(path, B(-0.14, 0.16));
        path.quadraticCurveTo.apply(path, B(-0.24, 0.26).concat(B(-0.36, 0.22)));
        stroke(c, path, MARK, L(0.028), "round");
        this.puff([[B(-0.44, 0.2), L(0.08)], [B(-0.57, 0.12), L(0.065)], [B(-0.65, 0.23), L(0.05)]]);
        break;
      case "cloudSeat":
        path = new Path2D();
        [[B(-0.36, 0.52), L(0.15)], [B(-0.13, 0.45), L(0.19)], [B(0.14, 0.46), L(0.19)], [B(0.37, 0.53), L(0.14)],
         [B(-0.52, 0.6), L(0.09)], [B(0.53, 0.61), L(0.09)]].forEach(function (q) { ell(path, q[0][0], q[0][1], q[1], q[1]); });
        rr(path, B(-0.58, 0)[0], B(0, 0.54)[1], L(1.16), L(0.15), L(0.075));
        stroke(c, path, css("#A79FD6", 0.7), Math.max(0.8, L(0.03)));
        fill(c, path, lin(c, B(0, 0.3)[0], B(0, 0.3)[1], B(0, 0.7)[0], B(0, 0.7)[1], [["#FFFFFF"], ["#E4E0FA"]]));
        break;
      case "sprout":
        path = new Path2D();
        path.moveTo.apply(path, B(0.66, 0.64));
        path.quadraticCurveTo.apply(path, B(0.58, 0.38).concat(B(0.66, 0.06)));
        stroke(c, path, "#4E9A5B", L(0.05), "round");
        this.leaf(B(0.55, 0.42), L(0.26), -35);
        this.leaf(B(0.78, 0.32), L(0.24), 35);
        var fl = B(0.66, 0);
        for (i = 0; i < 5; i++) {
          var a = i * 2 * Math.PI / 5 - Math.PI / 2;
          fill(c, circle([fl[0] + Math.cos(a) * L(0.09), fl[1] + Math.sin(a) * L(0.09)], L(0.07)), "#FFC94A");
        }
        fill(c, circle(fl, L(0.058)), "#F08A3C");
        break;
      case "confetti":
        [[-0.6, -0.42, "#FF7BA9", 30], [-0.34, -0.7, "#FFC94A", -20], [0.02, -0.8, "#4FD1C5", 45], [0.34, -0.68, "#9F7AEA", 10],
         [0.62, -0.4, "#63B3ED", -35], [0.72, -0.08, "#FF7BA9", 60], [-0.72, -0.1, "#4FD1C5", 15]].forEach(function (b) {
          self.at(B(b[0], b[1]), b[3], function (cc) { fill(cc, rrect(-L(0.055), -L(0.028), L(0.11), L(0.056), L(0.015)), b[2]); });
        });
        this.glyph("party.popper.fill", B(0.6, 0.36), L(0.4), "#F6A93B", 0);
        break;
      case "magnifier":
        var lens = B(0.17, -0.04);
        line([B(0.29, 0.09), B(0.5, 0.33)], "#7A5C3E", L(0.075));
        fill(c, circle(lens, L(0.18)), "rgba(255,255,255,0.6)");
        fill(c, oval(lens, L(0.13), L(0.19)), INK);
        fill(c, circle([lens[0] + L(0.02), lens[1] - L(0.05)], L(0.028)), "#FFFFFF");
        stroke(c, circle(lens, L(0.18)), "#5B4E8C", L(0.045));
        break;
      case "binoculars":
        this.glyph("binoculars.fill", B(0, -0.13), L(0.62), "#3B3561", -4);
        break;
      case "book":
        fill(c, poly([B(-0.46, 0.3), B(0, 0.38), B(0.46, 0.3), B(0.48, 0.59), B(0, 0.67), B(-0.48, 0.59)], true), "#2F8F86");
        [-1, 1].forEach(function (sd) {
          var page = poly([B(0, 0.36), B(0.42 * sd, 0.28), B(0.44 * sd, 0.55), B(0, 0.62)], true);
          fill(c, page, "#FFFDF6");
          stroke(c, page, rgba(INK_RGB, 0.35), Math.max(0.6, L(0.015)));
          for (var k = 0; k < 2; k++) {
            var dy = 0.42 + k * 0.08;
            line([B(0.08 * sd, dy), B(0.33 * sd, dy - 0.045)], rgba(INK_RGB, 0.3), Math.max(0.5, L(0.016)), "butt");
          }
        });
        break;
      case "bulb":
        [200, 235, 270, 305, 340].forEach(function (d) {
          var a = d * DEG;
          line([B(0.27 * Math.cos(a), -0.74 + 0.27 * Math.sin(a)), B(0.37 * Math.cos(a), -0.74 + 0.37 * Math.sin(a))], "#FFC94A", L(0.04));
        });
        this.glyph("lightbulb.fill", B(0, -0.72), L(0.38), "#FFC94A", 0);
        break;
      case "starArc":
        [[-0.66, -0.36, 0.15], [-0.42, -0.64, 0.19], [0, -0.8, 0.25], [0.42, -0.64, 0.19], [0.66, -0.36, 0.15]].forEach(function (q) {
          self.sparkle(B(q[0], q[1]), L(q[2]), "#FFE7A0");
        });
        break;
      case "shockLines":
        [205, 235, 305, 335].forEach(function (d) {
          var a = d * DEG, px = -Math.sin(a), py = Math.cos(a), ca = Math.cos(a), sa = Math.sin(a);
          line([B(0.6 * ca, 0.6 * sa), B(0.66 * ca + 0.045 * px, 0.66 * sa + 0.045 * py), B(0.72 * ca - 0.045 * px, 0.72 * sa - 0.045 * py), B(0.8 * ca, 0.8 * sa)], "#FFB547", L(0.04));
        });
        break;
      case "squiggles":
        [[-0.26, -0.66], [0, -0.76], [0.26, -0.66]].forEach(function (q) {
          var w = new Path2D();
          w.moveTo.apply(w, B(q[0], q[1] + 0.12));
          w.bezierCurveTo.apply(w, B(q[0] + 0.08, q[1] + 0.04).concat(B(q[0] - 0.08, q[1] - 0.04), B(q[0], q[1] - 0.12)));
          stroke(c, w, "#9C8FE8", L(0.04), "round");
        });
        break;
      case "butterfly":
        this.at(B(0.6, 0.3), -15, function (cc) {
          [-1, 1].forEach(function (sd) {
            [ovalIn(sd > 0 ? 0 : -L(0.18), -L(0.17), L(0.18), L(0.19)), ovalIn(sd > 0 ? 0 : -L(0.13), -L(0.01), L(0.13), L(0.14))].forEach(function (wing) {
              fill(cc, wing, "#FF8FC6");
              stroke(cc, wing, css("#C94C86", 0.75), Math.max(0.6, L(0.018)));
            });
          });
          fill(cc, rrect(-L(0.02), -L(0.13), L(0.04), L(0.26), L(0.02)), INK);
        });
        break;
      case "thoughtHeart":
      case "thoughtScribble":
        var bubble = B(0.52, -0.64);
        this.puff([[bubble, L(0.22)], [B(0.27, -0.37), L(0.055)], [B(0.18, -0.26), L(0.035)]], "rgba(255,255,255,0.97)");
        if (p[0] === "thoughtHeart") this.heart(bubble, L(0.24));
        else {
          x = bubble[0]; y = bubble[1];
          var sc2 = new Path2D();
          sc2.moveTo(x - L(0.12), y + L(0.03));
          sc2.bezierCurveTo(x - L(0.13), y - L(0.12), x - L(0.04), y - L(0.13), x + L(0.02), y - L(0.08));
          sc2.bezierCurveTo(x + L(0.11), y - L(0.02), x + L(0.02), y + L(0.13), x - L(0.04), y + L(0.08));
          sc2.bezierCurveTo(x - L(0.1), y + L(0.02), x + L(0.08), y - L(0.13), x + L(0.13), y - L(0.02));
          stroke(c, sc2, "#7C6FD0", L(0.035), "round");
        }
        break;
      case "tremble":
        [-1, 1].forEach(function (sd) {
          var mid = sd > 0 ? 0 : 180;
          [0.62, 0.72].forEach(function (r) { stroke(c, arcLine(B(0, 0), L(r), mid - 22, mid + 22), MARK, L(0.035), "round"); });
        });
        break;
      case "heartbeat":
        var hb = B(0.44, 0.36);
        this.heart(hb, L(0.24));
        [0.17, 0.24].forEach(function (r) { stroke(c, arcLine(hb, L(r), -40, 40), css("#FF5C8A", 0.85), L(0.028), "round"); });
        break;
      case "arrowsIn":
        [160, 205, 250, 290, 335, 20].forEach(function (d) {
          var a = d * DEG, hx = Math.cos(a), hy = Math.sin(a), px = -hy, py = hx, tip = B(0.6 * hx, 0.6 * hy), l = new Path2D();
          l.moveTo.apply(l, B(0.82 * hx, 0.82 * hy)); l.lineTo(tip[0], tip[1]);
          l.moveTo.apply(l, B(0.68 * hx + 0.06 * px, 0.68 * hy + 0.06 * py)); l.lineTo(tip[0], tip[1]);
          l.lineTo.apply(l, B(0.68 * hx - 0.06 * px, 0.68 * hy - 0.06 * py));
          stroke(c, l, "#8A7FD8", L(0.045), "round");
        });
        break;
      case "siren":
        var base = B(0, -0.52);
        fill(c, rrect(base[0] - L(0.17), base[1] - L(0.03), L(0.34), L(0.07), L(0.02)), "#8D89A6");
        var dome = new Path2D();
        dome.moveTo.apply(dome, B(-0.13, -0.54));
        dome.bezierCurveTo.apply(dome, B(-0.13, -0.82).concat(B(0.13, -0.82), B(0.13, -0.54)));
        dome.closePath();
        fill(c, dome, "#FF4D5E");
        fill(c, oval(B(-0.05, -0.66), L(0.05), L(0.08)), "rgba(255,255,255,0.6)");
        [-1, 1].forEach(function (sd) {
          [-0.1, 0, 0.1].forEach(function (dy) { line([B(0.22 * sd, -0.66 + dy * 0.6), B(0.36 * sd, -0.66 + dy * 1.5)], "#FF6B7A", L(0.04)); });
        });
        break;
      case "eggshell":
        var shell = new Path2D();
        shell.moveTo.apply(shell, B(-0.58, 0.24));
        for (i = 1; i <= 8; i++) shell.lineTo.apply(shell, B(-0.58 + 1.16 * i / 8, i % 2 === 1 ? 0.16 : 0.24));
        shell.quadraticCurveTo.apply(shell, B(0.6, 0.64).concat(B(0, 0.64)));
        shell.quadraticCurveTo.apply(shell, B(-0.6, 0.64).concat(B(-0.58, 0.24)));
        shell.closePath();
        fill(c, shell, lin(c, B(0, 0.16)[0], B(0, 0.16)[1], B(0, 0.64)[0], B(0, 0.64)[1], [["#FFF7E6"], ["#F0DAB0"]]));
        stroke(c, shell, "#C9AE7C", L(0.028), "round");
        break;
      case "fly":
        var trail = new Path2D();
        trail.moveTo.apply(trail, B(0.06, -0.58));
        trail.quadraticCurveTo.apply(trail, B(0.2, -0.88).concat(B(0.46, -0.52)));
        c.save(); c.setLineDash([L(0.045), L(0.04)]);
        stroke(c, trail, MARK, L(0.026), "round");
        c.restore();
        this.at(B(0.55, -0.54), 20, function (cc) {
          fill(cc, oval([-L(0.035), -L(0.065)], L(0.11), L(0.075)), css("#E3F0FF", 0.95));
          fill(cc, oval([L(0.045), -L(0.07)], L(0.11), L(0.075)), css("#E3F0FF", 0.95));
          fill(cc, oval([0, 0], L(0.14), L(0.11)), "#6B5FA8");
        });
        break;
      case "wall":
        var x0 = 0.8, x1 = 1.06, y0 = 0.16, y1 = 1.0, rows = 7, rh = (y1 - y0) / rows;
        fill(c, rrect(P(x0, y0)[0], P(x0, y0)[1], (x1 - x0) * S, (y1 - y0) * S, S * 0.03), "#E08D72");
        path = new Path2D();
        for (i = 1; i < rows; i++) { path.moveTo.apply(path, P(x0, y0 + rh * i)); path.lineTo.apply(path, P(x1, y0 + rh * i)); }
        for (i = 0; i < rows; i++) {
          (i % 2 === 0 ? [x0 + 0.13] : [x0 + 0.05, x0 + 0.2]).forEach(function (xx) {
            path.moveTo.apply(path, P(xx, y0 + rh * i)); path.lineTo.apply(path, P(xx, y0 + rh * (i + 1)));
          });
        }
        stroke(c, path, "#F7DCD0", Math.max(0.8, S * 0.014));
        break;
      case "smoke":
        [[-0.12, -1], [0.16, 1]].forEach(function (q) {
          var s3 = new Path2D();
          s3.moveTo.apply(s3, B(q[0], -0.5));
          s3.bezierCurveTo.apply(s3, B(q[0] + 0.15 * q[1], -0.62).concat(B(q[0] - 0.13 * q[1], -0.77), B(q[0] + 0.06 * q[1], -0.92)));
          stroke(c, s3, css("#9C95B5", 0.9), L(0.055), "round");
        });
        break;
      case "vein":
        var vs = L(0.3);
        for (var q = 0; q < 4; q++) {
          this.at(B(0.34, -0.36), q * 90, function (cc) {
            var a2 = new Path2D();
            a2.moveTo(vs * 0.07, -vs * 0.42);
            a2.quadraticCurveTo(vs * 0.09, -vs * 0.09, vs * 0.42, -vs * 0.07);
            stroke(cc, a2, "#E5484D", L(0.055), "round");
          });
        }
        break;
      case "steam":
        [-1, 1].forEach(function (sd) { self.puff([[B(0.57 * sd, -0.36), L(0.08)], [B(0.65 * sd, -0.47), L(0.065)], [B(0.6 * sd, -0.58), L(0.048)]]); });
        break;
      case "flames":
        [[-0.2, 0.32], [0, 0.44], [0.21, 0.32]].forEach(function (f2) { self.flame(B(f2[0], -0.48 - f2[1] / 2), L(f2[1])); });
        break;
      case "shield":
        this.at(B(-0.3, 0.28), -8, function (cc) {
          var w = L(0.52), h = L(0.62), sh = new Path2D();
          sh.moveTo(-w / 2, -h / 2);
          sh.quadraticCurveTo(0, -h * 0.6, w / 2, -h / 2);
          sh.quadraticCurveTo(w / 2, h * 0.2, 0, h / 2);
          sh.quadraticCurveTo(-w / 2, h * 0.2, -w / 2, -h / 2);
          sh.closePath();
          fill(cc, sh, lin(cc, -w / 2, -h / 2, w / 2, h / 2, [["#C7D3EC"], ["#7D90BA"]]));
          stroke(cc, sh, "#EEF2FA", L(0.045), "round");
          stroke(cc, poly([[0, -h * 0.3], [0, h * 0.26]]), "rgba(255,255,255,0.65)", L(0.035), "round");
        });
        break;
      case "brokenLink":
        this.at(B(0.58, -0.42), -35, function (cc) {
          var lw = L(0.27), lh = L(0.14);
          [-0.18, 0.18].forEach(function (dx) { stroke(cc, rrect(L(dx) - lw / 2, -lh / 2, lw, lh, lh / 2), "#B4BED8", L(0.055)); });
          stroke(cc, poly([[-L(0.02), -L(0.15)], [L(0.03), -L(0.04)], [-L(0.03), L(0.04)], [L(0.02), L(0.15)]]), "#FFC83D", L(0.035), "round");
        });
        break;
      case "stink":
        [[0.52, -0.14], [0.67, -0.25], [0.82, -0.1]].forEach(function (q2) {
          var w = new Path2D();
          w.moveTo.apply(w, B(q2[0], q2[1] + 0.16));
          w.bezierCurveTo.apply(w, B(q2[0] + 0.09, q2[1] + 0.06).concat(B(q2[0] - 0.09, q2[1] - 0.06), B(q2[0], q2[1] - 0.16)));
          stroke(c, w, "#8CC152", L(0.045), "round");
        });
        break;
      case "germ":
        var g = B(0.72, -0.38);
        for (i = 0; i < 8; i++) {
          var ga = i * Math.PI / 4;
          line([[g[0] + Math.cos(ga) * L(0.1), g[1] + Math.sin(ga) * L(0.1)], [g[0] + Math.cos(ga) * L(0.17), g[1] + Math.sin(ga) * L(0.17)]], "#6FA83C", L(0.035));
          fill(c, circle([g[0] + Math.cos(ga) * L(0.185), g[1] + Math.sin(ga) * L(0.185)], L(0.03)), "#6FA83C");
        }
        fill(c, circle(g, L(0.13)), "#9BD15A");
        fill(c, circle(B(0.68, -0.4), L(0.022)), INK);
        fill(c, circle(B(0.76, -0.4), L(0.022)), INK);
        break;
      case "cloud":
        this.cloud(B(0, -0.76), L(0.78), "#C3C7DE");
        break;
      case "rainCloud":
        [[-0.18, -0.46], [0.04, -0.4], [0.25, -0.48]].forEach(function (q2) { fill(c, self.drop(B(q2[0], q2[1]), L(0.05)), "#6FB7FF"); });
        this.cloud(B(0, -0.78), L(0.78), "#9AA6C9");
        break;
      case "stormCloud":
        this.glyph("bolt.fill", B(0.6, -0.36), L(0.3), "#FFC83D", 12);
        this.cloud(B(0.52, -0.68), L(0.66), "#6E6A8E");
        break;
      case "sunRain":
        var sun = B(0.24, -0.86);
        for (i = 0; i < 8; i++) {
          var sa2 = i * Math.PI / 4;
          line([[sun[0] + Math.cos(sa2) * L(0.2), sun[1] + Math.sin(sa2) * L(0.2)], [sun[0] + Math.cos(sa2) * L(0.26), sun[1] + Math.sin(sa2) * L(0.26)]], "#FFC94A", L(0.035));
        }
        fill(c, circle(sun, L(0.16)), "#FFC94A");
        [[-0.16, -0.44], [0.08, -0.42]].forEach(function (q2) { fill(c, self.drop(B(q2[0], q2[1]), L(0.045)), "#6FB7FF"); });
        this.cloud(B(-0.06, -0.72), L(0.68), "#B4BCD9");
        break;
      case "balloon":
        var string = new Path2D();
        string.moveTo.apply(string, B(0.4, 0.52));
        string.bezierCurveTo.apply(string, B(0.34, 0.66).concat(B(0.24, 0.46), B(0.16, 0.6)));
        stroke(c, string, MARK, L(0.022), "round");
        this.at(B(0.66, 0.44), 72, function (cc) {
          var b = new Path2D();
          b.moveTo(0, -L(0.22));
          b.bezierCurveTo(L(0.22), -L(0.24), L(0.16), L(0.1), L(0.03), L(0.16));
          b.bezierCurveTo(-L(0.1), L(0.2), -L(0.24), -L(0.18), 0, -L(0.22));
          fill(cc, b, lin(cc, -L(0.2), -L(0.2), L(0.2), L(0.2), [["#FFB3BB"], ["#EE7C8A"]]));
          stroke(cc, b, css("#C2566A", 0.7), Math.max(0.7, L(0.02)));
          var wr = new Path2D();
          wr.moveTo(-L(0.06), -L(0.08));
          wr.quadraticCurveTo(L(0.04), -L(0.1), L(0.06), L(0.02));
          stroke(cc, wr, css("#C2566A", 0.6), Math.max(0.6, L(0.018)), "round");
          fill(cc, poly([[-L(0.02), L(0.15)], [L(0.06), L(0.15)], [L(0.02), L(0.22)]], true), "#C2566A");
        });
        break;
      case "bandage":
        this.at(B(0.24, -0.33), -35, function (cc) {
          var w = L(0.42), h = L(0.14), band = rrect(-w / 2, -h / 2, w, h, h / 2);
          fill(cc, band, "#F6CFA8");
          fill(cc, rrect(-h * 0.55, -h / 2, h * 1.1, h, h * 0.2), "#EAB487");
          stroke(cc, band, css("#C98E5E", 0.8), Math.max(0.6, L(0.018)));
          [-0.16, -0.12, 0.12, 0.16].forEach(function (dx) { fill(cc, circle([L(dx), 0], L(0.013)), "#C98E5E"); });
        });
        break;
      case "wilted":
        var stem = new Path2D();
        stem.moveTo.apply(stem, B(0.72, 0.64));
        stem.lineTo.apply(stem, B(0.72, 0.02));
        stem.quadraticCurveTo.apply(stem, B(0.72, -0.18).concat(B(0.5, 0.06)));
        stroke(c, stem, "#7FA07A", L(0.05), "round");
        this.leaf(B(0.81, 0.36), L(0.26), 55, "#93B38E");
        [[-0.07, 24], [0.07, -24], [0, 0]].forEach(function (q2) {
          self.at(B(0.5 + q2[0], 0.2), q2[1], function (cc) {
            fill(cc, oval([0, 0], L(0.12), L(0.26)), "#D7A1CF");
            stroke(cc, oval([0, 0], L(0.12), L(0.26)), css("#A66E9C", 0.6), Math.max(0.6, L(0.016)));
          });
        });
        fill(c, circle(B(0.5, 0.07), L(0.065)), "#B28A5C");
        break;
      case "candle":
        var top = B(0.64, 0.18), cr = [top[0] - L(0.075), top[1], L(0.15), L(0.44)];
        var wax = rrect(cr[0], cr[1], cr[2], cr[3], L(0.03));
        fill(c, wax, lin(c, cr[0], cr[1], cr[0] + cr[2], cr[1], [["#FFF8EE"], ["#E6D8C4"]]));
        stroke(c, wax, "#BFAF95", Math.max(0.6, L(0.018)));
        line([top, B(0.64, 0.11)], INK, L(0.03));
        var sm = new Path2D();
        sm.moveTo.apply(sm, B(0.64, 0.09));
        sm.bezierCurveTo.apply(sm, B(0.78, -0.04).concat(B(0.52, -0.2), B(0.68, -0.38)));
        stroke(c, sm, css("#A7A2BD", 0.9), L(0.04), "round");
        break;
      case "whiteFlag":
        line([B(0.58, 0.62), B(0.58, -0.42)], "#8C7A6B", L(0.045));
        var flag = new Path2D();
        flag.moveTo.apply(flag, B(0.58, -0.42));
        flag.quadraticCurveTo.apply(flag, B(0.77, -0.5).concat(B(0.96, -0.36)));
        flag.lineTo.apply(flag, B(0.96, -0.08));
        flag.quadraticCurveTo.apply(flag, B(0.77, -0.2).concat(B(0.58, -0.14)));
        flag.closePath();
        fill(c, flag, "#FFFFFF");
        stroke(c, flag, "#B9B4CF", L(0.022), "round");
        break;
      case "brokenHeart":
        var hp = B(0.5, 0.34), hs = L(0.4), full = this.heartPath(hp, hs), hx2 = hp[0], hy2 = hp[1];
        var zig = [[hx2 + hs * 0.02, hy2 - hs * 0.5], [hx2 - hs * 0.07, hy2 - hs * 0.1], [hx2 + hs * 0.07, hy2 + hs * 0.1], [hx2 - hs * 0.02, hy2 + hs * 0.6]];
        [-1, 1].forEach(function (sd) {
          var region = poly(zig.concat([[hx2 + sd * hs, hy2 + hs * 0.6], [hx2 + sd * hs, hy2 - hs * 0.5]]), true);
          c.save();
          c.translate(sd * L(0.04), sd * L(0.01));
          c.clip(region);
          fill(c, full, "#F0566E");
          c.restore();
        });
        break;
      case "jagged":
        [-1, 1].forEach(function (sd) {
          [[-0.5, 0.48], [-0.32, 0.56]].forEach(function (q2) {
            var yy = q2[0], xx = q2[1];
            line([B(xx * sd, yy), B((xx + 0.1) * sd, yy - 0.08), B((xx + 0.1) * sd, yy - 0.16), B((xx + 0.22) * sd, yy - 0.22)], "#8E9AE0", L(0.04));
          });
        });
        break;
      case "peekWall":
        var pr = [P(-0.04, 0)[0], P(0, 0.1)[1], 0.42 * S, 0.94 * S];
        fill(c, rrect(pr[0], pr[1], pr[2], pr[3], S * 0.06), lin(c, pr[0], pr[1], pr[0] + pr[2], pr[1], [["#CFC6F1"], ["#A79CDF"]]));
        line([[pr[0] + pr[2] - S * 0.012, pr[1] + S * 0.05], [pr[0] + pr[2] - S * 0.012, pr[1] + pr[3] - S * 0.05]], "#9A8FD0", S * 0.024);
        break;
      case "medal":
        [[-1, "#5B8DEF"], [1, "#EF5B6B"]].forEach(function (rb) { line([B(0.12 * rb[0], 0.24), B(0.02 * rb[0], 0.48)], rb[1], L(0.09), "butt"); });
        var md = B(0, 0.5);
        fill(c, circle(md, L(0.13)), "#FFC94A");
        stroke(c, circle(md, L(0.13)), "#E0A526", Math.max(0.8, L(0.028)));
        fill(c, starPath(md, L(0.07)), "rgba(255,255,255,0.85)");
        break;
      case "spotlight":
        fill(c, poly([P(0.4, -0.28), P(0.6, -0.28), P(1.02, 1.02), P(-0.02, 1.02)], true),
             lin(c, P(0.5, -0.28)[0], P(0.5, -0.28)[1], P(0.5, 1.02)[0], P(0.5, 1.02)[1], [[css("#FFE89A", 0.85)], [css("#FFE89A", 0.12)]]));
        break;
      case "halo":
        this.at(B(0.04, -0.66), -16, function (cc) {
          var w = L(0.64), h = L(0.18), pts = [];
          for (var k = 0; k <= 36; k++) { var a3 = (26 + k * 308 / 36) * DEG; pts.push([Math.cos(a3) * w / 2, Math.sin(a3) * h / 2]); }
          stroke(cc, poly(pts), "#F6C344", L(0.06), "round");
        });
        break;
      case "banana":
        this.at(B(0.62, 0.52), 0, function (cc) {
          [-160, -90, -20].forEach(function (d) {
            cc.save();
            cc.rotate(d * DEG);
            var f3 = new Path2D();
            f3.moveTo(0, 0);
            f3.quadraticCurveTo(L(0.14), -L(0.11), L(0.3), 0);
            f3.quadraticCurveTo(L(0.16), L(0.06), 0, 0);
            if (APP_DRAWS_ALL) fill(cc, f3, "#FFD84D");
            stroke(cc, f3, "#D9A52B", Math.max(0.6, L(0.018)));
            cc.restore();
          });
          fill(cc, circle([0, 0], L(0.045)), "#F2C230");
        });
        break;
      case "paperBag":
        var bt = -0.62, bb = 0.3, bag = new Path2D();
        bag.moveTo.apply(bag, B(-0.5, bt));
        for (i = 1; i <= 6; i++) bag.lineTo.apply(bag, B(-0.5 + i / 6, bt + (i % 2 === 1 ? 0.07 : 0)));
        bag.lineTo.apply(bag, B(0.54, bb));
        bag.lineTo.apply(bag, B(-0.54, bb));
        bag.closePath();
        fill(c, bag, lin(c, B(-0.5, bt)[0], B(-0.5, bt)[1], B(0.5, bb)[0], B(0.5, bb)[1], [["#DDB585"], ["#C2955F"]]));
        stroke(c, bag, css("#8F6A44", 0.85), L(0.028), "round");
        [-1, 1].forEach(function (sd) { fill(c, oval(B(0.17 * sd, -0.12), L(0.11), L(0.14)), INK); });
        line([B(-0.36, -0.42), B(-0.3, 0.2)], css("#8F6A44", 0.45), Math.max(0.6, L(0.018)), "butt");
        break;
      case "pointer":
        this.glyph("hand.point.down.fill", B(0.44, -0.74), L(0.46), "#F5C77E", 28);
        break;
      case "dots":
        var db = B(0.5, -0.66), dr = [db[0] - L(0.23), db[1] - L(0.13), L(0.46), L(0.26)];
        var bub = rrect(dr[0], dr[1], dr[2], dr[3], L(0.13));
        bub.moveTo(dr[0] + L(0.1), dr[1] + dr[3] - L(0.02));
        bub.lineTo(dr[0] + L(0.03), dr[1] + dr[3] + L(0.09));
        bub.lineTo(dr[0] + L(0.19), dr[1] + dr[3] - L(0.02));
        stroke(c, bub, rgba(INK_RGB, 0.22), Math.max(0.8, L(0.03)));
        fill(c, bub, "#FFFFFF");
        for (i = -1; i <= 1; i++) fill(c, circle([db[0] + i * L(0.11), db[1]], L(0.038)), rgba(INK_RGB, 0.7));
        break;
      case "zzz":
        [[0.44, -0.44, 0.24], [0.62, -0.68, 0.3], [0.82, -0.94, 0.36]].forEach(function (z) { self.text("z", B(z[0], z[1]), L(z[2]), "#9C8FE8", -12); });
        break;
      case "ants":
        this.glyph("ant.fill", B(-0.5, 0.4), L(0.3), "#B0603A", -30);
        this.glyph("ant.fill", B(0.56, -0.32), L(0.27), "#B0603A", 50);
        break;
      case "motion":
        [-1, 1].forEach(function (sd) {
          [[-0.12, 0.14], [0.04, 0.2], [0.2, 0.12]].forEach(function (m2) { line([B(0.6 * sd, m2[0]), B((0.6 + m2[1]) * sd, m2[0])], MARK, L(0.035)); });
        });
        break;
      case "battery":
        var bp = B(0.52, -0.68), brr = [bp[0] - L(0.2), bp[1] - L(0.11), L(0.4), L(0.22)];
        fill(c, rrect(brr[0], brr[1], brr[2], brr[3], L(0.05)), "rgba(255,255,255,0.92)");
        stroke(c, rrect(brr[0], brr[1], brr[2], brr[3], L(0.05)), "#4A4466", L(0.04));
        fill(c, rrect(brr[0] + brr[2] + L(0.012), bp[1] - L(0.05), L(0.05), L(0.1), L(0.015)), "#4A4466");
        fill(c, rrect(brr[0] + L(0.045), brr[1] + L(0.045), L(0.065), brr[3] - L(0.09), L(0.015)), "#F0566E");
        break;
      case "ice":
        var ir = [P(0.06, 0)[0], P(0, 0.13)[1], 0.88 * S, 0.86 * S];
        var cube = rrect(ir[0], ir[1], ir[2], ir[3], S * 0.14);
        fill(c, cube, lin(c, ir[0], ir[1], ir[0] + ir[2], ir[1] + ir[3], [[css("#E3F6FF", 0.62)], [css("#9FD4F5", 0.5)]]));
        stroke(c, cube, "rgba(255,255,255,0.95)", Math.max(1, S * 0.025));
        line([P(0.16, 0.32), P(0.16, 0.22), P(0.28, 0.22)], "#FFFFFF", Math.max(1, S * 0.03));
        break;
      case "bath":
        [[-0.28, 1], [0.3, -1]].forEach(function (q2) {
          var st = new Path2D();
          st.moveTo.apply(st, B(q2[0], -0.56));
          st.bezierCurveTo.apply(st, B(q2[0] + 0.11 * q2[1], -0.68).concat(B(q2[0] - 0.11 * q2[1], -0.8), B(q2[0], -0.92)));
          stroke(c, st, "#B5C7EE", L(0.045), "round");
        });
        var tp = new Path2D(), water = new Path2D();
        [tp, water].forEach(function (pth) {
          pth.moveTo.apply(pth, B(-0.6, 0.27));
          for (var k = 0; k < 4; k++) {
            var xa = -0.6 + 0.3 * k, xb = xa + 0.3;
            pth.quadraticCurveTo.apply(pth, B((xa + xb) / 2, k % 2 === 0 ? 0.19 : 0.35).concat(B(xb, 0.27)));
          }
        });
        water.lineTo.apply(water, B(0.6, 0.64));
        water.lineTo.apply(water, B(-0.6, 0.64));
        water.closePath();
        fill(c, water, lin(c, B(0, 0.2)[0], B(0, 0.2)[1], B(0, 0.64)[0], B(0, 0.64)[1], [["#9EDCF7"], ["#5FB3E8"]]));
        stroke(c, tp, "rgba(255,255,255,0.85)", L(0.03), "round");
        break;
      case "blanket":
        var bl = new Path2D();
        var o1 = B(0, 0.02), o2 = B(0, 0.06);
        ell(bl, o1[0], o1[1], L(1.28) / 2, L(1.26) / 2);
        ell(bl, o2[0], o2[1], L(0.76) / 2, L(0.6) / 2);
        fill(c, bl, lin(c, B(0, -0.6)[0], B(0, -0.6)[1], B(0, 0.6)[0], B(0, 0.6)[1], [["#FBEBD6"], ["#EED2AE"]]), "evenodd");
        c.save();
        c.clip(bl, "evenodd");
        [-0.42, 0.44, 0.54].forEach(function (yy) { line([B(-0.7, yy), B(0.7, yy)], "#E29A72", L(0.05), "butt"); });
        c.restore();
        stroke(c, bl, css("#C48F5E", 0.7), Math.max(0.8, L(0.025)));
        break;
      case "ripples":
        [[1.1, 0.22, 0.85], [1.46, 0.3, 0.55]].forEach(function (rp) { stroke(c, oval(B(0, 0.5), L(rp[0]), L(rp[1])), css("#7FD0B8", rp[2]), Math.max(0.8, L(0.032))); });
        break;
      case "roof":
        fill(c, rrect(B(0.3, 0)[0], B(0, -0.74)[1], L(0.13), L(0.24), 0), "#E07F63");
        line([B(-0.7, -0.24), B(0, -0.82), B(0.7, -0.24)], "#E07F63", L(0.12));
        break;
      case "tea":
        [0.52, 0.64].forEach(function (xx) {
          var st2 = new Path2D();
          st2.moveTo.apply(st2, B(xx, 0.22));
          st2.bezierCurveTo.apply(st2, B(xx + 0.05, 0.16).concat(B(xx - 0.05, 0.08), B(xx, 0.02)));
          stroke(c, st2, "#B5C7EE", L(0.03), "round");
        });
        this.glyph("cup.and.saucer.fill", B(0.6, 0.42), L(0.4), "#FFF7EC", 0);
        break;
      case "lotus":
        [-78, 78, -40, 40, 0].forEach(function (d) {
          self.at(B(0, 0.6), d, function (cc) {
            var pt = new Path2D();
            pt.moveTo(0, 0);
            pt.quadraticCurveTo(L(0.16), -L(0.22), 0, -L(0.44));
            pt.quadraticCurveTo(-L(0.16), -L(0.22), 0, 0);
            if (APP_DRAWS_ALL) fill(cc, pt, lin(cc, 0, -L(0.44), 0, 0, [["#FFE3EE"], ["#FFAFCF"]]));
            stroke(cc, pt, "#E58CB1", Math.max(0.6, L(0.016)));
          });
        });
        break;
      case "notes":
        this.glyph("music.note", B(0.6, -0.5), L(0.32), "#F5A524", 12);
        this.glyph("music.note", B(0.34, -0.78), L(0.24), "#F5A524", -10);
        break;
    }
  };

  // ---------------------------------------------------------------------------------------
  // One character

  /**
   * One character centred at (x, y). options: size (px), t (s), intensity (0...1, more movement
   * when stronger), seed (offsets its timing), dpr (device pixels per px, for shadows), alpha,
   * plain (only the face, as the flower's family faces and anything under 24 px are drawn).
   */
  function draw(ctx, lk, o) {
    var S = o.size, t = (o.t == null ? STILL_T : o.t) + (o.seed || 0), dpr = o.dpr || 1;
    var p = pose(lk.motion, t, o.intensity == null ? 0.55 : o.intensity, S);
    var scene = o.plain || S < 24 || !lk.scene ? PLAIN : lk.scene;
    var color = lk.muted ? mix(lk.color, MUTED, 0.6) : lk.color;
    ctx.save();
    ctx.globalAlpha = (o.alpha == null ? 1 : o.alpha) * p.opacity;
    ctx.translate(o.x + p.dx, o.y + p.dy);
    ctx.rotate(p.rotation * DEG);
    ctx.translate(0, S / 2); ctx.scale(p.sx, p.sy); ctx.translate(0, -S / 2);   // squash from the bottom
    ctx.translate(-S / 2, -S / 2);                                             // the picture's square
    var art = hasArt(scene) ? new Art(ctx, scene, color, S, dpr) : null;
    if (art) art.draw(false);
    var st = STRETCH[scene.shape] || [1, 1];
    bodies(scene, lk.face).forEach(function (b) {
      var bs = S * 2 * b.r;
      ctx.save();
      ctx.translate(S * b.x, S * b.y);
      ctx.rotate(b.tilt * DEG);
      ctx.translate(0, bs / 2); ctx.scale(st[0], st[1]); ctx.translate(0, -bs / 2);
      drawBody(ctx, color, b.face, bs, t * 0.6 + b.phase, scene.shape, lk.muted ? 0.6 : 1, dpr);
      ctx.restore();
    });
    if (art) art.draw(true);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------------------
  // The shared clock: one animation frame loop for every moving character on the page.

  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var items = new Set();
  var running = false, last = 0, frameGap = 1000 / 30, frozen = null;
  var seen = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.target.__clay) en.target.__clay.visible = en.isIntersecting; });
    if (!running) start();
  }, { rootMargin: "120px" }) : null;

  function now() { return frozen != null ? frozen : performance.now() / 1000; }
  function moving() { return !reduce.matches; }

  function tick(ms) {
    if (!running) return;
    var any = false;
    items.forEach(function (it) { if (it.animate) any = true; });
    if (!any) { running = false; return; }          // nothing moves: sleep until something wakes
    requestAnimationFrame(tick);
    if (ms - last < frameGap - 2 || document.hidden) return;
    last = ms;
    var t = now();
    items.forEach(function (it) { if (it.visible && it.animate) it.draw(t); });
  }
  function start() {
    if (running || !moving()) return;
    running = true;
    requestAnimationFrame(tick);
  }
  function stop() { running = false; }
  function redrawAll() {
    var t = moving() ? now() : STILL_T;
    items.forEach(function (it) { it.draw(it.animate && moving() ? t : STILL_T); });
  }
  if (reduce.addEventListener) {
    reduce.addEventListener("change", function () { if (moving()) start(); else { stop(); redrawAll(); } });
  }

  var clock = {
    get reduced() { return !moving(); },
    /** Hold every character at one moment (for screenshots); clock.freeze(null) lets it run. */
    freeze: function (t) { frozen = t; redrawAll(); },
    now: now,
    add: function (it) {
      items.add(it);
      if (it.el && seen) { it.el.__clay = it; it.visible = false; seen.observe(it.el); } else it.visible = true;
      it.draw(it.animate && moving() ? now() : STILL_T);
      if (it.animate) start();
    },
    remove: function (it) {
      items.delete(it);
      if (it.el && seen) seen.unobserve(it.el);
    },
    prune: function () {           // forget characters whose canvas left the page
      items.forEach(function (it) { if (it.el && !it.el.isConnected) clock.remove(it); });
    },
    redraw: redrawAll,
    wake: start,
    still: STILL_T
  };

  /**
   * A character inside `box` (an element `size` px square). The canvas overhangs the box so the
   * character's picture, its movement and its shadow are not clipped.
   * options: size, intensity, seed, animate (default true), plain, rest (the intensity it holds
   * still at, if different), so a still character can come to life on hover with `it.wake()`.
   */
  var OVERHANG = 0.45;
  function mount(box, lk, o) {
    var size = o.size;
    var canvas = document.createElement("canvas");
    var span = size * (1 + 2 * OVERHANG);
    canvas.className = "clay-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.width = span + "px";
    canvas.style.height = span + "px";
    canvas.style.left = (-size * OVERHANG) + "px";
    canvas.style.top = (-size * OVERHANG) + "px";
    box.appendChild(canvas);
    var ctx = canvas.getContext("2d");
    var dpr = 0;
    var it = {
      el: canvas, animate: o.animate !== false, visible: true,
      look: lk, intensity: o.intensity, rest: o.rest == null ? o.intensity : o.rest, seed: o.seed || 0, plain: !!o.plain,
      draw: function (t) {
        var want = Math.min(window.devicePixelRatio || 1, 3);
        if (want !== dpr) {
          dpr = want;
          canvas.width = Math.round(span * dpr);
          canvas.height = Math.round(span * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, span, span);
        draw(ctx, it.look, { x: span / 2, y: span / 2, size: size, t: t, intensity: it.animate ? it.intensity : it.rest,
                             seed: it.seed, dpr: dpr, plain: it.plain });
      },
      /** Start or stop moving (a still character comes to life while pointed at). */
      wake: function (on) {
        it.animate = !!on;
        if (on) start(); else it.draw(STILL_T);
      }
    };
    clock.add(it);
    return it;
  }

  window.Clay = { look: look, pose: pose, draw: draw, mount: mount, clock: clock, mix: mix, hex: hex, rgba: rgba,
                  glyphs: Object.keys(GLYPHS) };
})();
