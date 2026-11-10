/* Face Mirror: the page.
 *
 * One pipeline serves the camera and the sample expressions:
 *   blendshape scores (MediaPipe, or a sample) -> resting values taken off (camera only) -> smoothed
 *     -> the clay head (mapping.js headWeights, a mirror)
 *     -> action units (mapping.js auIntensities) -> timing rules: an action counts after it holds its threshold
 *        for 120 ms and stops 220 ms after it falls below 70% of it; blinks, winks and closed eyes are told apart by
 *        how long the lids stay shut
 *     -> the combination (at most five actions, the strongest; blinks, gaze and head turns left out); once it holds
 *        for 700 ms its evidence is drawn (evidence.js) and stays up, marked "last held", when the face relaxes.
 * Nothing is stored or sent: frames go from the <video> element to the tracker and are dropped; the scores live in
 * memory only while the page is open.
 */
import { createHead, hasWebGL } from './head.js';
import * as MAP from './mapping.js';
import * as EV from './evidence.js';

const meta = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? m.content : ''; };
const CFG = {
  faceValue: meta('face-value-url') || '../evidence/',
  tools: meta('tools-url'),
  mediapipe: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21',
  model: 'models/face_landmarker.task',
  head: 'head/',
  evidence: 'evidence.json',
  maxActions: 5,
  holdMs: 700
};
const Q = new URLSearchParams(location.search);
const TEST = Q.has('test') || Q.has('debug');
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const phone = matchMedia('(max-width: 600px)').matches;
const NAMES = MAP.BLENDSHAPES.slice(1);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const S = {
  mode: 'none', head: null, raf: 0, lastT: 0, lastTick: 0,
  follow: true, frames: 0, fpsT: 0, fps: 0, detects: 0, dps: 0, detectMs: 0,
  // camera
  stream: null, lm: null, trackerP: null, vt: -1, lastDetect: 0, faceSeen: 0, starting: false,
  // signals
  sm: {}, pose: { yaw: 0, pitch: 0, roll: 0 }, raw: {},
  // sample expressions
  sample: { i: 0, t0: 0, paused: false, at: 0 },
  // the combination and its reading
  comboKey: '', comboSince: 0, shownKey: '', ui: 0, rawUi: 0
};
const AU = {};                                  // au -> {v, L, R, on, t0}
const EYE = { L: false, R: false, both0: 0, one0: 0 };

/* ------------------------------------------------------------------ start */
const video = $('#video');
init();
async function init() {
  $('#fv-link').href = CFG.faceValue;
  if (CFG.tools) $('#tools-link').href = CFG.tools;
  wireControls();
  const evP = EV.load(CFG.evidence).then(() => {
    const m = EV.meta(); $('#ev-version').textContent = `Evidence base ${m.version}, ${m.built}`; $('#cr-version').textContent = `${m.version}, ${m.built}`;
  }).catch(() => { $('#ev-rows').innerHTML = '<p class="ev-empty">The evidence could not be loaded just now; reload the page to try again.</p>'; });
  const headP = hasWebGL() ? createHead($('#head'), { base: CFG.head, maxDpr: phone ? 1.5 : 2, shadow: phone ? 1024 : 2048, keepBuffer: TEST,
    onLost: () => { $('#stage-wait').hidden = false; $('#stage-wait').textContent = 'The graphics context was lost. Reload the page to bring the head back.'; } }) : null;
  await evP;
  buildReadout();
  renderCombo();
  if (!headP) { $('#stage-wait').textContent = 'The clay head needs WebGL, which this browser has turned off. The readout and the evidence still work.'; }
  else {
    try { S.head = await headP; $('#stage-wait').hidden = true; }
    catch (e) { $('#stage-wait').textContent = 'The clay head could not be loaded just now. Reload the page to try again.'; }
  }
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    $('#cam-btn').disabled = true; status('The camera needs a secure (https) page and a browser that allows it. The sample expressions work without it.');
  }
  startSamples(reduce.matches);
  if (TEST) exposeTestHook();
}

