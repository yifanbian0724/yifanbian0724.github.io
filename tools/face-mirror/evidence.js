/* Face Mirror: what Face Value's evidence base says about a combination of facial actions.
 *
 * The grid is Face Value's "Evidence by type of study" (its evidence engine's matrix(), same rules), computed over
 * evidence.json, the reduced copy of the public kb.json written by dev/build_evidence.py:
 *   Felt               spontaneous production: faces recorded while people were in a state, without being asked to show it
 *   Posed              posed production: people asked to show an emotion
 *   Seen by observers  perception: which actions lead observers to attribute a state (says nothing about what was felt)
 * Each cell is graded on Face Value's scale (Strong, Moderate, Limited, Inferred) from the independent samples behind it.
 * Nothing here looks at a face: the input is a list of action unit codes, the output is evidence about other people.
 */

export const TYPES = [
  { key: 'spontaneous', label: 'Felt', note: 'Spontaneous (unposed) faces, recorded while people were in a state.' },
  { key: 'posed', label: 'Posed', note: 'People asked to show an emotion: a portrayal, not a feeling.' },
  { key: 'perception', label: 'Seen by observers', note: 'What viewers attribute to the face; says nothing about what the person felt.' }
];

/* Face Value's evidence-strength scale */
export const GRADE = [
  { g: 0, label: 'Untested', desc: 'No study sample reports this; only theory or reviews.' },
  { g: 1, label: 'Inferred', desc: 'No sample reports these actions together; read from the single actions.' },
  { g: 2, label: 'Limited', desc: 'One sample, samples known only from abstracts, or samples that disagree.' },
  { g: 3, label: 'Moderate', desc: 'Two or more samples, at least one checked in the full text; most agree.' },
  { g: 4, label: 'Strong', desc: 'Four or more samples, two or more checked in the full text; three in four agree.' }
];

export function gradeOf(n, de, against) {
  if (!n) return { g: 0, mixed: false };
  let g = n >= 4 && de >= 2 ? 4 : n >= 2 && de >= 1 ? 3 : 2;
  const agree = n / (n + (against || 0)), mixed = agree < 0.75;
  if (mixed) g = Math.max(2, g - 1);
  if (agree < 0.5) g = Math.min(g, 2);
  return { g, mixed, agree };
}

let DB = null;
export async function load(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('evidence ' + r.status);
  DB = await r.json();
  return DB;
}
export const ready = () => !!DB;
export const meta = () => DB && { version: DB.version, built: DB.built };
export const auName = code => (DB && DB.aus[code] ? DB.aus[code].name : 'Action unit ' + code);
export const known = code => !!(DB && DB.aus[code]);

/* Face Value's display label: without "(latent pattern n)" and "appraisal: " */
export const stateLabel = s => String(s).replace(/\s*\(latent pattern \d\)/, '').replace(/^(appraisal|social motive): /, '');