/* ------------------------------------------------------------------ modes */
function setMode(m) {
  S.mode = m;
  const cam = m === 'camera', samples = m === 'samples';
  document.querySelectorAll('.cam-only').forEach(el => { el.hidden = !cam; });
  document.querySelectorAll('.sample-only').forEach(el => { el.hidden = !samples; });
  $('#cam-btn').textContent = cam || m === 'starting' ? 'Stop camera' : 'Use my camera';
  $('#cam-btn').classList.toggle('primary', !(cam || m === 'starting'));
  $('#sample-btn').setAttribute('aria-pressed', String(samples));
  $('#selfview').hidden = !(cam && $('#show-video').checked);
  modeChip();
  if (m !== 'none') loop();
}
function modeChip(state, text) {
  const chip = $('#mode-chip');
  if (!state) {
    if (S.mode === 'samples') { const s = MAP.SAMPLES[S.sample.i]; state = 'sample'; text = `Sample ${S.sample.i + 1} of ${MAP.SAMPLES.length} · ${s.name}`; }
    else if (S.mode === 'camera') { state = 'search'; text = 'Camera on · looking for a face'; }
    else if (S.mode === 'starting') { state = 'search'; text = 'Starting the camera…'; }
    else { state = 'off'; text = 'Camera off'; }
  }
  if (chip.dataset.state !== state || chip.textContent !== text) { chip.dataset.state = state; chip.textContent = text; }
}
function status(t, warn) { const el = $('#status'); el.textContent = t || ''; el.classList.toggle('warn', !!warn); }

function startSamples(still) {
  if (S.mode === 'camera' || S.mode === 'starting') stopCamera(true);
  resetSignals();
  S.sample = { i: 0, t0: performance.now(), paused: !!still, at: 0 };
  renderSampleUI();
  setMode('samples');
  status(still ? 'Your system asks for reduced motion, so the samples do not play by themselves: use Next.' : '');
}
function wireControls() {
  $('#cam-btn').addEventListener('click', () => {
    if (S.mode === 'camera' || S.mode === 'starting') { stopCamera(); return; }
    const d = $('#consent');
    if (typeof d.showModal === 'function') d.showModal(); else if (window.confirm('Use your camera? The image stays in this browser tab: nothing is recorded, stored or sent.')) startCamera();
  });
  $('#consent-no').addEventListener('click', () => $('#consent').close());
  $('#consent-yes').addEventListener('click', () => { $('#consent').close(); startCamera(); });
  $('#sample-btn').addEventListener('click', () => startSamples(reduce.matches));
  $('#play-btn').addEventListener('click', () => {
    const s = S.sample, now = performance.now();
    if (s.paused) { s.paused = false; s.t0 = now - s.at; } else { s.paused = true; s.at = now - s.t0; }
    renderSampleUI();
  });
  $('#next-btn').addEventListener('click', () => jumpSample((S.sample.i + 1) % MAP.SAMPLES.length));
  $('#rest-btn').addEventListener('click', setRestingFace);
  $('#follow').addEventListener('change', e => { S.follow = e.target.checked; });
  $('#show-video').addEventListener('change', e => { $('#selfview').hidden = !(S.mode === 'camera' && e.target.checked); });
  $('#raw').addEventListener('toggle', () => { S.rawUi = 0; });
  addEventListener('pagehide', () => stopCamera(true));
  // the camera does not stay on in a tab nobody is looking at: it stops after 20 seconds in the background
  let hiddenT = 0;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenT);
    if (document.hidden && (S.mode === 'camera' || S.mode === 'starting')) hiddenT = setTimeout(() => { stopCamera(true); status('The camera was turned off while this tab was in the background.'); }, 20000);
  });
}

/* ------------------------------------------------------------------ the loop */
function loop() { if (!S.raf && !S.manual) S.raf = requestAnimationFrame(tick); }
function tick(now) {
  S.raf = 0;
  if (S.lastTick && now - S.lastTick > 1000 && S.mode === 'samples' && !S.sample.paused) S.sample.t0 += now - S.lastTick;   // the tab was hidden
  S.lastTick = now;
  if (S.mode === 'samples') sampleStep(now);
  else if (S.mode === 'camera') cameraStep(now);
  if (S.head && S.head.frame()) S.frames++;
  if (now - S.fpsT >= 1000) { S.fps = S.frames * 1000 / (now - S.fpsT || 1); S.dps = S.detects * 1000 / (now - S.fpsT || 1); S.frames = 0; S.detects = 0; S.fpsT = now; if (Q.has('debug')) debugLine(); }
  if (S.mode !== 'none') loop();
}

/* ------------------------------------------------------------------ one frame of scores, from either source */
function resetSignals() {
  S.sm = {}; S.pose = { yaw: 0, pitch: 0, roll: 0 }; S.raw = {}; S.lastT = 0;
  Object.keys(AU).forEach(k => delete AU[k]); Object.assign(EYE, { L: false, R: false, both0: 0, one0: 0 });
  S.comboKey = ''; S.comboSince = 0; S.shownKey = ''; S.comboMore = 0; S.ui = 0; S.rawUi = 0; S.lastTick = 0;
  if (S.head) { S.head.set({}); S.head.turn(null); }
  renderCombo(); renderEvidence(null); updateReadout(true);
}
function ingest(bs, pose, now, raw) {
  const dt = S.lastT ? Math.min(100, now - S.lastT) : 1000; S.lastT = now;
  for (const k of NAMES) {
    const v = bs[k] || 0, tau = k.startsWith('eyeBlink') ? 22 : 55, a = 1 - Math.exp(-dt / tau);
    S.sm[k] = S.sm[k] == null ? v : S.sm[k] + (v - S.sm[k]) * a;
  }
  const ap = 1 - Math.exp(-dt / 90);
  for (const k of ['yaw', 'pitch', 'roll']) S.pose[k] += ((pose[k] || 0) - S.pose[k]) * ap;
  S.raw = raw || bs;
  if (S.head) { S.head.set(MAP.headWeights(S.sm)); S.head.turn(S.follow ? MAP.headRotation(S.pose) : null); }
  if (S.learning) return;   // the camera's first second: the resting face is still being learned, so no action counts yet
  track(MAP.auIntensities(S.sm, S.pose), now);
  if (now - S.ui >= 80) { S.ui = now; updateReadout(); }
  if ($('#raw').open && now - S.rawUi >= 200) { S.rawUi = now; renderRaw(); }
  combination(now);
}

/* ------------------------------------------------------------------ action units: thresholds held over time */
function hold(st, thr, now, upMs, downMs) {
  if (!st.on) { if (st.v >= thr) { st.t0 = st.t0 || now; if (now - st.t0 >= upMs) { st.on = true; st.t0 = 0; } } else st.t0 = 0; }
  else if (st.v < thr * 0.7) { st.t0 = st.t0 || now; if (now - st.t0 >= downMs) { st.on = false; st.t0 = 0; } }
  else st.t0 = 0;
}
function track(I, now) {
  for (const e of MAP.AU_TABLE) {
    const a = e.au, x = I[a]; if (!x) continue;
    const st = AU[a] || (AU[a] = { v: 0, on: false, t0: 0 });
    st.v = x.v; st.L = x.L; st.R = x.R;
    hold(st, MAP.ON[a], now, 120, 220);
  }
  if (AU['26'] && AU['27'] && AU['26'].on && AU['27'].on) AU[AU['26'].v >= AU['27'].v ? '27' : '26'].on = false;   // degrees of one opening
  // the eyes: closed briefly (a blink, shown only), closed for 0.4 s or more, or one eye only (a wink)
  const b = I.blink, shut = (was, v) => was ? v > 0.22 : v > 0.35;   // a closed eye scored only 0.4-0.6 on the synthetic head
  EYE.L = shut(EYE.L, b.L); EYE.R = shut(EYE.R, b.R);
  const a43 = AU['43'] || (AU['43'] = { v: 0, on: false }), a45 = AU['45'] || (AU['45'] = { v: 0, on: false, until: 0 }), a46 = AU['46'] || (AU['46'] = { v: 0, on: false });
  a43.v = Math.min(1, Math.min(b.L, b.R) / 0.6); a46.v = Math.min(1, Math.abs(b.L - b.R) / 0.6);
  if (EYE.L && EYE.R) { EYE.both0 = EYE.both0 || now; a43.on = now - EYE.both0 >= 400; a46.on = false; EYE.one0 = 0; }
  else {
    if (EYE.both0) { const d = now - EYE.both0; if (d < 400) a45.until = now + 450; EYE.both0 = 0; }
    a43.on = false;
    if (EYE.L !== EYE.R) { EYE.one0 = EYE.one0 || now; if (now - EYE.one0 >= 180) { a46.on = true; a46.side = EYE.L ? 'left' : 'right'; } }
    else { EYE.one0 = 0; a46.on = false; }
  }
  a45.on = now < a45.until; a45.v = a45.on ? 1 : 0;
}
/* the combination read against the evidence: no blinks, no gaze or head actions, at most five (the strongest) */
function comboNow() {
  const on = Object.keys(AU).filter(a => AU[a].on && a !== '45' && +a < 50).sort((a, b) => AU[b].v - AU[a].v);
  return { codes: on.slice(0, CFG.maxActions).sort((a, b) => +a - +b), more: Math.max(0, on.length - CFG.maxActions) };
}
function combination(now) {
  const c = comboNow(), key = c.codes.join('+');
  if (key !== S.comboKey) { S.comboKey = key; S.comboSince = now; S.comboMore = c.more; renderCombo(); }
  if (key && key !== S.shownKey && now - S.comboSince >= CFG.holdMs) { S.shownKey = key; renderEvidence(c.codes); renderCombo(); announce(c.codes); }
}
/* one spoken summary per new reading; not while the samples play by themselves (a new one every few seconds) */
function announce(codes) {
  if (S.mode === 'samples' && !S.sample.paused && !reduce.matches) return;
  const R = EV.reading(codes), part = t => { const L = R[t.key].filter(x => x.cell.g >= 2).slice(0, 3); return `${t.label}: ${L.length ? L.map(x => `${x.label}, ${x.cell.label.toLowerCase()}`).join('; ') : 'no study reports it'}.`; };
  $('#ev-say').textContent = `Studies on AU${codes.join(' plus AU')}. ` + EV.TYPES.map(part).join(' ');
}