/** One row per state, one cell per type of study, each graded (Face Value's matrix(), restricted to three types). */
export function matrix(codes) {
  codes = [...new Set((codes || []).map(String))].filter(known);
  const rows = new Map();
  const row = s => { if (!rows.has(s)) rows.set(s, { state: s, cells: {} }); return rows.get(s); };
  const cellOf = (s, t) => { const r = row(s); if (!r.cells[t]) r.cells[t] = { stream: t, n: 0, de: 0, against: 0, joint: false, units: new Set(), unitsDE: new Set(), againstU: new Set(), parts: {}, within: null }; return r.cells[t]; };
  const T = DB.streams;
  if (codes.length >= 2) {
    DB.configs.forEach(([aus, si, state, units, unitsDE, contra]) => {
      const C = new Set(aus); if (!codes.every(a => C.has(a)) || C.size - codes.length > 2) return;   // the selection, alone or with up to two more actions
      const x = cellOf(state, T[si]);
      units.forEach(u => x.units.add(u)); unitsDE.forEach(u => x.unitsDE.add(u)); contra.forEach(u => x.againstU.add(u));
    });
    DB.configs.forEach(([aus, si, state, units]) => {   // a configuration wholly inside the selection: shown with the reading, never raises it
      if (aus.length < 2 || aus.length >= codes.length || !aus.every(a => codes.includes(a)) || !units.length) return;
      const x = cellOf(state, T[si]); if (!x.within || units.length > x.within.units) x.within = { aus, units: units.length };
    });
  }
  codes.forEach(a => DB.aus[a].links.forEach(([si, state, present, presentDE, against]) => {
    cellOf(state, T[si]).parts[a] = { n: present, de: presentDE, against };
  }));
  const out = [];
  rows.forEach(r => {
    let any = false;
    Object.values(r.cells).forEach(x => {
      if (codes.length === 1) { const p = x.parts[codes[0]] || { n: 0, de: 0, against: 0 }; x.n = p.n; x.de = p.de; x.against = p.against; x.joint = true; }
      else { x.n = x.units.size; x.de = x.unitsDE.size; x.against = x.againstU.size; x.joint = x.n > 0; }
      const gr = gradeOf(x.n, x.de, x.against);
      if (x.joint && x.n) { x.g = gr.g; x.mixed = gr.mixed; }
      else {
        const nParts = Object.values(x.parts).filter(p => p.n > 0).length;
        x.g = (x.within || nParts >= Math.min(2, codes.length)) ? 1 : 0; x.mixed = false;
        x.inferredFrom = { singles: Object.keys(x.parts).filter(a => x.parts[a].n > 0), within: x.within };
        if (!x.within && !nParts) x.g = -1;    // only null findings: no positive evidence at all
      }
      x.label = x.g >= 0 ? GRADE[x.g].label : 'Against';
      delete x.units; delete x.unitsDE; delete x.againstU;
      if (x.g >= 1) any = true;
    });
    if (any) out.push(r);
  });
  /* systematic reviews that counted how many studies found each action: a selection they cover gets the review's support */
  reviewSupport(codes).forEach(rv => {
    let r = out.find(x => x.state === rv.state);
    if (!r) { r = { state: rv.state, cells: {} }; out.push(r); }
    const c = r.cells[rv.stream] || (r.cells[rv.stream] = { stream: rv.stream, n: 0, de: 0, against: 0, joint: false, parts: {}, within: null, g: 0, label: GRADE[0].label });
    c.review = rv; const rg = rv.k >= 10 && rv.share >= 0.6 ? 4 : rv.k >= 4 && rv.share >= 0.4 ? 3 : 2;
    if (rg > c.g) { c.g = rg; c.label = GRADE[rg].label; c.mixed = rv.share < 0.75; c.byReview = true; }
  });
  return out;
}
function reviewSupport(codes) {
  const byState = {};
  DB.reviews.forEach(e => { const key = e[0] + '|' + e[1]; (byState[key] = byState[key] || []).push(e); });
  const out = [];
  Object.entries(byState).forEach(([key, list]) => {
    const per = {};
    list.forEach(([, , acts, est, k, cite]) => acts.forEach(a => { const p = per[a] || (per[a] = { yes: 0, k: 0, cite }); p.yes += est * k; p.k += k; }));
    if (!codes.every(a => per[a])) return;
    const shares = codes.map(a => per[a].yes / per[a].k), ks = codes.map(a => per[a].k);
    const [state, si] = key.split('|');
    out.push({ state, stream: DB.streams[+si], share: Math.min(...shares), k: Math.min(...ks), cite: list[0][5] });
  });
  return out;
}

/** The reading for Face Mirror: per type of study, the states with positive evidence, strongest first. */
export function reading(codes, perType) {
  const M = matrix(codes), out = {};
  TYPES.forEach(({ key }) => {
    out[key] = M.filter(r => r.cells[key] && r.cells[key].g >= 1)
      .map(r => ({ state: r.state, label: stateLabel(r.state), cell: r.cells[key] }))
      .sort((a, b) => b.cell.g - a.cell.g || (b.cell.n || 0) - (a.cell.n || 0) || a.label.localeCompare(b.label))
      .slice(0, perType || 3);
  });
  return out;
}