/* ------------------------------------------------------------------ the readout */
const ROWS = {};
let lastActive = '';
/* every estimated action as a small tile (its name in the tooltip and for screen readers): the face first, by number,
   then head and eye actions, which are shown but not read against the evidence */
function buildReadout() {
  const grid = $('#ro-grid'); grid.innerHTML = '';
  const face = MAP.AU_TABLE.filter(e => +e.au < 50).sort((a, b) => +a.au - +b.au), aside = MAP.AU_TABLE.filter(e => +e.au > 50);
  [['Face', face, ''], ['Head and eyes: shown, not read', aside, ' aside']].forEach(([label, list, cls]) => {
    const g = document.createElement('div'); g.className = 'ro-group' + cls;
    g.innerHTML = `<div class="ro-region">${esc(label)}</div>`;
    list.forEach(e => {
      const row = document.createElement('div'); row.className = 'au'; row.dataset.au = e.au;
      const src = e.pair ? `${e.pair}Left / ${e.pair}Right` : e.from ? e.from.join(' / ') : e.note;
      row.title = `AU${e.au} ${EV.auName(e.au)}. Estimated from ${src}.${e.au === '45' || +e.au > 50 ? ' Shown, not read against the evidence.' : ''}`;
      row.innerHTML = `<span class="code">AU${esc(e.au)}<em></em></span><span class="bar"><i></i></span><span class="nm">${esc(EV.auName(e.au))}</span>`;
      g.appendChild(row);
      ROWS[e.au] = { row, bar: row.querySelector('.bar i'), side: row.querySelector('em'), v: -1, on: null, s: '' };
    });
    grid.appendChild(g);
  });
  if (phone) {   // on a phone the evidence should not sit below 35 tiles: they open on request
    grid.classList.add('folded');
    const t = document.createElement('button'); t.type = 'button'; t.className = 'btn small ro-toggle'; t.textContent = 'Show all actions'; t.setAttribute('aria-expanded', 'false');
    t.addEventListener('click', () => { const f = grid.classList.toggle('folded'); t.textContent = f ? 'Show all actions' : 'Hide the list'; t.setAttribute('aria-expanded', String(!f)); });
    grid.before(t);
  }
}
function sideOf(st) { return st && st.on && st.L != null && Math.abs(st.L - st.R) > 0.25 ? (st.L > st.R ? 'left' : 'right') : ''; }
function updateReadout(force) {
  for (const e of MAP.AU_TABLE) {
    const r = ROWS[e.au]; if (!r) continue;
    const st = AU[e.au], v = st ? Math.round(st.v * 100) / 100 : 0, on = !!(st && st.on), s = e.au === '46' && on ? st.side : sideOf(st);
    if (force || v !== r.v) { r.v = v; r.bar.style.transform = `scaleX(${v})`; }
    if (force || on !== r.on) { r.on = on; r.row.classList.toggle('on', on); }
    if (force || s !== r.s) { r.s = s; r.side.textContent = s ? (s === 'left' ? 'L' : 'R') : ''; r.side.title = s ? `stronger on the ${s} side of the face (its own left or right)` : ''; }
  }
  // A blink (AU45) comes and goes in under half a second, so its chip keeps a place at the end of the list whether or
  // not it shows: the panel below never jumps when the eyes blink.
  const blink = !!(AU['45'] && AU['45'].on);
  const act = MAP.AU_TABLE.filter(e => e.au !== '45' && AU[e.au] && AU[e.au].on).map(e => e.au), key = act.map(a => a + (a === '46' ? AU[a].side : sideOf(AU[a]))).join('+') + (blink ? '|45' : '');
  if (!force && key === lastActive) return;
  lastActive = key;
  $('#ro-active').innerHTML = (act.length ? act.map(a => { const s = a === '46' ? AU[a].side : sideOf(AU[a]);
    return `<span class="act${+a > 50 ? ' momentary' : ''}"><b>AU${esc(a)}</b>${esc(EV.auName(a))}${s ? `<span class="side">${s} side</span>` : ''}</span>`; }).join('')
    : `<span class="none">${S.mode === 'camera' && S.faceSeen ? 'No movement above its threshold: a resting face.' : S.mode === 'camera' ? 'Waiting for a face…' : 'No movement above its threshold.'}</span>`)
    + `<span class="act momentary${blink ? '' : ' is-idle'}"${blink ? '' : ' aria-hidden="true"'}><b>AU45</b>${esc(EV.auName('45'))}</span>`;
  // The list only grows: once a reading needs more room it keeps it, so the panel below never jumps back up.
  const ra = $('#ro-active'), need = ra.scrollHeight;
  if (need > (ra.dataset.minH | 0)) { ra.dataset.minH = need; ra.style.minHeight = need + 'px'; }
}
// A new window size starts the list's room again from the style sheet's.
addEventListener('resize', () => { const ra = $('#ro-active'); if (ra) { delete ra.dataset.minH; ra.style.minHeight = ''; } });
function renderRaw() {
  const g = $('#raw-grid');
  if (!g.childElementCount) g.innerHTML = NAMES.map(n => `<div data-n="${n}"><span>${n}</span><span class="bar"><i></i></span><span>0.00</span></div>`).join('');
  g.querySelectorAll('div').forEach(d => { const v = S.raw[d.dataset.n] || 0; d.children[1].firstChild.style.transform = `scaleX(${Math.min(1, v).toFixed(3)})`; d.children[2].textContent = v.toFixed(2); });
}

/* ------------------------------------------------------------------ the evidence */
const chipsOf = codes => codes.map(a => `<span class="cau"><b>AU${esc(a)}</b>${esc(EV.auName(a))}</span>`).join('<span class="plus">+</span>');
function renderCombo() {
  const el = $('#ev-combo'), cur = S.comboKey ? S.comboKey.split('+') : [], shown = S.shownKey ? S.shownKey.split('+') : [];
  const more = S.comboMore ? `<span class="held">+${S.comboMore} weaker left out</span>` : '';
  let html;
  if (cur.length && S.comboKey === S.shownKey) html = chipsOf(cur) + more;
  else if (cur.length) html = chipsOf(cur) + `<span class="held">holding…</span>` + more;
  else if (shown.length) html = `<span class="hint">Last held:</span>` + chipsOf(shown);
  else html = `<span class="hint">${S.mode === 'camera' ? 'Hold a facial movement for a moment: raise your brows, smile, wrinkle your nose.' : 'Waiting for a combination of movements…'}</span>`;
  el.innerHTML = html;
  $('#ev-rows').classList.toggle('stale', !!(cur.length && S.comboKey !== S.shownKey));
  const k = shown.length ? shown : cur;
  $('#ev-link').href = CFG.faceValue + (k.length ? '#combo-' + k.join('-') : '');
  $('#ev-link').textContent = k.length ? `Open AU${k.join(' + AU')} in Face Value` : 'Open Face Value';
  $('#head').setAttribute('aria-label', cur.length ? `A synthetic clay head showing ${cur.map(a => `AU${a} ${EV.auName(a).toLowerCase()}`).join(', ')}` : 'A synthetic clay head at rest');
}
function squares(c) {
  if (c.byReview && c.review) {
    const on = Math.round(c.review.share * 10);
    return Array.from({ length: 10 }, (_, i) => `<i class="r${i < on ? '' : ' off'}"></i>`).join('') + `<span class="sr">: ${Math.round(c.review.share * 100)}% of ${c.review.k} studies in a review</span>`;
  }
  const n = c.n || 0, x = c.against || 0;
  return Array.from({ length: Math.min(n, 12) }, () => '<i></i>').join('') + Array.from({ length: Math.min(x, 8) }, () => '<i class="x"></i>').join('') +
    `<span class="sr">: ${n} sample${n === 1 ? '' : 's'}${x ? `, ${x} against` : ''}</span>`;
}
function tip(x, codes) {
  const c = x.cell, what = codes.length === 1 ? `AU${codes[0]}` : `AU${codes.join(' + AU')} together`;
  if (c.byReview && c.review) return `${Math.round(c.review.share * 100)}% of ${c.review.k} studies counted in a systematic review (${c.review.cite}) found ${codes.length === 1 ? 'this action' : 'each of these actions'} with ${x.label}. ${EV.GRADE[c.g].desc}`;
  return `${c.n} independent sample${c.n === 1 ? '' : 's'} reported ${what} with ${x.label} (${c.de} checked in the full text)${c.against ? `; ${c.against} looked and did not find it` : ''}. ${EV.GRADE[c.g].desc}${c.mixed ? ' Mixed: samples disagree.' : ''}`;
}
function renderEvidence(codes) {
  const rows = $('#ev-rows');
  if (!EV.ready()) return;
  const R = codes && codes.length ? EV.reading(codes) : null;
  rows.innerHTML = EV.TYPES.map(t => {
    let body;
    if (!R) body = '<p class="ev-empty">&ndash;</p>';
    else {
      const L = R[t.key], strong = L.filter(x => x.cell.g >= 2).slice(0, 3), inf = L.filter(x => x.cell.g === 1).slice(0, 2);
      if (strong.length) body = strong.map(x => `<div class="st" title="${esc(tip(x, codes))}"><span class="nm">${esc(x.label)}</span><span class="gr"><b>${esc(x.cell.label)}</b>${x.cell.mixed ? ', mixed' : ''}</span><span class="sq">${squares(x.cell)}</span></div>`).join('');
      else if (inf.length) body = `<p class="ev-inf">No study here reports ${codes.length === 1 ? 'it' : 'these actions together'}. Read from the parts: ${inf.map(x => `<b>${esc(x.label)}</b>`).join(', ')} (inferred).</p>`;
      else body = '<p class="ev-empty">No study in the evidence base.</p>';
    }
    return `<div class="ev-row" data-type="${t.key}"><div class="ev-type"><b><i aria-hidden="true"></i>${esc(t.label)}</b><span>${esc(t.note)}</span></div><div class="ev-states">${body}</div></div>`;
  }).join('');
}

/* ------------------------------------------------------------------ sample expressions */
const ST = { in: 600, hold: 2200, out: 500, rest: 200 }, PER = ST.in + ST.hold + ST.out + ST.rest;
function renderSampleUI() {
  const list = $('#sample-list');
  if (!list.childElementCount) {
    list.innerHTML = MAP.SAMPLES.map((s, i) => `<li><button type="button" data-i="${i}">${esc(s.name)}</button></li>`).join('');
    list.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) jumpSample(+b.dataset.i); });
  }
  list.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(+b.dataset.i === S.sample.i)));
  $('#play-btn').textContent = S.sample.paused ? 'Play' : 'Pause';
  $('#sample-pos').textContent = `${S.sample.i + 1} / ${MAP.SAMPLES.length}`;
  modeChip();
}
function jumpSample(i, at) {
  const s = S.sample, now = at == null ? performance.now() : at;
  s.i = i; s.t0 = now; s.at = reduce.matches || s.paused ? ST.in + ST.hold * 0.4 : 0;
  if (s.paused) s.t0 = now - s.at;
  renderSampleUI(); loop();
}
function sampleStep(now) {
  if (now - S.lastT < 30) return;   // about 30 updates a second, like the camera
  const sm = S.sample;
  let u = sm.paused ? sm.at : now - sm.t0;
  if (!sm.paused && u >= PER) { sm.i = (sm.i + 1) % MAP.SAMPLES.length; sm.t0 += PER * Math.floor(u / PER); u = now - sm.t0; renderSampleUI(); }
  if (sm.paused && reduce.matches) u = ST.in + ST.hold * 0.4;
  const k = u < ST.in ? ease(u / ST.in) : u < ST.in + ST.hold ? 1 : u < ST.in + ST.hold + ST.out ? 1 - ease((u - ST.in - ST.hold) / ST.out) : 0;
  const s = MAP.SAMPLES[sm.i], bs = {}, still = sm.paused || reduce.matches;
  let j = 0;
  for (const n in s.bs) bs[n] = s.bs[n] * k * (still ? 1 : 1 + 0.04 * Math.sin(now / 370 + 1.7 * j++));   // a small, lifelike drift
  if (!still) {   // one blink in the middle of the hold
    const b = u - (ST.in + ST.hold * 0.55);
    if (b > 0 && b < 170) { const e = Math.sin(Math.PI * b / 170); bs.eyeBlinkLeft = Math.max(bs.eyeBlinkLeft || 0, 0.95 * e); bs.eyeBlinkRight = Math.max(bs.eyeBlinkRight || 0, 0.95 * e); }
  }
  // a gentle sway that repeats with each sample, so any sample follows any other without a jump
  const ph = 2 * Math.PI * Math.min(u, PER) / PER;
  const pose = still ? { yaw: 0, pitch: 0, roll: 0 } : { yaw: 3.5 * Math.sin(ph), pitch: 1.6 * Math.sin(2 * ph + 1), roll: 1.2 * Math.sin(ph + 2) };
  ingest(bs, pose, now);
}

/* ------------------------------------------------------------------ the camera */
// MediaPipe's WebAssembly prints routine start-up notes ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")
// through console.error; pass those on as info, so that real errors stay visible as errors.
let quieted = false;
function quietTrackerNotes() {
  if (quieted) return; quieted = true;
  const err = console.error.bind(console);
  console.error = (...a) => { if (typeof a[0] === 'string' && /^INFO: /.test(a[0])) console.info(...a); else err(...a); };
}
function loadTracker() {
  if (S.trackerP) return S.trackerP;
  quietTrackerNotes();
  S.trackerP = (async () => {
    const { FaceLandmarker, FilesetResolver } = await import(`${CFG.mediapipe}/vision_bundle.mjs`);
    const files = await FilesetResolver.forVisionTasks(`${CFG.mediapipe}/wasm`);
    const opts = delegate => ({ baseOptions: { modelAssetPath: CFG.model, delegate }, runningMode: 'VIDEO', numFaces: 1,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
    try { return await FaceLandmarker.createFromOptions(files, opts(Q.get('delegate') === 'CPU' ? 'CPU' : 'GPU')); }
    catch (e) { return await FaceLandmarker.createFromOptions(files, opts('CPU')); }
  })();
  S.trackerP.catch(() => { S.trackerP = null; });
  return S.trackerP;
}
async function startCamera() {
  if (S.starting) return;
  S.starting = true; setMode('starting'); resetSignals(); status('Starting the camera…');
  const tracker = loadTracker();
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
    if (S.mode !== 'starting') { stopCamera(true); return; }
    S.stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (S.mode === 'camera') { stopCamera(true); status('The camera stopped (it was turned off or unplugged).', true); } }));
    video.srcObject = S.stream;
    await video.play();
    if (!S.lm) status('Loading the face tracker (about 14 MB, once)…');
    S.lm = await tracker;
    if (S.mode !== 'starting') { stopCamera(true); return; }
    resetSignals(); Object.assign(REST, { buf: [], last: 0, n: 0, vals: {}, pose: { yaw: 0, pitch: 0, roll: 0 }, fixed: false, collect: null });
    S.vt = -1; S.faceSeen = 0; S.learning = true; $('#rest-btn').disabled = false;
    setMode('camera'); renderCombo(); updateReadout(true);
    status('Camera on. The image stays in this tab. Your resting face is learned as you go; "Set my resting face" sets it now.');
  } catch (e) {
    stopCamera(true);
    const n = e && e.name;
    status(n === 'NotAllowedError' || n === 'SecurityError' ? 'Camera access was not allowed, so the camera stays off. The sample expressions work without it.'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'No camera was found. The sample expressions work without one.'
        : n === 'NotReadableError' ? 'The camera seems to be in use by another app.'
          : 'The face tracker could not start in this browser (it needs WebAssembly and WebGL). The sample expressions still work.', true);
  } finally { S.starting = false; }
}
function stopCamera(quiet) {
  const was = S.mode === 'camera' || S.mode === 'starting';
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null; video.srcObject = null;
  if (!was) return;
  setMode('none');
  S.learning = false; resetSignals();
  if (S.head) S.head.frame();
  if (!quiet) status('Camera off. Nothing was kept.');
}
function cameraStep(now) {
  if (!S.lm || video.readyState < 2 || video.currentTime === S.vt || now - S.lastDetect < 28) { noFace(now); return; }
  S.vt = video.currentTime; S.lastDetect = now;
  const t0 = performance.now();
  let r;
  try { r = S.lm.detectForVideo(video, now); } catch (e) { return; }
  S.detectMs += (performance.now() - t0 - S.detectMs) * 0.1; S.detects++;
  const cats = r && r.faceBlendshapes && r.faceBlendshapes[0] ? r.faceBlendshapes[0].categories : null;
  if (!cats) { noFace(now); return; }
  const bs = {}; for (const c of cats) bs[c.categoryName] = c.score;
  const M = r.facialTransformationMatrixes && r.facialTransformationMatrixes[0] ? r.facialTransformationMatrixes[0].data : null;
  const pose = M ? MAP.poseFromMatrix(M) : { yaw: 0, pitch: 0, roll: 0 };
  const c = rest(bs, pose, now), learning = !REST.fixed && REST.buf.length < 8;
  if (learning !== S.learning || !S.faceSeen || now - S.faceSeen > 400) modeChip('live', learning ? 'Camera on · learning your resting face' : 'Camera on · tracking your face');
  S.learning = learning; S.faceSeen = now;
  ingest(c.bs, c.pose, now, bs);
}
function noFace(now) {
  if (S.mode !== 'camera' || !S.faceSeen || now - S.faceSeen < 400) return;
  if (now - S.lastT < 40) return;
  modeChip('search', 'Camera on · looking for a face');
  ingest({}, { yaw: 0, pitch: 0, roll: 0 }, now);   // relax to rest
}

/* the person's resting values, taken off every score: learned as the 20th percentile of the last 30 seconds (the pose:
   its median), or set on request from the median of 1.5 seconds of a relaxed face */
const REST = { buf: [], last: 0, n: 0, vals: {}, pose: { yaw: 0, pitch: 0, roll: 0 }, fixed: false, collect: null };
function rest(bs, pose, now) {
  if (REST.collect) { REST.collect.push({ bs, pose }); if (now - REST.collect.t0 >= 1500) finishRest(); }
  else if (!REST.fixed && now - REST.last >= 160) {
    REST.last = now; REST.buf.push({ bs, pose }); if (REST.buf.length > 190) REST.buf.shift();
    if (++REST.n % 6 === 0 && REST.buf.length >= 8) setRest(REST.buf, 0.2);
  }
  const out = {};
  for (const k of NAMES) { const b = REST.vals[k] || 0, v = bs[k] || 0; out[k] = Math.max(0, v - b) / Math.max(0.3, 1 - b); }
  return { bs: out, pose: { yaw: pose.yaw - REST.pose.yaw, pitch: pose.pitch - REST.pose.pitch, roll: pose.roll - REST.pose.roll } };
}
function setRest(list, q) {
  const n = list.length, at = Math.floor(q * (n - 1)), mid = Math.floor((n - 1) / 2);
  for (const k of NAMES) REST.vals[k] = list.map(x => x.bs[k] || 0).sort((a, b) => a - b)[at];
  for (const k of ['yaw', 'pitch', 'roll']) REST.pose[k] = list.map(x => x.pose[k]).sort((a, b) => a - b)[mid];
}
function setRestingFace() {
  if (S.mode !== 'camera') return;
  REST.collect = []; REST.collect.t0 = performance.now();
  $('#rest-btn').disabled = true;
  status('Relax your face and look at the screen…');
}
function finishRest() {
  const L = REST.collect; REST.collect = null; $('#rest-btn').disabled = false;
  if (L.length < 5) { status('No face was seen; try again facing the camera.', true); return; }
  setRest(L, 0.5); REST.fixed = true;
  status('Resting face set: movements are now measured from it.');
}

/* ------------------------------------------------------------------ tests and debugging (?test, ?debug) */
function debugLine() {
  let el = $('#debug'); if (!el) { el = document.createElement('div'); el.id = 'debug'; el.className = 'chip mono'; $('.stage-top').appendChild(el); }
  el.textContent = `${S.fps.toFixed(0)} fps · ${S.mode === 'camera' ? `${S.dps.toFixed(0)} detections/s · ${S.detectMs.toFixed(1)} ms` : 'samples'}`;
}
function exposeTestHook() {
  window.faceMirror = {
    get state() {
      return { mode: S.mode, fps: S.fps, dps: S.dps, detectMs: S.detectMs, face: !!(S.faceSeen && performance.now() - S.faceSeen < 400), sample: S.sample.i, learning: !!S.learning,
        active: Object.keys(AU).filter(a => AU[a].on).sort((a, b) => +a - +b), combo: S.comboKey, shown: S.shownKey, headReady: !!S.head,
        rest: { fixed: REST.fixed, n: REST.buf.length }, raw: Object.fromEntries(Object.entries(S.raw).map(([k, v]) => [k, +(+v).toFixed(3)])),
        pose: { yaw: +S.pose.yaw.toFixed(1), pitch: +S.pose.pitch.toFixed(1), roll: +S.pose.roll.toFixed(1) }, turn: S.follow ? MAP.headRotation(S.pose) : null,
        headTop: Object.entries(MAP.headWeights(S.sm)).filter(([, v]) => v > 0.25).map(([k, v]) => k + ':' + v.toFixed(2)) };
    },
    jump: jumpSample, startSamples, pause() { if (!S.sample.paused) $('#play-btn').click(); }, play() { if (S.sample.paused) $('#play-btn').click(); },
    // a manual clock, for recordings: manual(true) stops the animation loop and step(ms) draws the page at that time
    manual(on) { S.manual = !!on; if (on && S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } if (!on) loop(); },
    step(now) { tick(now); }
  };
}
