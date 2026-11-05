
/* ---- src/stats.js ---- */
/*
 * Statistics for facial action unit (AU) analyses.
 * Pure JavaScript without dependencies; runs in browsers (window.AUStats) and Node (require).
 * Every function states its method; numerical results are
 * checked against scipy, statsmodels and scikit-learn in test/stats.test.js.
 *
 * Conventions: vectors are plain arrays or typed arrays of numbers without missing values
 * (callers do listwise deletion and report it); matrices are arrays of row arrays.
 */
(function (root, factory) {
  const S = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.AUStats = S;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const S = {version: '1.0.0'};
const LN2PI = Math.log(2 * Math.PI);

/* ============================== random numbers ============================== */
/** Seeded PRNG (mulberry32); returns a function giving uniform numbers in [0, 1). */
S.rng = function (seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
S.shuffle = function (arr, rnd) {
  const a = Array.from(arr);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
};

/* ============================== descriptives ============================== */
const isNum = v => typeof v === 'number' && isFinite(v);
S.isNum = isNum;
S.sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
S.mean = a => a.length ? S.sum(a) / a.length : NaN;
S.variance = a => {
  const n = a.length; if (n < 2) return NaN;
  const m = S.mean(a); let s = 0;
  for (let i = 0; i < n; i++) { const d = a[i] - m; s += d * d; }
  return s / (n - 1);
};
S.sd = a => Math.sqrt(S.variance(a));
S.min = a => { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return a.length ? m : NaN; };
S.max = a => { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return a.length ? m : NaN; };
/** Quantile with linear interpolation (type 7, the default in R and numpy). */
S.quantile = function (a, q) {
  const s = Float64Array.from(a).sort(); const n = s.length; if (!n) return NaN;
  const h = (n - 1) * q, lo = Math.floor(h);
  return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
};
S.median = a => S.quantile(a, 0.5);
S.describe = function (a) {
  const x = Array.from(a).filter(isNum);
  return {n: x.length, missing: a.length - x.length, mean: S.mean(x), sd: S.sd(x), min: S.min(x),
    q1: S.quantile(x, 0.25), median: S.median(x), q3: S.quantile(x, 0.75), max: S.max(x)};
};
/** Average ranks (ties get the mean rank), 1-based. Also returns tie-group sizes. */
S.rank = function (a) {
  const n = a.length, idx = Array.from({length: n}, (_, i) => i).sort((i, j) => a[i] - a[j]);
  const r = new Float64Array(n), ties = [];
  let i = 0;
  while (i < n) {
    let j = i; while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    if (j > i) ties.push(j - i + 1);
    i = j + 1;
  }
  r.ties = ties;
  return r;
};

/* ============================== distributions ============================== */
/** Standard normal CDF, double precision (Hart 1968 as implemented by West 2005). */
S.normCdf = function (z) {
  const x = Math.abs(z); let c;
  if (x > 37) c = 0;
  else {
    const e = Math.exp(-x * x / 2);
    if (x < 7.07106781186547) {
      let b = 3.52624965998911e-02 * x + 0.700383064443688;
      b = b * x + 6.37396220353165; b = b * x + 33.912866078383; b = b * x + 112.079291497871;
      b = b * x + 221.213596169931; b = b * x + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-02 * x + 1.75566716318264;
      b = b * x + 16.064177579207; b = b * x + 86.7807322029461; b = b * x + 296.564248779674;
      b = b * x + 637.333633378831; b = b * x + 793.826512519948; b = b * x + 440.413735824752;
      c = c / b;
    } else {
      let b = x + 0.65; b = x + 4 / b; b = x + 3 / b; b = x + 2 / b; b = x + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return z > 0 ? 1 - c : c;
};
/** Two-sided normal p-value for a z statistic. */
S.normP2 = z => 2 * S.normCdf(-Math.abs(z));
/** Standard normal quantile (Acklam's rational approximation plus one Halley refinement). */
S.normInv = function (p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, r, x;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const e = S.normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
  return x - u / (1 + x * u / 2);
};
/** log Gamma (Lanczos, g = 7, n = 9). */
S.lgamma = function (x) {
  const g = 7, C = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - S.lgamma(1 - x);
  x -= 1; let a = C[0]; const t = x + g + 0.5;
  for (let i = 1; i < 9; i++) a += C[i] / (x + i);
  return 0.5 * LN2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
/** Regularized incomplete beta function I_x(a, b). */
S.ibeta = function (x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const lbt = S.lgamma(a + b) - S.lgamma(a) - S.lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
  return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
};
/** Two-sided p-value of Student's t. */
S.tP2 = (t, df) => isFinite(t) ? S.ibeta(df / (df + t * t), df / 2, 0.5) : 0;
S.tCdf = (t, df) => { const p = 0.5 * S.ibeta(df / (df + t * t), df / 2, 0.5); return t > 0 ? 1 - p : p; };
/** Quantile of Student's t (bisection on the CDF). */
S.tInv = function (p, df) {
  if (df > 1e6) return S.normInv(p);
  let lo = -1e3, hi = 1e3;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (S.tCdf(m, df) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
};
/** Upper-tail p-value of the F distribution. */
S.fSf = (f, d1, d2) => f <= 0 ? 1 : S.ibeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
function gser(a, x) { // series for P(a, x)
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-16) break; }
  return sum * Math.exp(-x + a * Math.log(x) - S.lgamma(a));
}
function gcf(a, x) { // continued fraction for Q(a, x)
  const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - S.lgamma(a)) * h;
}
/** Regularized upper incomplete gamma Q(a, x). */
S.gammaQ = (a, x) => x <= 0 ? 1 : (x < a + 1 ? 1 - gser(a, x) : gcf(a, x));
/** Upper-tail p-value of the chi-square distribution. */
S.chi2Sf = (x, df) => x <= 0 ? 1 : S.gammaQ(df / 2, x / 2);
const LOGFACT = [0];
S.logFactorial = function (n) {
  if (n < 0) return NaN;
  if (n < 2000) { while (LOGFACT.length <= n) LOGFACT.push(LOGFACT[LOGFACT.length - 1] + Math.log(LOGFACT.length)); return LOGFACT[n]; }
  return S.lgamma(n + 1);
};

/* ============================== linear algebra ============================== */
const M = {};
S.mat = M;
M.zeros = (r, c) => Array.from({length: r}, () => new Float64Array(c));
M.ident = n => { const I = M.zeros(n, n); for (let i = 0; i < n; i++) I[i][i] = 1; return I; };
M.copy = A => A.map(r => Float64Array.from(r));
/** Cholesky factor L (lower) of a symmetric positive-definite matrix, or null. */
M.cholesky = function (A) {
  const n = A.length, L = M.zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); }
      else L[i][j] = s / L[j][j];
    }
  }
  return L;
};
M.cholSolve = function (L, b) {
  const n = L.length, y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
};
M.cholInv = function (L) {
  const n = L.length, inv = M.zeros(n, n);
  for (let j = 0; j < n; j++) { const e = new Float64Array(n); e[j] = 1; const col = M.cholSolve(L, e); for (let i = 0; i < n; i++) inv[i][j] = col[i]; }
  return inv;
};
M.logdetChol = L => { let s = 0; for (let i = 0; i < L.length; i++) s += 2 * Math.log(L[i][i]); return s; };
/** LU decomposition with partial pivoting; returns {LU, piv, sign} or null if singular. */
M.lu = function (A) {
  const n = A.length, LU = M.copy(A), piv = Array.from({length: n}, (_, i) => i); let sign = 1;
  for (let k = 0; k < n; k++) {
    let p = k, mx = Math.abs(LU[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(LU[i][k]) > mx) { mx = Math.abs(LU[i][k]); p = i; }
    if (mx < 1e-300) return null;
    if (p !== k) { const t = LU[p]; LU[p] = LU[k]; LU[k] = t; const tp = piv[p]; piv[p] = piv[k]; piv[k] = tp; sign = -sign; }
    for (let i = k + 1; i < n; i++) {
      LU[i][k] /= LU[k][k];
      const f = LU[i][k]; if (f === 0) continue;
      for (let j = k + 1; j < n; j++) LU[i][j] -= f * LU[k][j];
    }
  }
  return {LU, piv, sign};
};
M.luSolve = function (dec, b) {
  const {LU, piv} = dec, n = LU.length, x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[piv[i]]; for (let k = 0; k < i; k++) s -= LU[i][k] * x[k]; x[i] = s; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k < n; k++) s -= LU[i][k] * x[k]; x[i] = s / LU[i][i]; }
  return x;
};
/** Inverse of a square matrix (Cholesky when symmetric positive-definite, LU otherwise); null if singular. */
M.inv = function (A) {
  const L = M.cholesky(A); if (L) return M.cholInv(L);
  const dec = M.lu(A); if (!dec) return null;
  const n = A.length, inv = M.zeros(n, n);
  for (let j = 0; j < n; j++) { const e = new Float64Array(n); e[j] = 1; const col = M.luSolve(dec, e); for (let i = 0; i < n; i++) inv[i][j] = col[i]; }
  return inv;
};
M.solve = function (A, b) { const L = M.cholesky(A); if (L) return M.cholSolve(L, b); const dec = M.lu(A); return dec ? M.luSolve(dec, b) : null; };
M.mul = function (A, B) {
  const n = A.length, m = B[0].length, p = B.length, C = M.zeros(n, m);
  for (let i = 0; i < n; i++) for (let k = 0; k < p; k++) { const a = A[i][k]; if (a === 0) continue; const Bk = B[k], Ci = C[i]; for (let j = 0; j < m; j++) Ci[j] += a * Bk[j]; }
  return C;
};
M.mv = (A, x) => A.map(r => { let s = 0; for (let j = 0; j < x.length; j++) s += r[j] * x[j]; return s; });
M.dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
/** Symmetric eigen-decomposition (cyclic Jacobi); returns {values, vectors (columns)}. */
M.eigSym = function (A) {
  const n = A.length, a = M.copy(A), v = M.ident(n);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return {values: a.map((r, i) => r[i]), vectors: v};
};

/* ============================== association tests ============================== */
function pairComplete(x, y) {
  const a = [], b = [];
  for (let i = 0; i < x.length; i++) if (isNum(x[i]) && isNum(y[i])) { a.push(x[i]); b.push(y[i]); }
  return [a, b];
}
/** Pearson correlation with t-test p-value and Fisher-z 95% CI (listwise complete pairs). */
S.pearson = function (x, y, level) {
  level = level || 0.95;
  const [a, b] = pairComplete(x, y), n = a.length;
  if (n < 3) return {r: NaN, n, p: NaN, lo: NaN, hi: NaN};
  const ma = S.mean(a), mb = S.mean(b); let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (saa === 0 || sbb === 0) return {r: NaN, n, p: NaN, lo: NaN, hi: NaN, note: 'zero variance'};
  let r = sab / Math.sqrt(saa * sbb); r = Math.max(-1, Math.min(1, r));
  const df = n - 2, t = Math.abs(r) < 1 ? r * Math.sqrt(df / (1 - r * r)) : Infinity * Math.sign(r);
  const z = Math.atanh(Math.max(-0.9999999999, Math.min(0.9999999999, r))), se = 1 / Math.sqrt(n - 3), q = S.normInv(1 - (1 - level) / 2);
  return {r, n, t, df, p: S.tP2(t, df), lo: n > 3 ? Math.tanh(z - q * se) : NaN, hi: n > 3 ? Math.tanh(z + q * se) : NaN};
};
/** Spearman rank correlation; p-value by the t approximation (as scipy), CI by Fisher z with Bonett-Wright SE. */
S.spearman = function (x, y, level) {
  const [a, b] = pairComplete(x, y);
  const res = S.pearson(S.rank(a), S.rank(b), level);
  if (isFinite(res.r) && res.n > 3) {
    const z = Math.atanh(Math.max(-0.9999999999, Math.min(0.9999999999, res.r))), se = Math.sqrt((1 + res.r * res.r / 2) / (res.n - 3)), q = S.normInv(1 - (1 - (level || 0.95)) / 2);
    res.lo = Math.tanh(z - q * se); res.hi = Math.tanh(z + q * se);
  }
  res.method = 'spearman';
  return res;
};
/** 2 x 2 table from two binary vectors: a = both 1, b = x only, c = y only, d = neither. */
S.table2x2 = function (x, y) {
  let a = 0, b = 0, c = 0, d = 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i] ? 1 : 0, yi = y[i] ? 1 : 0; if (xi && yi) a++; else if (xi) b++; else if (yi) c++; else d++; }
  return {a, b, c, d};
};
/** Odds ratio with Woolf (log) CI; adds 0.5 to every cell if any cell is zero (Haldane-Anscombe). */
S.oddsRatio = function (a, b, c, d, level) {
  const q = S.normInv(1 - (1 - (level || 0.95)) / 2);
  let corr = false;
  if (a === 0 || b === 0 || c === 0 || d === 0) { a += 0.5; b += 0.5; c += 0.5; d += 0.5; corr = true; }
  const lor = Math.log(a * d / (b * c)), se = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
  return {or: Math.exp(lor), logOr: lor, se, lo: Math.exp(lor - q * se), hi: Math.exp(lor + q * se), corrected: corr};
};
S.phi = function (a, b, c, d) {
  const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d));
  return den > 0 ? (a * d - b * c) / den : NaN;
};
/** Fisher's exact test for a 2 x 2 table; two-sided p sums tables no more probable than the observed one (as R). */
S.fisherExact = function (a, b, c, d) {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1);
  const lc = S.logFactorial(r1) + S.logFactorial(r2) + S.logFactorial(c1) + S.logFactorial(n - c1) - S.logFactorial(n);
  const lp = k => lc - S.logFactorial(k) - S.logFactorial(r1 - k) - S.logFactorial(c1 - k) - S.logFactorial(r2 - c1 + k);
  const pObs = Math.exp(lp(a)); let p2 = 0, pl = 0, pg = 0;
  for (let k = lo; k <= hi; k++) {
    const pk = Math.exp(lp(k));
    if (pk <= pObs * (1 + 1e-7)) p2 += pk;
    if (k <= a) pl += pk;
    if (k >= a) pg += pk;
  }
  return {p: Math.min(1, p2), pLess: Math.min(1, pl), pGreater: Math.min(1, pg)};
};
/** Pearson chi-square test of independence for an r x c table of counts; Cramer's V. */
S.chiSquare = function (table) {
  const r = table.length, c = table[0].length;
  const rs = table.map(row => S.sum(row)), cs = Array.from({length: c}, (_, j) => S.sum(table.map(row => row[j]))), n = S.sum(rs);
  let chi2 = 0, minE = Infinity, nLow = 0; const E = M.zeros(r, c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    const e = rs[i] * cs[j] / n; E[i][j] = e;
    if (e > 0) chi2 += (table[i][j] - e) * (table[i][j] - e) / e;
    if (e < minE) minE = e; if (e < 5) nLow++;
  }
  const df = (r - 1) * (c - 1), k = Math.min(r, c);
  return {chi2, df, p: S.chi2Sf(chi2, df), cramersV: Math.sqrt(chi2 / (n * (k - 1))), n, expected: E, minExpected: minE, propLowExpected: nLow / (r * c)};
};
/** Mann-Whitney U (normal approximation with tie and continuity corrections, as scipy method='asymptotic').
    Returns AUC = P(X > Y) + 0.5 P(X = Y) and the rank-biserial correlation 2 AUC - 1. */
S.mannWhitney = function (x, y) {
  const n1 = x.length, n2 = y.length, all = Array.from(x).concat(Array.from(y)), r = S.rank(all);
  let r1 = 0; for (let i = 0; i < n1; i++) r1 += r[i];
  const U1 = r1 - n1 * (n1 + 1) / 2, mu = n1 * n2 / 2, N = n1 + n2;
  let tieSum = 0; for (const t of r.ties) tieSum += t * t * t - t;
  const sigma = Math.sqrt(n1 * n2 / 12 * ((N + 1) - tieSum / (N * (N - 1))));
  const U = Math.max(U1, n1 * n2 - U1), z = sigma > 0 ? (U - mu - 0.5) / sigma : 0;
  const auc = U1 / (n1 * n2);
  return {U: U1, z, p: Math.min(1, 2 * S.normCdf(-z)), auc, rankBiserial: 2 * auc - 1, n1, n2};
};
/** Kruskal-Wallis H test (tie-corrected) with epsilon-squared effect size H / (n - 1). */
S.kruskal = function (groups) {
  const all = [], lab = [];
  groups.forEach((g, k) => { for (const v of g) { all.push(v); lab.push(k); } });
  const N = all.length, r = S.rank(all), Rk = new Float64Array(groups.length);
  for (let i = 0; i < N; i++) Rk[lab[i]] += r[i];
  let H = 0; groups.forEach((g, k) => { if (g.length) H += Rk[k] * Rk[k] / g.length; });
  H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
  let tieSum = 0; for (const t of r.ties) tieSum += t * t * t - t;
  const C = 1 - tieSum / (N * N * N - N); if (C > 0) H /= C;
  const df = groups.filter(g => g.length).length - 1;
  return {H, df, p: S.chi2Sf(H, df), epsilon2: H / (N - 1), n: N};
};
/** Multiple-testing adjustment: 'BH' (Benjamini-Hochberg), 'BY', 'holm', 'bonferroni'. NaN p-values are kept as NaN. */
S.padjust = function (p, method) {
  method = method || 'BH';
  const idx = []; p.forEach((v, i) => { if (isNum(v)) idx.push(i); });
  const m = idx.length, out = p.map(() => NaN); if (!m) return out;
  if (method === 'bonferroni') { idx.forEach(i => { out[i] = Math.min(1, p[i] * m); }); return out; }
  if (method === 'holm') {
    const o = idx.slice().sort((a, b) => p[a] - p[b]); let run = 0;
    o.forEach((i, k) => { run = Math.max(run, Math.min(1, (m - k) * p[i])); out[i] = run; });
    return out;
  }
  const cm = method === 'BY' ? S.sum(Array.from({length: m}, (_, k) => 1 / (k + 1))) : 1;
  const o = idx.slice().sort((a, b) => p[b] - p[a]); let run = 1;
  o.forEach((i, k) => { const rank = m - k; run = Math.min(run, p[i] * m * cm / rank); out[i] = Math.min(1, run); });
  return out;
};

/* ============================== regression ============================== */
const sigmoid = t => t >= 0 ? 1 / (1 + Math.exp(-t)) : Math.exp(t) / (1 + Math.exp(t));
const log1pexp = t => t > 35 ? t : (t < -35 ? Math.exp(t) : Math.log1p(Math.exp(t)));
S.sigmoid = sigmoid;
/** Prepend a column of ones. */
S.addIntercept = X => X.map(r => { const o = new Float64Array(r.length + 1); o[0] = 1; for (let j = 0; j < r.length; j++) o[j + 1] = r[j]; return o; });

/** Cluster-robust sandwich covariance (CR1, as statsmodels with use_correction=True):
    V = c * B * (sum_g s_g s_g') * B, c = G/(G-1) * (N-1)/(N-K). scores: n x p score contributions; bread: inverse Hessian.
    With two cluster vectors, uses Cameron-Gelbach-Miller two-way clustering V1 + V2 - V12. */
function clusterMeat(scores, cl) {
  const p = scores[0].length, sums = new Map();
  for (let i = 0; i < scores.length; i++) { const k = cl[i]; let s = sums.get(k); if (!s) { s = new Float64Array(p); sums.set(k, s); } const si = scores[i]; for (let j = 0; j < p; j++) s[j] += si[j]; }
  const meat = M.zeros(p, p);
  sums.forEach(s => { for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) meat[a][b] += s[a] * s[b]; });
  return {meat, G: sums.size};
}
function sandwich1(scores, bread, cl) {
  const N = scores.length, K = bread.length, {meat, G} = clusterMeat(scores, cl);
  const c = G / (G - 1) * (N - 1) / (N - K);
  const V = M.mul(M.mul(bread, meat), bread);
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) V[i][j] *= c;
  return {V, G};
}
S.robustVcov = function (scores, bread, cl1, cl2) {
  if (!cl2) { const r = sandwich1(scores, bread, cl1); return {V: r.V, G: [r.G], type: 'CR1 one-way'}; }
  const r1 = sandwich1(scores, bread, cl1), r2 = sandwich1(scores, bread, cl2);
  const r12 = sandwich1(scores, bread, cl1.map((g, i) => g + '\u0001' + cl2[i]));
  const K = bread.length, V = M.zeros(K, K);
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) V[i][j] = r1.V[i][j] + r2.V[i][j] - r12.V[i][j];
  return {V, G: [r1.G, r2.G], type: 'two-way (Cameron, Gelbach & Miller, 2011)'};
};
function waldTable(coef, V, names, level, df) {
  const q = df ? S.tInv(1 - (1 - level) / 2, df) : S.normInv(1 - (1 - level) / 2);
  return coef.map((b, j) => {
    const se = Math.sqrt(Math.max(0, V[j][j])), st = b / se;
    return {term: names ? names[j] : 'x' + j, est: b, se, stat: st, p: df ? S.tP2(st, df) : S.normP2(st), lo: b - q * se, hi: b + q * se};
  });
}

/** Binary logistic regression by Newton-Raphson (IRLS).
    X: n x p design matrix (include an intercept column yourself, e.g. via S.addIntercept); y: 0/1.
    opt: {weights, ridge (L2 penalty, not applied to column 0 when intercept=true), firth (Jeffreys-prior bias reduction,
    Heinze & Schemper 2002), cluster, cluster2 (cluster-robust SEs), names, level, maxIter, tol, intercept (default true)}.
    Returns coefficients with model-based SEs, robust SEs when clusters are given, odds ratios, fit statistics,
    and flags for non-convergence or (quasi-)separation. */
S.logit = function (X, y, opt) {
  opt = opt || {};
  const n = X.length, p = X[0].length, w = opt.weights || null, ridge = opt.ridge || 0, firth = !!opt.firth;
  const level = opt.level || 0.95, maxIter = opt.maxIter || 100, tol = opt.tol || 1e-10, icpt = opt.intercept !== false;
  const pen = j => (ridge && !(icpt && j === 0)) ? ridge : 0;
  let beta = new Float64Array(p);
  if (icpt) { let sw = 0, sy = 0; for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; sw += wi; sy += wi * y[i]; } const m = Math.min(Math.max(sy / sw, 1e-6), 1 - 1e-6); beta[0] = Math.log(m / (1 - m)); }
  const eta = new Float64Array(n), mu = new Float64Array(n);
  function state(b) {
    let ll = 0;
    for (let i = 0; i < n; i++) { let e = 0; const xi = X[i]; for (let j = 0; j < p; j++) e += xi[j] * b[j]; eta[i] = e; mu[i] = sigmoid(e); const wi = w ? w[i] : 1; ll += wi * (y[i] * e - log1pexp(e)); }
    let pll = ll; for (let j = 0; j < p; j++) pll -= 0.5 * pen(j) * b[j] * b[j];
    return {ll, pll};
  }
  function info() {
    const H = M.zeros(p, p);
    for (let i = 0; i < n; i++) { const wi = (w ? w[i] : 1) * mu[i] * (1 - mu[i]); if (wi === 0) continue; const xi = X[i]; for (let a = 0; a < p; a++) { const xa = xi[a] * wi; if (xa === 0) continue; const Ha = H[a]; for (let b2 = 0; b2 <= a; b2++) Ha[b2] += xa * xi[b2]; } }
    for (let a = 0; a < p; a++) { for (let b2 = 0; b2 < a; b2++) H[b2][a] = H[a][b2]; H[a][a] += pen(a); }
    return H;
  }
  function firthTerms(H) { // hat diagonal and penalized objective
    const L = M.cholesky(H); if (!L) return null;
    const Hinv = M.cholInv(L), h = new Float64Array(n);
    for (let i = 0; i < n; i++) { const xi = X[i], v = M.mv(Hinv, xi); h[i] = (w ? w[i] : 1) * mu[i] * (1 - mu[i]) * M.dot(xi, v); }
    return {h, logdet: M.logdetChol(L)};
  }
  let st = state(beta), conv = false, iter = 0, obj;
  const objective = (s, H) => { if (!firth) return s.pll; const f = firthTerms(H || info()); return f ? s.pll + 0.5 * f.logdet : -Infinity; };
  obj = objective(st);
  for (iter = 1; iter <= maxIter; iter++) {
    const H = info(), g = new Float64Array(p);
    let fh = null; if (firth) fh = firthTerms(H);
    for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; let r = y[i] - mu[i]; if (fh) r += fh.h[i] * (0.5 - mu[i]); r *= wi; if (r === 0) continue; const xi = X[i]; for (let j = 0; j < p; j++) g[j] += xi[j] * r; }
    for (let j = 0; j < p; j++) g[j] -= pen(j) * beta[j];
    const step = M.solve(H, g); if (!step) break;
    let t = 1, nb, ns, nobj;
    for (let half = 0; half < 30; half++) {
      nb = beta.map((b, j) => b + t * step[j]); ns = state(nb); nobj = objective(ns);
      if (nobj >= obj - 1e-12 || !isFinite(obj)) break; t /= 2;
    }
    const change = Math.max(...step.map(Math.abs)) * t;
    beta = nb; st = ns; const dObj = Math.abs(nobj - obj); obj = nobj;
    if (change < tol || dObj < tol * (Math.abs(obj) + tol)) { conv = true; break; }
  }
  st = state(beta);
  const H = info(), Vm = M.inv(H) || M.zeros(p, p), names = opt.names || Array.from({length: p}, (_, j) => j === 0 && icpt ? '(Intercept)' : 'x' + j);
  const coefs = waldTable(Array.from(beta), Vm, names, level);
  const res = {method: firth ? 'Firth logistic regression' : (ridge ? 'ridge logistic regression' : 'logistic regression'), coef: Array.from(beta), names, table: coefs, vcov: Vm,
    logLik: st.ll, n, k: p, converged: conv, iter, fitted: Array.from(mu), eta: Array.from(eta)};
  res.table.forEach(r => { r.or = Math.exp(r.est); r.orLo = Math.exp(r.lo); r.orHi = Math.exp(r.hi); });
  let sw = 0, sy = 0; for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; sw += wi; sy += wi * y[i]; }
  const pbar = sy / sw; let ll0 = 0; for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; ll0 += wi * (y[i] ? Math.log(pbar) : Math.log(1 - pbar)); }
  res.nullLogLik = ll0; res.deviance = -2 * st.ll; res.aic = -2 * st.ll + 2 * p; res.bic = -2 * st.ll + p * Math.log(n);
  res.mcfaddenR2 = icpt ? 1 - st.ll / ll0 : NaN;
  const maxAbs = Math.max(...beta.map(Math.abs)); let extreme = 0; for (let i = 0; i < n; i++) if (mu[i] < 1e-8 || mu[i] > 1 - 1e-8) extreme++;
  res.separation = !firth && !ridge && (maxAbs > 15 || extreme > 0.05 * n) ? 'possible (quasi-)complete separation: estimates and SEs are unreliable; use Firth or ridge' : null;
  if (opt.cluster) {
    const scores = X.map((xi, i) => { const r = (w ? w[i] : 1) * (y[i] - mu[i]); return Float64Array.from(xi, v => v * r); });
    const rv = S.robustVcov(scores, Vm, opt.cluster, opt.cluster2);
    res.robust = {type: rv.type, G: rv.G, vcov: rv.V, table: waldTable(Array.from(beta), rv.V, names, level)};
    res.robust.table.forEach(r => { r.or = Math.exp(r.est); r.orLo = Math.exp(r.lo); r.orHi = Math.exp(r.hi); });
    if (Math.min(...rv.G) < 30) res.robust.warning = 'Fewer than 30 clusters: cluster-robust SEs may be too small.';
  }
  return res;
};
S.predictLogit = (coef, X) => X.map(xi => sigmoid(M.dot(xi, coef)));

/** Multinomial logistic regression (baseline-category logits) by Newton-Raphson.
    y: integer class indices 0..K-1; ref: reference class (default 0). opt as for S.logit (weights, ridge, cluster, names, level).
    Returns coefficient tables per non-reference class, relative risk ratios, fit statistics and predict(X). */
S.mlogit = function (X, y, K, opt) {
  opt = opt || {};
  const n = X.length, p = X[0].length, ref = opt.ref || 0, w = opt.weights || null, ridge = opt.ridge || 0, icpt = opt.intercept !== false;
  const level = opt.level || 0.95, maxIter = opt.maxIter || 100, tol = opt.tol || 1e-10;
  const cls = Array.from({length: K}, (_, k) => k).filter(k => k !== ref), Km = cls.length, P = Km * p;
  const pen = j => (ridge && !(icpt && j === 0)) ? ridge : 0;
  let B = new Float64Array(P); // block layout: class block c (0..Km-1), predictor j
  const prob = M.zeros(n, K);
  function state(b) {
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i], e = new Float64Array(K);
      let mx = 0; for (let c = 0; c < Km; c++) { let s = 0; for (let j = 0; j < p; j++) s += xi[j] * b[c * p + j]; e[cls[c]] = s; if (s > mx) mx = s; }
      let den = 0; for (let k = 0; k < K; k++) den += Math.exp(e[k] - mx);
      for (let k = 0; k < K; k++) prob[i][k] = Math.exp(e[k] - mx) / den;
      ll += (w ? w[i] : 1) * (e[y[i]] - mx - Math.log(den));
    }
    let pll = ll; for (let c = 0; c < Km; c++) for (let j = 0; j < p; j++) pll -= 0.5 * pen(j) * b[c * p + j] * b[c * p + j];
    return {ll, pll};
  }
  function hess() {
    const H = M.zeros(P, P);
    for (let i = 0; i < n; i++) {
      const xi = X[i], wi = w ? w[i] : 1, pi = prob[i];
      for (let c = 0; c < Km; c++) for (let d = 0; d <= c; d++) {
        const f = wi * pi[cls[c]] * ((c === d ? 1 : 0) - pi[cls[d]]); if (f === 0) continue;
        for (let a = 0; a < p; a++) { const xa = xi[a] * f; if (xa === 0) continue; const row = H[c * p + a]; for (let b2 = 0; b2 < p; b2++) row[d * p + b2] += xa * xi[b2]; }
      }
    }
    for (let r = 0; r < P; r++) for (let s = 0; s < r; s++) { const v = H[r][s] || H[s][r]; H[r][s] = v; H[s][r] = v; }
    // symmetric fill: blocks (c,d) with d<c were computed; mirror them
    for (let c = 0; c < Km; c++) for (let d = 0; d < c; d++) for (let a = 0; a < p; a++) for (let b2 = 0; b2 < p; b2++) H[d * p + b2][c * p + a] = H[c * p + a][d * p + b2];
    for (let c = 0; c < Km; c++) for (let j = 0; j < p; j++) H[c * p + j][c * p + j] += pen(j);
    return H;
  }
  let st = state(B), conv = false, iter = 0;
  for (iter = 1; iter <= maxIter; iter++) {
    const H = hess(), g = new Float64Array(P);
    for (let i = 0; i < n; i++) { const xi = X[i], wi = w ? w[i] : 1; for (let c = 0; c < Km; c++) { const r = wi * ((y[i] === cls[c] ? 1 : 0) - prob[i][cls[c]]); if (r === 0) continue; for (let j = 0; j < p; j++) g[c * p + j] += xi[j] * r; } }
    for (let c = 0; c < Km; c++) for (let j = 0; j < p; j++) g[c * p + j] -= pen(j) * B[c * p + j];
    const step = M.solve(H, g); if (!step) break;
    let t = 1, nb, ns;
    for (let half = 0; half < 30; half++) { nb = B.map((b, j) => b + t * step[j]); ns = state(nb); if (ns.pll >= st.pll - 1e-12) break; t /= 2; }
    const change = Math.max(...step.map(Math.abs)) * t, dl = Math.abs(ns.pll - st.pll);
    B = nb; st = ns;
    if (change < tol || dl < tol * (Math.abs(st.pll) + tol)) { conv = true; break; }
  }
  st = state(B);
  const H = hess(), V = M.inv(H) || M.zeros(P, P);
  const names = opt.names || Array.from({length: p}, (_, j) => j === 0 && icpt ? '(Intercept)' : 'x' + j);
  const classNames = opt.classNames || Array.from({length: K}, (_, k) => 'class ' + k);
  const tables = cls.map((k, c) => {
    const coef = Array.from(B.slice(c * p, (c + 1) * p)), Vc = Array.from({length: p}, (_, a) => Float64Array.from({length: p}, (_, b2) => V[c * p + a][c * p + b2]));
    const t = waldTable(coef, Vc, names, level); t.forEach(r => { r.rrr = Math.exp(r.est); r.rrrLo = Math.exp(r.lo); r.rrrHi = Math.exp(r.hi); });
    return {cls: classNames[k], table: t};
  });
  const res = {method: ridge ? 'ridge multinomial logistic regression' : 'multinomial logistic regression', ref: classNames[ref], K, coefVector: Array.from(B), tables, vcov: V,
    logLik: st.ll, n, k: P, converged: conv, iter, aic: -2 * st.ll + 2 * P, bic: -2 * st.ll + P * Math.log(n), prob: prob.map(r => Array.from(r))};
  const counts = new Float64Array(K); let sw = 0; for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; counts[y[i]] += wi; sw += wi; }
  let ll0 = 0; for (let i = 0; i < n; i++) ll0 += (w ? w[i] : 1) * Math.log(counts[y[i]] / sw);
  res.nullLogLik = ll0; res.mcfaddenR2 = 1 - st.ll / ll0;
  if (opt.cluster) {
    const scores = X.map((xi, i) => { const s = new Float64Array(P), wi = w ? w[i] : 1; for (let c = 0; c < Km; c++) { const r = wi * ((y[i] === cls[c] ? 1 : 0) - prob[i][cls[c]]); for (let j = 0; j < p; j++) s[c * p + j] = xi[j] * r; } return s; });
    const rv = S.robustVcov(scores, V, opt.cluster, opt.cluster2);
    res.robust = {type: rv.type, G: rv.G, tables: cls.map((k, c) => {
      const coef = Array.from(B.slice(c * p, (c + 1) * p)), Vc = Array.from({length: p}, (_, a) => Float64Array.from({length: p}, (_, b2) => rv.V[c * p + a][c * p + b2]));
      const t = waldTable(coef, Vc, names, level); t.forEach(r => { r.rrr = Math.exp(r.est); r.rrrLo = Math.exp(r.lo); r.rrrHi = Math.exp(r.hi); });
      return {cls: classNames[k], table: t};
    })};
    if (Math.min(...rv.G) < 30) res.robust.warning = 'Fewer than 30 clusters: cluster-robust SEs may be too small.';
  }
  res.predict = Xn => Xn.map(xi => {
    const e = new Float64Array(K); let mx = 0;
    for (let c = 0; c < Km; c++) { let s = 0; for (let j = 0; j < p; j++) s += xi[j] * B[c * p + j]; e[cls[c]] = s; if (s > mx) mx = s; }
    let den = 0; for (let k = 0; k < K; k++) den += Math.exp(e[k] - mx);
    return Array.from(e, v => Math.exp(v - mx) / den);
  });
  return res;
};

/** Ordinary least squares with classical, HC1 and cluster-robust (CR1) standard errors. */
S.ols = function (X, y, opt) {
  opt = opt || {};
  const n = X.length, p = X[0].length, level = opt.level || 0.95;
  const XtX = M.zeros(p, p), Xty = new Float64Array(p);
  for (let i = 0; i < n; i++) { const xi = X[i]; for (let a = 0; a < p; a++) { Xty[a] += xi[a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += xi[a] * xi[b]; } }
  const inv = M.inv(XtX); if (!inv) return {error: 'singular design matrix'};
  const beta = M.mv(inv, Xty), res = new Float64Array(n); let rss = 0, my = S.mean(y), tss = 0;
  for (let i = 0; i < n; i++) { res[i] = y[i] - M.dot(X[i], beta); rss += res[i] * res[i]; tss += (y[i] - my) * (y[i] - my); }
  const df = n - p, s2 = rss / df, V = inv.map(r => r.map(v => v * s2));
  const names = opt.names || Array.from({length: p}, (_, j) => j === 0 ? '(Intercept)' : 'x' + j);
  const out = {method: 'ordinary least squares', coef: Array.from(beta), names, table: waldTable(Array.from(beta), V, names, level, df), sigma: Math.sqrt(s2), df,
    r2: 1 - rss / tss, adjR2: 1 - (rss / df) / (tss / (n - 1)), n, k: p, residuals: Array.from(res)};
  const scores = X.map((xi, i) => Float64Array.from(xi, v => v * res[i]));
  if (opt.cluster) {
    const rv = S.robustVcov(scores, inv, opt.cluster, opt.cluster2);
    out.robust = {type: rv.type, G: rv.G, table: waldTable(Array.from(beta), rv.V, names, level, Math.min(...rv.G) - 1)};
  } else {
    const meat = M.zeros(p, p); scores.forEach(s => { for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) meat[a][b] += s[a] * s[b]; });
    const Vh = M.mul(M.mul(inv, meat), inv).map(r => r.map(v => v * n / (n - p)));
    out.robust = {type: 'HC1', table: waldTable(Array.from(beta), Vh, names, level, df)};
  }
  return out;
};

/* ============================== mixed models ============================== */
function groupIndex(groups) {
  const map = new Map(), idx = [];
  groups.forEach((g, i) => { let a = map.get(g); if (!a) { a = []; map.set(g, a); idx.push(a); } a.push(i); });
  return {map, idx};
}
/** Linear mixed model with a random intercept for one grouping factor, fitted by REML (or ML).
    y = X b + u_g + e, u_g ~ N(0, tau2), e ~ N(0, sigma2). Variance ratio profiled by Brent's method on log scale.
    Fixed-effect tests use t statistics with df = N - p (a liberal approximation; Kenward-Roger is not implemented). */
S.lmm = function (X, y, groups, opt) {
  opt = opt || {};
  const reml = opt.reml !== false, n = X.length, p = X[0].length, level = opt.level || 0.95;
  const {idx} = groupIndex(groups), G = idx.length;
  function fit(lam) {
    const A = M.zeros(p, p), b = new Float64Array(p); let logdetV = 0;
    for (const g of idx) {
      const ng = g.length, c = lam / (1 + ng * lam); logdetV += Math.log(1 + ng * lam);
      const sx = new Float64Array(p); let sy = 0;
      for (const i of g) { const xi = X[i]; sy += y[i]; for (let a = 0; a < p; a++) { sx[a] += xi[a]; b[a] += xi[a] * y[i]; for (let k = 0; k < p; k++) A[a][k] += xi[a] * xi[k]; } }
      for (let a = 0; a < p; a++) { b[a] -= c * sx[a] * sy; for (let k = 0; k < p; k++) A[a][k] -= c * sx[a] * sx[k]; }
    }
    const L = M.cholesky(A); if (!L) return null;
    const beta = M.cholSolve(L, b); let rss = 0;
    for (const g of idx) {
      const ng = g.length, c = lam / (1 + ng * lam); let sr = 0, ss = 0;
      for (const i of g) { const r = y[i] - M.dot(X[i], beta); sr += r; ss += r * r; }
      rss += ss - c * sr * sr;
    }
    const dfr = reml ? n - p : n, s2 = rss / dfr;
    const ll = reml ? -0.5 * ((n - p) * (LN2PI + Math.log(s2) + 1) + logdetV + M.logdetChol(L))
      : -0.5 * (n * (LN2PI + Math.log(s2) + 1) + logdetV);
    return {beta, s2, ll, L};
  }
  // Brent maximization over t = log(lambda) in [-15, 10]; compare with the boundary lambda = 0
  const f = t => { const r = fit(Math.exp(t)); return r ? -r.ll : Infinity; };
  let a = -15, b = 10; const gr = (3 - Math.sqrt(5)) / 2;
  let x = a + gr * (b - a), wv = x, v = x, fx = f(x), fw = fx, fv = fx, d = 0, e = 0;
  for (let it = 0; it < 200; it++) {
    const xm = 0.5 * (a + b), tol1 = 1e-9 * Math.abs(x) + 1e-10, tol2 = 2 * tol1;
    if (Math.abs(x - xm) <= tol2 - 0.5 * (b - a)) break;
    let useGolden = true;
    if (Math.abs(e) > tol1) {
      let r = (x - wv) * (fx - fv), q = (x - v) * (fx - fw), pp = (x - v) * q - (x - wv) * r; q = 2 * (q - r); if (q > 0) pp = -pp; q = Math.abs(q);
      const etemp = e; e = d;
      if (!(Math.abs(pp) >= Math.abs(0.5 * q * etemp) || pp <= q * (a - x) || pp >= q * (b - x))) { d = pp / q; const u = x + d; if (u - a < tol2 || b - u < tol2) d = xm - x >= 0 ? tol1 : -tol1; useGolden = false; }
    }
    if (useGolden) { e = (x >= xm ? a : b) - x; d = gr * e; }
    const u = Math.abs(d) >= tol1 ? x + d : x + (d >= 0 ? tol1 : -tol1), fu = f(u);
    if (fu <= fx) { if (u >= x) a = x; else b = x; v = wv; fv = fw; wv = x; fw = fx; x = u; fx = fu; }
    else { if (u < x) a = u; else b = u; if (fu <= fw || wv === x) { v = wv; fv = fw; wv = u; fw = fu; } else if (fu <= fv || v === x || v === wv) { v = u; fv = fu; } }
  }
  let lam = Math.exp(x), best = fit(lam);
  const zero = fit(0); if (zero && (!best || zero.ll > best.ll)) { best = zero; lam = 0; }
  const V = M.cholInv(best.L).map(r => r.map(v2 => v2 * best.s2));
  const names = opt.names || Array.from({length: p}, (_, j) => j === 0 ? '(Intercept)' : 'x' + j);
  const tau2 = lam * best.s2;
  return {method: (reml ? 'REML' : 'ML') + ' linear mixed model, random intercept', coef: Array.from(best.beta), names, table: waldTable(Array.from(best.beta), V, names, level, n - p),
    sigma2: best.s2, tau2, icc: tau2 / (tau2 + best.s2), logLik: best.ll, nGroups: G, n, boundary: lam === 0,
    note: 'Fixed-effect t tests use df = N - p; with few groups or group-level predictors, prefer Kenward-Roger or Satterthwaite tests (exported R code).'};
};
/** Gauss-Hermite nodes and weights for integrals of exp(-x^2) f(x) (Golub-Welsch-free Newton iteration, Numerical Recipes gauher). */
S.gaussHermite = function (n) {
  const EPS = 3e-14, PIM4 = 0.7511255444649425, x = new Float64Array(n), w = new Float64Array(n), m = Math.floor((n + 1) / 2);
  let z = 0, z1, p1, p2, p3, pp = 0;
  for (let i = 0; i < m; i++) {
    if (i === 0) z = Math.sqrt(2 * n + 1) - 1.85575 * Math.pow(2 * n + 1, -0.16667);
    else if (i === 1) z -= 1.14 * Math.pow(n, 0.426) / z;
    else if (i === 2) z = 1.86 * z - 0.86 * x[0];
    else if (i === 3) z = 1.91 * z - 0.91 * x[1];
    else z = 2 * z - x[i - 2];
    for (let its = 0; its < 100; its++) {
      p1 = PIM4; p2 = 0;
      for (let j = 0; j < n; j++) { p3 = p2; p2 = p1; p1 = z * Math.sqrt(2 / (j + 1)) * p2 - Math.sqrt(j / (j + 1)) * p3; }
      pp = Math.sqrt(2 * n) * p2; z1 = z; z = z1 - p1 / pp;
      if (Math.abs(z - z1) <= EPS) break;
    }
    x[i] = z; x[n - 1 - i] = -z; w[i] = 2 / (pp * pp); w[n - 1 - i] = w[i];
  }
  return {x, w};
};
/** Minimize f by BFGS with numerical gradients and backtracking line search. */
S.bfgs = function (f, x0, opt) {
  opt = opt || {};
  const n = x0.length, h = opt.h || 1e-5, maxIter = opt.maxIter || 300, gtol = opt.gtol || 1e-6;
  const grad = x => { const g = new Float64Array(n); for (let j = 0; j < n; j++) { const xp = Float64Array.from(x), xm = Float64Array.from(x); xp[j] += h; xm[j] -= h; g[j] = (f(xp) - f(xm)) / (2 * h); } return g; };
  let x = Float64Array.from(x0), fx = f(x), g = grad(x), Hi = M.ident(n), conv = false, it = 0;
  for (it = 0; it < maxIter; it++) {
    if (Math.max(...g.map(Math.abs)) < gtol) { conv = true; break; }
    let d = M.mv(Hi, g).map(v => -v); if (M.dot(d, g) >= 0) { Hi = M.ident(n); d = g.map(v => -v); }
    let t = 1, xn, fn;
    for (let k = 0; k < 40; k++) { xn = x.map((v, j) => v + t * d[j]); fn = f(xn); if (fn <= fx + 1e-4 * t * M.dot(g, d)) break; t /= 2; }
    if (!(fn <= fx)) { conv = Math.max(...g.map(Math.abs)) < 1e-3; break; }
    const gn = grad(xn), s = xn.map((v, j) => v - x[j]), yv = gn.map((v, j) => v - g[j]), sy = M.dot(s, yv);
    if (sy > 1e-12) {
      const Hy = M.mv(Hi, yv), yHy = M.dot(yv, Hy);
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) Hi[a][b] += ((sy + yHy) * s[a] * s[b]) / (sy * sy) - (Hy[a] * s[b] + s[a] * Hy[b]) / sy;
    }
    const df = Math.abs(fx - fn); x = xn; fx = fn; g = gn;
    if (df < 1e-12 * (Math.abs(fx) + 1e-12)) { conv = Math.max(...g.map(Math.abs)) < 1e-3; break; }
  }
  return {x, fx, converged: conv, iter: it};
};
S.numHessian = function (f, x, h) {
  h = h || 1e-4; const n = x.length, H = M.zeros(n, n), f0 = f(x);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const e = (a, b) => { const z = Float64Array.from(x); z[i] += a; z[j] += b; return f(z); };
    let v;
    if (i === j) v = (e(h, 0) - 2 * f0 + e(-h, 0)) / (h * h);
    else v = (e(h, h) - e(h, -h) - e(-h, h) + e(-h, -h)) / (4 * h * h);
    H[i][j] = v; H[j][i] = v;
  }
  return H;
};
/** Logistic mixed model with a random intercept for one grouping factor (marginal maximum likelihood,
    adaptive Gauss-Hermite quadrature with nAGQ nodes; nAGQ = 1 is the Laplace approximation as in lme4's default).
    Parameters (b, log sigma) by BFGS; SEs from the numerical Hessian. */
S.glmmLogit = function (X, y, groups, opt) {
  opt = opt || {};
  const nAGQ = opt.nAGQ || 7, level = opt.level || 0.95, n = X.length, p = X[0].length;
  const {idx} = groupIndex(groups), G = idx.length, gh = S.gaussHermite(nAGQ);
  const eta = new Float64Array(n);
  function negll(theta) {
    const beta = theta.subarray ? theta.subarray(0, p) : theta.slice(0, p), sig = Math.exp(theta[p]);
    for (let i = 0; i < n; i++) eta[i] = M.dot(X[i], beta);
    let ll = 0;
    for (const g of idx) {
      // mode of h(z) = sum_i [y_i (eta_i + sig z) - log(1 + exp(eta_i + sig z))] - z^2 / 2
      let z = 0, hz = 0;
      for (let it = 0; it < 50; it++) {
        let gr = -z; hz = -1;
        for (const i of g) { const m = sigmoid(eta[i] + sig * z); gr += sig * (y[i] - m); hz -= sig * sig * m * (1 - m); }
        const step = gr / hz; z -= step; if (Math.abs(step) < 1e-10) break;
      }
      const s = 1 / Math.sqrt(-hz), terms = [];
      for (let k = 0; k < nAGQ; k++) {
        const zk = z + Math.SQRT2 * s * gh.x[k]; let h = -zk * zk / 2;
        for (const i of g) { const e = eta[i] + sig * zk; h += y[i] * e - log1pexp(e); }
        terms.push(Math.log(gh.w[k]) + h + gh.x[k] * gh.x[k]);
      }
      const mx = Math.max(...terms); let se = 0; for (const t of terms) se += Math.exp(t - mx);
      ll += mx + Math.log(se) + Math.log(Math.SQRT2 * s) - 0.5 * LN2PI;
    }
    return -ll;
  }
  const start = S.logit(X, y, {intercept: opt.intercept !== false});
  const x0 = new Float64Array(p + 1); start.coef.forEach((b, j) => { x0[j] = b; }); x0[p] = Math.log(opt.sigmaStart || 0.5);
  const opt1 = S.bfgs(negll, x0, {maxIter: 500});
  const H = S.numHessian(negll, opt1.x), V = M.inv(H) || M.zeros(p + 1, p + 1);
  const names = opt.names || Array.from({length: p}, (_, j) => j === 0 ? '(Intercept)' : 'x' + j);
  const coef = Array.from(opt1.x.slice(0, p)), Vb = Array.from({length: p}, (_, a) => Float64Array.from({length: p}, (_, b) => V[a][b]));
  const table = waldTable(coef, Vb, names, level); table.forEach(r => { r.or = Math.exp(r.est); r.orLo = Math.exp(r.lo); r.orHi = Math.exp(r.hi); });
  const sigma = Math.exp(opt1.x[p]), seLogSig = Math.sqrt(Math.max(0, V[p][p]));
  return {method: 'logistic mixed model, random intercept (adaptive Gauss-Hermite, nAGQ = ' + nAGQ + ')', coef, names, table,
    sigma, sigmaCI: [sigma * Math.exp(-1.959964 * seLogSig), sigma * Math.exp(1.959964 * seLogSig)],
    iccLatent: sigma * sigma / (sigma * sigma + Math.PI * Math.PI / 3), logLik: -opt1.fx, aic: 2 * opt1.fx + 2 * (p + 1), bic: 2 * opt1.fx + (p + 1) * Math.log(n),
    nGroups: G, n, converged: opt1.converged, iter: opt1.iter, boundary: sigma < 1e-3,
    note: 'Wald tests; the variance estimate is near its boundary when sigma is close to 0.'};
};
/** One-way ICC(1) from ANOVA (unbalanced groups use the n0 adjustment) and the design effect 1 + (m - 1) ICC. */
S.icc1 = function (y, groups) {
  const {idx} = groupIndex(groups), G = idx.length, N = y.length, gm = S.mean(y);
  let ssb = 0, ssw = 0, sn2 = 0;
  for (const g of idx) { const vals = g.map(i => y[i]), m = S.mean(vals); ssb += g.length * (m - gm) * (m - gm); for (const v of vals) ssw += (v - m) * (v - m); sn2 += g.length * g.length; }
  const msb = ssb / (G - 1), msw = ssw / (N - G), n0 = (N - sn2 / N) / (G - 1);
  const icc = (msb - msw) / (msb + (n0 - 1) * msw), mbar = N / G;
  return {icc, groups: G, meanSize: mbar, designEffect: 1 + (mbar - 1) * Math.max(0, icc)};
};

/* ============================== classification and validation ============================== */
/** Group K-fold (as scikit-learn GroupKFold: groups sorted by size, each assigned to the currently smallest fold).
    Returns an array giving the test fold of each observation. No group appears in more than one fold. */
S.groupKFold = function (groups, k) {
  const {map} = groupIndex(groups), entries = Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length || (String(a[0]) < String(b[0]) ? -1 : 1));
  if (entries.length < k) k = entries.length;
  const sizes = new Float64Array(k), fold = new Int32Array(groups.length);
  for (const [, ids] of entries) { let f = 0; for (let j = 1; j < k; j++) if (sizes[j] < sizes[f]) f = j; sizes[f] += ids.length; for (const i of ids) fold[i] = f; }
  fold.k = k; return fold;
};
/** Stratified K-fold without groups (seeded shuffle within class). */
S.stratifiedKFold = function (y, k, seed) {
  const rnd = S.rng(seed || 1), byClass = new Map(); y.forEach((c, i) => { if (!byClass.has(c)) byClass.set(c, []); byClass.get(c).push(i); });
  const fold = new Int32Array(y.length); let off = 0;
  byClass.forEach(ids => { S.shuffle(ids, rnd).forEach((i, j) => { fold[i] = (j + off) % k; }); off += ids.length; });
  fold.k = k; return fold;
};
/** Classification metrics. yTrue, yPred: class indices; prob: n x K probabilities (optional). */
S.metrics = function (yTrue, yPred, K, prob) {
  const C = M.zeros(K, K); for (let i = 0; i < yTrue.length; i++) C[yTrue[i]][yPred[i]]++;
  const per = [], n = yTrue.length; let correct = 0;
  for (let k = 0; k < K; k++) {
    correct += C[k][k];
    const sup = S.sum(C[k]), predK = S.sum(C.map(r => r[k])), rec = sup ? C[k][k] / sup : NaN, prec = predK ? C[k][k] / predK : NaN;
    per.push({support: sup, recall: rec, precision: prec, f1: (rec + prec) > 0 ? 2 * rec * prec / (rec + prec) : (sup ? 0 : NaN)});
  }
  const present = per.filter(r => r.support > 0);
  const out = {n, confusion: C.map(r => Array.from(r)), accuracy: correct / n, balancedAccuracy: S.mean(present.map(r => r.recall)),
    macroF1: S.mean(present.map(r => isNaN(r.f1) ? 0 : r.f1)), perClass: per};
  if (prob) {
    let ll = 0, br = 0;
    for (let i = 0; i < n; i++) { ll -= Math.log(Math.min(1 - 1e-15, Math.max(1e-15, prob[i][yTrue[i]]))); for (let k = 0; k < K; k++) { const t = (yTrue[i] === k ? 1 : 0) - prob[i][k]; br += t * t; } }
    out.logLoss = ll / n; out.brier = br / n;
    const aucs = [];
    for (let k = 0; k < K; k++) {
      const pos = [], neg = []; for (let i = 0; i < n; i++) (yTrue[i] === k ? pos : neg).push(prob[i][k]);
      if (pos.length && neg.length) aucs.push(S.mannWhitney(pos, neg).auc);
      if (K === 2) break;
    }
    out.auc = K === 2 ? aucs[0] : S.mean(aucs); out.aucNote = K === 2 ? 'binary AUC' : 'macro one-vs-rest AUC';
  }
  return out;
};
/** Cross-validated classification. spec: {X (n x p, no intercept), y (class indices), K, folds (from groupKFold or stratifiedKFold),
    model: 'logit'|'mlogit'|'majority', classWeight: 'balanced'|null, ridge, firth}. Features are standardized within each
    training fold (test folds use training means and SDs) to avoid leakage. Returns pooled out-of-fold predictions and metrics. */
S.crossValidate = function (spec) {
  const {X, y, K, folds} = spec, n = y.length, k = folds.k || (Math.max(...folds) + 1), p = X[0] ? X[0].length : 0;
  const prob = Array.from({length: n}, () => new Float64Array(K)), perFold = [], warnings = [];
  for (let f = 0; f < k; f++) {
    const tr = [], te = []; for (let i = 0; i < n; i++) (folds[i] === f ? te : tr).push(i);
    if (!te.length || !tr.length) continue;
    const trainClasses = new Set(tr.map(i => y[i]));
    if (trainClasses.size < K) warnings.push('Fold ' + (f + 1) + ': training data lack ' + (K - trainClasses.size) + ' class(es).');
    // standardize with training statistics
    const mu = new Float64Array(p), sd = new Float64Array(p);
    for (let j = 0; j < p; j++) { const col = tr.map(i => X[i][j]); mu[j] = S.mean(col); sd[j] = S.sd(col) || 1; }
    const tx = i => { const r = new Float64Array(p + 1); r[0] = 1; for (let j = 0; j < p; j++) r[j + 1] = (X[i][j] - mu[j]) / sd[j]; return r; };
    const Xtr = tr.map(tx), Xte = te.map(tx), ytr = tr.map(i => y[i]);
    let w = null;
    if (spec.classWeight === 'balanced') { const cnt = new Float64Array(K); ytr.forEach(c => cnt[c]++); w = ytr.map(c => tr.length / (trainClasses.size * cnt[c])); }
    let P;
    if (spec.model === 'majority' || p === 0) {
      const cnt = new Float64Array(K); ytr.forEach((c, i) => { cnt[c] += w ? w[i] : 1; }); const tot = S.sum(cnt);
      P = te.map(() => Array.from(cnt, v => (v + 1e-9) / (tot + K * 1e-9)));
    } else if (K === 2 && spec.model !== 'mlogit') {
      const fit = S.logit(Xtr, ytr, {weights: w, ridge: spec.ridge, firth: spec.firth});
      if (!fit.converged) warnings.push('Fold ' + (f + 1) + ': model did not converge.');
      if (fit.separation) warnings.push('Fold ' + (f + 1) + ': ' + fit.separation);
      P = S.predictLogit(fit.coef, Xte).map(q => [1 - q, q]);
    } else {
      const fit = S.mlogit(Xtr, ytr, K, {weights: w, ridge: spec.ridge == null ? 1e-4 : spec.ridge});
      if (!fit.converged) warnings.push('Fold ' + (f + 1) + ': model did not converge.');
      P = fit.predict(Xte);
    }
    te.forEach((i, j) => { for (let c = 0; c < K; c++) prob[i][c] = P[j][c]; });
    const yt = te.map(i => y[i]), yp = te.map((i, j) => argmax(P[j]));
    perFold.push(Object.assign({fold: f + 1, nTest: te.length}, S.metrics(yt, yp, K, P)));
  }
  const pred = prob.map(argmax);
  const out = {pooled: S.metrics(y, pred, K, prob.map(r => Array.from(r))), perFold, prob: prob.map(r => Array.from(r)), pred, warnings: Array.from(new Set(warnings))};
  out.foldMean = {balancedAccuracy: S.mean(perFold.map(r => r.balancedAccuracy)), balancedAccuracySD: S.sd(perFold.map(r => r.balancedAccuracy)),
    macroF1: S.mean(perFold.map(r => r.macroF1)), logLoss: S.mean(perFold.map(r => r.logLoss))};
  return out;
};
function argmax(a) { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }
S.argmax = argmax;
/** Permutation test of cross-validated performance: labels are permuted (between groups when groups are given,
    by permuting group-level labels only if each group has a single label; otherwise within the whole sample) and
    the full cross-validation is repeated. Returns the observed statistic, the permutation distribution and p = (1 + #{perm >= obs}) / (1 + B). */
S.permutationTest = function (spec, B, seed, stat) {
  stat = stat || (r => r.pooled.balancedAccuracy);
  const obs = stat(S.crossValidate(spec)), rnd = S.rng(seed || 7), dist = [];
  for (let b = 0; b < B; b++) dist.push(stat(S.crossValidate(Object.assign({}, spec, {y: S.shuffle(spec.y, rnd)}))));
  const ge = dist.filter(v => v >= obs - 1e-12).length;
  return {observed: obs, distribution: dist, p: (1 + ge) / (1 + B), B};
};
/** Cluster (group) bootstrap: resamples groups with replacement and recomputes stat(indices). Percentile CI. */
S.clusterBootstrap = function (groups, stat, B, seed, level) {
  const {idx} = groupIndex(groups), rnd = S.rng(seed || 11), est = stat(Array.from({length: groups.length}, (_, i) => i)), vals = [];
  for (let b = 0; b < B; b++) { const ids = []; for (let g = 0; g < idx.length; g++) { const pick = idx[Math.floor(rnd() * idx.length)]; for (const i of pick) ids.push(i); } const v = stat(ids); if (isNum(v)) vals.push(v); }
  const a = (1 - (level || 0.95)) / 2;
  return {estimate: est, lo: S.quantile(vals, a), hi: S.quantile(vals, 1 - a), se: S.sd(vals), B: vals.length};
};
/** Leakage and design checks for a classification analysis; returns a list of {level: 'error'|'warning'|'info', text}. */
S.auditDesign = function (opt) {
  const out = [], {y, K, groups, folds, nFeatures, classNames} = opt, n = y.length;
  const cnt = new Float64Array(K); y.forEach(c => cnt[c]++);
  const minC = Math.min(...cnt), maxC = Math.max(...cnt);
  if (maxC / Math.max(1, minC) > 1.5) out.push({level: 'warning', text: 'Classes are imbalanced (largest/smallest = ' + (maxC / Math.max(1, minC)).toFixed(1) + '). Accuracy is misleading; read balanced accuracy, macro-F1 and per-class recall, and compare with the majority-class baseline.'});
  if (minC < 10) out.push({level: 'warning', text: 'At least one class has fewer than 10 observations' + (classNames ? ' (' + classNames.filter((_, k) => cnt[k] < 10).join(', ') + ')' : '') + '. Estimates for it are unstable.'});
  if (nFeatures) { const epv = minC / nFeatures; if (epv < 10) out.push({level: 'warning', text: 'Events per variable is ' + epv.toFixed(1) + ' (smallest class / predictors). Below about 10, coefficients are unstable; consider fewer predictors, ridge or Firth penalization.'}); }
  if (groups) {
    const {idx} = groupIndex(groups);
    if (!folds) out.push({level: 'error', text: 'Observations are grouped (' + idx.length + ' groups) but folds are not grouped: frames or trials from the same person would appear in training and test sets.'});
    else {
      const leak = idx.filter(g => new Set(g.map(i => folds[i])).size > 1).length;
      if (leak) out.push({level: 'error', text: leak + ' group(s) appear in more than one fold: data leakage.'});
      else out.push({level: 'info', text: 'Grouped folds: no group appears in both training and test sets (' + idx.length + ' groups).'});
    }
    if (idx.length < 20) out.push({level: 'warning', text: 'Only ' + idx.length + ' independent groups: generalization to new people is estimated imprecisely.'});
  } else out.push({level: 'warning', text: 'No grouping variable given. If several observations come from the same person, video or session, results will be optimistic; specify the grouping variable.'});
  return out;
};

/* ============================== temporal analysis ============================== */
/** Activity events in an AU time series: runs with value >= threshold, merging gaps up to maxGap seconds and
    dropping events shorter than minDur seconds. t: times in seconds (same length). */
S.events = function (v, t, opt) {
  opt = opt || {}; const thr = opt.threshold == null ? 0.5 : opt.threshold, minDur = opt.minDur || 0, maxGap = opt.maxGap || 0;
  const ev = []; let cur = null;
  for (let i = 0; i < v.length; i++) {
    const on = isNum(v[i]) && v[i] >= thr;
    if (on) { if (!cur) cur = {i0: i, i1: i}; else cur.i1 = i; }
    else if (cur) { ev.push(cur); cur = null; }
  }
  if (cur) ev.push(cur);
  const merged = [];
  for (const e of ev) { const last = merged[merged.length - 1]; if (last && t[e.i0] - t[last.i1] <= maxGap) last.i1 = e.i1; else merged.push(Object.assign({}, e)); }
  const dt = t.length > 1 ? S.median(t.slice(1).map((x, i) => x - t[i])) : 0;
  return merged.map(e => {
    let pk = e.i0; let area = 0;
    for (let i = e.i0; i <= e.i1; i++) { if (v[i] > v[pk]) pk = i; area += (isNum(v[i]) ? v[i] : 0) * dt; }
    return {start: t[e.i0], end: t[e.i1] + dt, duration: t[e.i1] - t[e.i0] + dt, peak: v[pk], peakTime: t[pk], timeToPeak: t[pk] - t[e.i0], area, i0: e.i0, i1: e.i1};
  }).filter(e => e.duration >= minDur);
};
/** Summary temporal features of one AU series within a segment. */
S.temporalFeatures = function (v, t, opt) {
  opt = opt || {}; const ev = S.events(v, t, opt), x = Array.from(v).filter(isNum);
  const dt = t.length > 1 ? S.median(t.slice(1).map((q, i) => q - t[i])) : 0, total = t.length ? t[t.length - 1] - t[0] + dt : 0;
  let pk = 0; for (let i = 1; i < v.length; i++) if (isNum(v[i]) && v[i] > v[pk]) pk = i;
  // rise time 10%-90% of the peak, measured backwards from the peak
  const peak = v[pk], base = S.min(x); let i10 = pk, i90 = pk;
  for (let i = pk; i >= 0; i--) { if (v[i] >= base + 0.9 * (peak - base)) i90 = i; if (v[i] >= base + 0.1 * (peak - base)) i10 = i; else break; }
  let maxSlope = 0; for (let i = 1; i < v.length; i++) if (isNum(v[i]) && isNum(v[i - 1])) { const s = (v[i] - v[i - 1]) / (t[i] - t[i - 1] || 1); if (s > maxSlope) maxSlope = s; }
  return {mean: S.mean(x), sd: S.sd(x), max: peak, timeOfMax: t[pk] - t[0], propActive: total ? S.sum(ev.map(e => e.duration)) / total : 0,
    nEvents: ev.length, firstOnset: ev.length ? ev[0].start - t[0] : null, meanEventDuration: ev.length ? S.mean(ev.map(e => e.duration)) : 0,
    riseTime: t[i90] - t[i10], maxRiseSlope: maxSlope, area: S.sum(x) * dt};
};
/** Lagged cross-correlation of two series; positive lag means b follows a. */
S.crossCorr = function (a, b, maxLag) {
  const out = [];
  for (let L = -maxLag; L <= maxLag; L++) {
    const x = [], y = []; for (let i = 0; i < a.length; i++) { const j = i + L; if (j >= 0 && j < b.length && isNum(a[i]) && isNum(b[j])) { x.push(a[i]); y.push(b[j]); } }
    out.push({lag: L, r: x.length > 3 ? S.pearson(x, y).r : NaN, n: x.length});
  }
  const best = out.filter(o => isNum(o.r)).sort((p, q) => Math.abs(q.r) - Math.abs(p.r))[0];
  return {series: out, best};
};

/* ============================== co-occurrence ============================== */
/** Pairwise co-occurrence statistics for binary AU columns: counts, Jaccard, phi, lift, conditional probabilities,
    odds ratio (Haldane-corrected if needed), Fisher exact p and Benjamini-Hochberg q across all pairs. */
S.cooccurrence = function (cols, names) {
  const pairs = [], n = cols[0].length;
  for (let a = 0; a < cols.length; a++) for (let b = a + 1; b < cols.length; b++) {
    const t = S.table2x2(cols[a], cols[b]), na = t.a + t.b, nb = t.a + t.c, or = S.oddsRatio(t.a, t.b, t.c, t.d);
    pairs.push({a: names[a], b: names[b], n11: t.a, n10: t.b, n01: t.c, n00: t.d, pA: na / n, pB: nb / n,
      jaccard: (t.a + t.b + t.c) ? t.a / (t.a + t.b + t.c) : NaN, phi: S.phi(t.a, t.b, t.c, t.d), lift: (na && nb) ? t.a * n / (na * nb) : NaN,
      pBgivenA: na ? t.a / na : NaN, pAgivenB: nb ? t.a / nb : NaN, or: or.or, orLo: or.lo, orHi: or.hi, p: S.fisherExact(t.a, t.b, t.c, t.d).p});
  }
  const q = S.padjust(pairs.map(r => r.p), 'BH'); pairs.forEach((r, i) => { r.q = q[i]; });
  return pairs;
};

/* ============================== code export ============================== */
/** Reproducible R and Python code for an analysis run in the statistics lab. S.code.R(spec) and S.code.python(spec)
    return a commented script that reads the data file and recomputes the numbers the lab shows. The lab passes:
    { analysis: 'describe'|'compare'|'correlate'|'cooccur'|'binary'|'multinomial'|'lmm'|'glmm'|'cv'|'transfer',
      file: 'data.csv',
      // models
      outcome, outcomeType: 'binary'|'multinomial'|'continuous',
      positive,                      // binary outcome built from a categorical column: (outcome == positive); null if outcome is already 0/1
      predictors: [...], categorical: [...],   // categorical predictors use treatment coding, reference = alphabetically first level
      standardize: true|false,       // z-score numeric (non-categorical) predictors before fitting, as the UI does
      interactions: [['a','b'], ...],// products of the (standardized) numeric predictors
      method: 'ml'|'firth'|'ridge',  // binary only; ridge = L2 penalty lambda 1 on non-intercept coefficients
      group,                         // cluster-robust (CR1) SEs for binary/multinomial; random intercept for lmm/glmm; grouped folds for cv
      // cv
      featureSets: [{name, predictors, interactions}], folds: 5, classWeight: 'balanced'|null, model: 'mlogit'|'majority', permutations: 0, seed: 1,
      // transfer
      split, trainLevel,             // train on rows with split == trainLevel, test on the rest, and the reverse; report balanced accuracy both ways
      // descriptive
      variable, by, variables: [...], corMethod: 'spearman'|'pearson', threshold: 0.5 }
    Optional, with the lab's values as defaults: permSeed (13), bootSeed (3), bootstrap (400), ridge for cv and transfer (1e-4).
    The generated code follows these rules; the lab must follow them too for the numbers to agree:
    - Fields are read as text; '', NA, na, NaN, nan, null and NULL are missing; numeric columns are parsed as numbers
      (anything else becomes missing). Models, cv and transfer drop rows with a missing outcome, predictor or group
      (and split) first; z-scores and factor levels are then computed on the remaining rows. describe drops rows with
      a missing variable, by or group; compare deletes per variable, correlate per pair, cooccur across all variables.
    - Levels sort in code-point order (JavaScript sort(), Python sorted(), R sort(method = "radix")); the first level of
      a categorical predictor and of a multinomial outcome is the reference. z-scores use the n - 1 SD.
    - Interactions must name numeric predictors. In models they multiply the (z-scored) predictors. In cv and transfer
      (featureSets[].interactions: pairs, or a list of names meaning all pairs) the products are formed from raw
      values and every feature, dummies included, is z-scored inside each training fold, as S.crossValidate does.
    - Random numbers come from the lab's generator (S.rng), ported to R and Python: stratified folds (no group) use
      `seed`, the permutation test permSeed, the describe cluster bootstrap bootSeed. Grouped folds follow S.groupKFold.
    - cv and transfer use balanced class weights unless classWeight is null; the majority model and the majority
      baseline predict the most frequent training class, without weights. */
S.code = (function () {
  const NA = ['', 'NA', 'na', 'NaN', 'nan', 'null', 'NULL'];
  const q = s => JSON.stringify(String(s));                 // a string literal valid in both R and Python
  const RESERVED = new Set(['if', 'else', 'repeat', 'while', 'function', 'for', 'next', 'break', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN',
    'NA', 'NA_integer_', 'NA_real_', 'NA_character_', 'NA_complex_', 'in', '...']);
  const syn = n => /^(?:[A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]*$/.test(n) && !RESERVED.has(n) && !/^\.\.[0-9]+$/.test(n);
  const rs = n => syn(n) ? n : '`' + String(n).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';   // R name in a formula
  const rc = (n, df) => (df || 'd') + (syn(n) ? '$' + n : '[[' + q(n) + ']]');                         // R column
  const pc = (n, df) => (df || 'd') + '[' + q(n) + ']';                                               // pandas column
  const one = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = x => String(+x);
  const uniq = a => a.filter((x, i) => x != null && x !== '' && a.indexOf(x) === i);
  const orList = a => { const b = a.map(one); return b.length > 1 ? b.slice(0, -1).join(', ') + ' or ' + b[b.length - 1] : b.join(''); };
  // items inside open ... close, wrapped when long (valid inside R calls and Python brackets)
  function wrap(open, items, close, indent) {
    const flat = open + items.join(', ') + close;
    if (flat.length <= 110) return flat;
    const lines = []; let cur = open;
    items.forEach((it, i) => {
      const piece = it + (i < items.length - 1 ? ',' : close);
      if (cur !== open && cur.length + piece.length + 1 > 110) { lines.push(cur); cur = indent + piece; } else cur += (cur === open ? '' : ' ') + piece;
    });
    lines.push(cur);
    return lines.join('\n');
  }
  const rvec = (a, ind) => wrap('c(', a.map(q), ')', ind || '  ');
  const pyl = (a, ind) => wrap('[', a.map(q), ']', ind || '    ');
  const pyPairs = ps => '[' + ps.map(p => '(' + q(p[0]) + ', ' + q(p[1]) + ')').join(', ') + ']';

  /* ---- spec ---- */
  function pairsOf(inter, preds, cats) {
    if (!inter || !inter.length) return [];
    const ok = x => preds.includes(x) && !cats.includes(x);
    if (inter.every(Array.isArray)) return inter.filter(p => p.length === 2 && ok(p[0]) && ok(p[1])).map(p => [String(p[0]), String(p[1])]);
    const sub = uniq(inter.filter(x => typeof x === 'string' && ok(x))), out = [];
    for (let a = 0; a < sub.length; a++) for (let b = a + 1; b < sub.length; b++) out.push([sub[a], sub[b]]);
    return out;
  }
  function norm(spec) {
    const s = Object.assign({}, spec || {});
    s.analysis = s.analysis || {binary: 'binary', multinomial: 'multinomial', continuous: 'lmm'}[s.outcomeType] || 'unknown';
    s.file = s.file || 'data.csv';
    s.group = s.group || null;
    if (s.positive === '' || s.positive === undefined) s.positive = null;
    s.categorical = uniq((s.categorical || []).map(String));
    s.predictors = uniq((s.predictors || []).map(String));
    s.interactions = pairsOf(s.interactions, s.predictors, s.categorical);
    s.variables = uniq((s.variables || []).map(String));
    s.method = s.method === 'firth' || s.method === 'ridge' ? s.method : 'ml';
    s.folds = Math.max(2, Math.floor(+s.folds || 5));
    s.seed = s.seed == null ? 1 : +s.seed;
    s.permSeed = s.permSeed == null ? 13 : +s.permSeed;
    s.bootSeed = s.bootSeed == null ? 3 : +s.bootSeed;
    s.bootstrap = s.bootstrap == null ? 400 : +s.bootstrap;
    s.permutations = Math.max(0, Math.floor(+s.permutations || 0));
    s.model = s.model === 'majority' ? 'majority' : 'mlogit';
    s.balanced = s.classWeight !== null && s.classWeight !== false && s.classWeight !== 'none';
    s.ridge = s.ridge == null ? 1e-4 : +s.ridge;
    s.threshold = s.threshold == null ? 0.5 : +s.threshold;
    s.spearman = String(s.corMethod || 'spearman').toLowerCase() !== 'pearson';
    const sets = (s.featureSets && s.featureSets.length) ? s.featureSets : [{name: 'Model', predictors: s.predictors, interactions: s.interactions}];
    s.sets = sets.map((fs, i) => {
      const preds = uniq((fs.predictors || fs.preds || []).map(String));
      return {name: String(fs.name || 'Feature set ' + (i + 1)), predictors: preds, interactions: pairsOf(fs.interactions || fs.inter, preds, s.categorical)};
    });
    return s;
  }
  // spec fields an analysis cannot do without
  function lacking(s) {
    const a = s.analysis, out = [], need = (ok, name) => { if (!ok) out.push(name); };
    if (a === 'describe') { need(s.variable, 'variable'); need(s.by, 'by'); }
    else if (a === 'compare') { need(s.variables.length, 'variables'); need(s.by, 'by'); }
    else if (a === 'correlate' || a === 'cooccur') need(s.variables.length > 1, 'two or more variables');
    else if (['binary', 'glmm', 'multinomial', 'lmm', 'cv', 'transfer'].includes(a)) need(s.outcome, 'outcome');
    if (a === 'cv' || a === 'transfer') need(s.sets.some(fs => fs.predictors.length), 'a feature set with predictors');
    if (a === 'transfer') { need(s.split, 'split'); need(s.trainLevel != null, 'trainLevel'); }
    return out;
  }
  // columns read as numbers and columns kept as text
  function columns(s) {
    const a = s.analysis, text = [], numeric = [];
    const T = v => { if (v != null && v !== '') text.push(v); }, N = v => { if (v != null && v !== '') numeric.push(v); };
    const preds = ps => ps.forEach(v => (s.categorical.includes(v) ? T : N)(v));
    if (a === 'describe') { N(s.variable); T(s.by); T(s.group); }
    else if (a === 'compare') { s.variables.forEach(N); T(s.by); }
    else if (a === 'correlate' || a === 'cooccur') s.variables.forEach(N);
    else if (a === 'cv' || a === 'transfer') { T(s.outcome); s.sets.forEach(fs => preds(fs.predictors)); T(s.group); if (a === 'transfer') T(s.split); }
    else {
      if (a === 'lmm' || ((a === 'binary' || a === 'glmm') && s.positive == null)) N(s.outcome); else T(s.outcome);
      preds(s.predictors); T(s.group);
    }
    const tx = uniq(text);
    return {text: tx, numeric: uniq(numeric).filter(v => !tx.includes(v))};
  }
  const TITLES = {describe: 'Describe by group', compare: 'Compare groups (Kruskal-Wallis tests, FDR)', correlate: 'Correlations (FDR)',
    cooccur: 'Co-occurrence of actions', binary: 'Logistic regression', multinomial: 'Multinomial logistic regression', lmm: 'Linear mixed model',
    glmm: 'Logistic mixed model', cv: 'Predictive validation (cross-validation)', transfer: 'Transfer to a held-out subset'};
  function title(s) {
    const a = s.analysis, y = one(s.outcome) + (s.positive != null ? ' = ' + one(s.positive) : '');
    if (a === 'describe') return `${TITLES[a]}: ${one(s.variable)} by ${one(s.by)}`;
    if (a === 'compare') return `${TITLES[a]} across ${one(s.by)}`;
    if (a === 'correlate') return `${s.spearman ? 'Spearman' : 'Pearson'} correlations (FDR)`;
    if (a === 'cooccur') return `${TITLES[a]} (active when >= ${num(s.threshold)})`;
    if (a === 'transfer') return `${TITLES[a]}: ${one(s.outcome)}, split by ${one(s.split)}`;
    if (a === 'binary' && s.method !== 'ml') return `${TITLES[a]} (${s.method === 'firth' ? 'Firth' : 'ridge, lambda = 1'}): ${y}`;
    return `${TITLES[a] || a}: ${y}`;
  }
  // header, packages, helper functions, data, analysis
  function assemble(lang, s, pkgs, helpers, data, analysis) {
    const L = [`# ${title(s)}`, `# Exported by the Face Value statistics lab: recomputes the numbers the lab shows.`];
    if (lang === 'R') {
      L.push(`# Run it in the folder that holds ${one(s.file)}. Packages: install.packages(${rvec(pkgs)})`);
      const cols = columns(s);
      if (cols.text.concat(cols.numeric).some(n => /[^\x00-\x7f]/.test(n))) L.push('# Some column names are not ASCII: run R in a UTF-8 locale (the default in current R versions)');
      L.push(...pkgs.map(p => `library(${p})`));
      if (helpers.length) { L.push('', '# ---- helper functions ----'); helpers.forEach((h, i) => L.push(...(i ? [''] : []), ...h)); }
      L.push('', '# ---- data ----', ...data, '', '# ---- analysis ----', ...analysis);
    } else {
      L.push(`# Run it in the folder that holds ${one(s.file)}. Packages: ${pkgs.join(', ')}`, ...pkgs.imports);
      if (helpers.length) { L.push('', '', '# ---- helper functions ----'); helpers.forEach((h, i) => L.push(...(i ? ['', ''] : []), ...h)); L.push('', ''); }
      else L.push('');
      L.push('# ---- data ----', ...data, '', '# ---- analysis ----', ...analysis);
    }
    return L.join('\n') + '\n';
  }

  /* ============================== R ============================== */
  const R_RNG = [
    '# The lab\'s seeded random number generator (mulberry32), ported with exact 32-bit arithmetic, so that',
    '# folds, permutations and bootstrap resamples are the same as in the browser. rng(n) gives the next n numbers.',
    'lab_rng <- function(seed) {',
    '  M <- 4294967296',
    '  xor32 <- function(a, b) bitwXor(a %/% 65536, b %/% 65536) * 65536 + bitwXor(a %% 65536, b %% 65536)',
    '  or32 <- function(a, k) a - a %% 65536 + bitwOr(a %% 65536, k)',
    '  mul32 <- function(a, b) ((((a %/% 65536) * b) %% 65536) * 65536 + (a %% 65536) * b) %% M',
    '  s <- seed %% M; if (s == 0) s <- 1',
    '  function(n = 1) {',
    '    if (n < 1) return(numeric(0))',
    '    a <- (s + mul32(seq_len(n), 1831565813)) %% M  # the state advances by a constant at each draw',
    '    s <<- a[n]',
    '    t <- mul32(xor32(a, a %/% 32768), or32(a, 1))',
    '    t <- xor32((t + mul32(xor32(t, t %/% 128), or32(t, 61))) %% M, t)',
    '    xor32(t, t %/% 16384) / M',
    '  }',
    '}'];
  const R_SHUFFLE = [
    '# Fisher-Yates shuffle from the last element down, as the lab',
    'lab_shuffle <- function(x, rng) {',
    '  n <- length(x); if (n < 2) return(x)',
    '  u <- rng(n - 1)',
    '  for (k in seq_len(n - 1)) { i <- n - k + 1; j <- floor(u[k] * i) + 1; tmp <- x[i]; x[i] <- x[j]; x[j] <- tmp }',
    '  x',
    '}'];
  const R_ZSCORE = ['# z-score with the n - 1 SD, as the lab', 'zscore <- function(x) (x - mean(x)) / (if (isTRUE(sd(x) > 0)) sd(x) else 1)'];
  const R_CR1 = [
    '# Cluster-robust sandwich covariance with the CR1 factor G/(G-1) x (N-1)/(N-K), as the lab and statsmodels',
    'cr1_vcov <- function(scores, bread, cluster) {',
    '  S <- rowsum(scores, as.character(cluster))  # score contributions summed within clusters',
    '  N <- nrow(scores); K <- ncol(scores); G <- nrow(S)',
    '  G / (G - 1) * (N - 1) / (N - K) * bread %*% crossprod(S) %*% bread',
    '}'];
  const R_WALD = [
    '# Wald table with normal quantiles, as the lab',
    'wald_table <- function(b, V) {',
    '  se <- sqrt(diag(V)); z <- b / se',
    '  data.frame(term = names(b), estimate = b, se = se, z = z, p = 2 * pnorm(-abs(z)),',
    '             lo = b - qnorm(0.975) * se, hi = b + qnorm(0.975) * se, row.names = NULL)',
    '}'];
  const R_RIDGE = [
    '# Ridge logistic regression as the lab: maximize the log-likelihood minus lambda/2 x the sum of squared slopes',
    '# (the intercept is not penalized) by Newton-Raphson; returns the coefficients and the inverse penalized information',
    'ridge_logit <- function(X, y, lambda = 1) {',
    '  pen <- c(0, rep(lambda, ncol(X) - 1))',
    '  b <- c(qlogis(mean(y)), rep(0, ncol(X) - 1))',
    '  for (it in 1:100) {',
    '    p <- plogis(drop(X %*% b))',
    '    step <- drop(solve(crossprod(X, p * (1 - p) * X) + diag(pen, length(pen)), crossprod(X, y - p) - pen * b))',
    '    b <- b + step',
    '    if (max(abs(step)) < 1e-10) break',
    '  }',
    '  p <- plogis(drop(X %*% b))',
    '  list(coef = setNames(b, colnames(X)), vcov = solve(crossprod(X, p * (1 - p) * X) + diag(pen, length(pen))))',
    '}'];
  const R_ICC = [
    '# Unconditional ICC(1) from one-way ANOVA, with the n0 adjustment for unequal group sizes, as the lab',
    'icc1 <- function(y, g) {',
    '  g <- as.character(g); n_g <- table(g); N <- length(y); G <- length(n_g)',
    '  msb <- sum(n_g * (tapply(y, g, mean) - mean(y))^2) / (G - 1)',
    '  msw <- sum((y - ave(y, g))^2) / (N - G)',
    '  n0 <- (N - sum(n_g^2) / N) / (G - 1)',
    '  (msb - msw) / (msb + (n0 - 1) * msw)',
    '}'];
  const R_SOFTMAX = ['softmax <- function(E) { E <- exp(E - apply(E, 1, max)); E / rowSums(E) }'];
  const R_MLOGIT = [
    '# Multinomial logistic regression with the first class as reference, case weights w and a ridge penalty',
    '# (ridge / 2 x sum of squared slopes; intercepts are not penalized), fitted by Newton-Raphson with step halving',
    'fit_mlogit <- function(X, y, K, w, ridge) {',
    '  p <- ncol(X); Y <- outer(y, 1:K, "==") * 1',
    '  pen <- rep(c(0, rep(ridge, p - 1)), K - 1)',
    '  loglik <- function(B) {',
    '    E <- X %*% cbind(0, B); m <- apply(E, 1, max)',
    '    sum(w * (E[cbind(seq_along(y), y)] - m - log(rowSums(exp(E - m))))) - sum(pen * B^2) / 2',
    '  }',
    '  B <- matrix(0, p, K - 1); ll <- loglik(B)',
    '  for (it in 1:100) {',
    '    P <- softmax(X %*% cbind(0, B))',
    '    g <- as.vector(crossprod(X, w * (Y[, -1] - P[, -1]))) - pen * as.vector(B)',
    '    H <- matrix(0, p * (K - 1), p * (K - 1))',
    '    for (a in 2:K) for (b in 2:K)',
    '      H[(a - 2) * p + 1:p, (b - 2) * p + 1:p] <- crossprod(X, (w * P[, a] * ((a == b) - P[, b])) * X)',
    '    step <- solve(H + diag(pen, length(pen)), g)',
    '    t <- 1',
    '    repeat { B_new <- B + t * step; ll_new <- loglik(B_new); if (ll_new >= ll - 1e-12 || t < 1e-9) break; t <- t / 2 }',
    '    done <- max(abs(t * step)) < 1e-10 || abs(ll_new - ll) < 1e-10 * (abs(ll_new) + 1e-10)',
    '    B <- B_new; ll <- ll_new',
    '    if (done) break',
    '  }',
    '  cbind(0, B)',
    '}'];
  const R_FITPRED = [
    '# One training/test split as in the lab: z-score the features with the training means and SDs, weight the',
    '# classes n / (classes x class count) when balanced, fit, and return class probabilities for the test rows.',
    '# The majority model predicts the class frequencies of the training rows (no weights).',
    'fit_predict <- function(Xtr, ytr, Xte, K, model, balanced, ridge) {',
    '  mu <- colMeans(Xtr); s <- apply(Xtr, 2, sd); s[!(s > 0)] <- 1',
    '  Xtr <- cbind(1, sweep(sweep(Xtr, 2, mu), 2, s, "/")); Xte <- cbind(1, sweep(sweep(Xte, 2, mu), 2, s, "/"))',
    '  count <- tabulate(ytr, K)',
    '  if (model == "majority" || ncol(Xtr) == 1)',
    '    return(matrix((count + 1e-9) / (sum(count) + K * 1e-9), nrow(Xte), K, byrow = TRUE))',
    '  w <- if (balanced) length(ytr) / (sum(count > 0) * count[ytr]) else rep(1, length(ytr))',
    '  softmax(Xte %*% fit_mlogit(Xtr, ytr, K, w, ridge))',
    '}'];
  const R_METRICS = [
    '# The lab\'s metrics: predicted class = most probable (first on ties); balanced accuracy and macro-F1 over the',
    '# classes present in y; one-vs-rest AUC averaged over classes; log loss',
    'cv_metrics <- function(y, prob, K) {',
    '  pred <- max.col(prob, ties.method = "first"); present <- sort(unique(y))',
    '  recall <- sapply(present, function(k) mean(pred[y == k] == k))',
    '  f1 <- sapply(present, function(k) 2 * sum(pred == k & y == k) / (sum(pred == k) + sum(y == k)))',
    '  auc <- unlist(lapply(if (K == 2) 1 else 1:K, function(k) {',
    '    pos <- y == k; if (!any(pos) || all(pos)) return(NULL)',
    '    r <- rank(prob[, k]); (sum(r[pos]) - sum(pos) * (sum(pos) + 1) / 2) / (sum(pos) * sum(!pos))',
    '  }))',
    '  list(balanced_accuracy = mean(recall), macro_f1 = mean(f1), auc = if (length(auc)) mean(auc) else NA,',
    '       log_loss = -mean(log(pmin(pmax(prob[cbind(seq_along(y), y)], 1e-15), 1 - 1e-15))),',
    '       confusion = table(true = factor(y, 1:K, classes), predicted = factor(pred, 1:K, classes)))',
    '}'];
  const R_CROSSVAL = [
    '# Out-of-fold predictions for every fold; pooled metrics plus the SD of the per-fold balanced accuracy',
    'cross_validate <- function(X, y, K, folds, model, balanced, ridge) {',
    '  prob <- matrix(0, length(y), K); fold_bacc <- c()',
    '  for (f in sort(unique(folds))) {',
    '    te <- folds == f',
    '    prob[te, ] <- fit_predict(X[!te, , drop = FALSE], y[!te], X[te, , drop = FALSE], K, model, balanced, ridge)',
    '    fold_bacc <- c(fold_bacc, cv_metrics(y[te], prob[te, , drop = FALSE], K)$balanced_accuracy)',
    '  }',
    '  c(cv_metrics(y, prob, K), list(fold_sd = sd(fold_bacc)))',
    '}'];
  const R_GROUPFOLDS = [
    '# The lab\'s grouped folds (as scikit-learn GroupKFold): groups sorted by size, largest first (ties by name),',
    '# each put in the fold with the fewest rows so far, so no group is in two folds',
    'group_folds <- function(g, k) {',
    '  size <- table(as.character(g))',
    '  k <- min(k, length(size)); rows <- numeric(k); fold_of <- integer(0)',
    '  for (nm in names(size)[order(-as.vector(size), names(size), method = "radix")]) {',
    '    f <- which.min(rows); rows[f] <- rows[f] + size[[nm]]; fold_of[nm] <- f',
    '  }',
    '  unname(fold_of[as.character(g)])',
    '}'];
  const R_STRATFOLDS = [
    '# The lab\'s stratified folds without groups: the rows of each class (classes in order of appearance) are',
    '# shuffled with the lab\'s generator and dealt to the folds in turn',
    'stratified_folds <- function(y, k, seed) {',
    '  rng <- lab_rng(seed); fold <- integer(length(y)); offset <- 0',
    '  for (cl in unique(y)) {',
    '    ids <- lab_shuffle(which(y == cl), rng)',
    '    fold[ids] <- (seq_along(ids) - 1 + offset) %% k + 1',
    '    offset <- offset + length(ids)',
    '  }',
    '  fold',
    '}'];
  const rBoot = s => [
    `# 95% interval of the mean: cluster bootstrap resampling whole groups (${s.bootstrap} resamples, percentile interval),`,
    '# drawn with the lab\'s generator so that the limits match the browser',
    `cluster_boot_ci <- function(x, cluster, B = ${s.bootstrap}, seed = ${s.bootSeed}) {`,
    '  rng <- lab_rng(seed)',
    '  rows <- split(seq_along(x), factor(cluster, levels = unique(cluster)))  # rows of each group, in order of appearance',
    '  G <- length(rows); means <- numeric(B)',
    '  for (b in seq_len(B)) means[b] <- mean(x[unlist(rows[floor(rng(G) * G) + 1])])  # G groups drawn with replacement',
    '  quantile(means, c(0.025, 0.975), names = FALSE)',
    '}'];

  function rRead(s, C) {
    const fn = /\.(tsv|tab)$/i.test(s.file) ? 'read_tsv' : 'read_csv';
    const types = ['.default = col_character()'].concat(C.numeric.map(n => rs(n) + ' = col_double()'));
    return ['# Read the data as the lab does: text stays text; blank, NA, NaN and null are missing; numeric columns as numbers',
      `d <- ${fn}(${q(s.file)}, na = ${rvec(NA)},`,
      wrap('              col_types = cols(', types, '))', '                               ')];
  }
  function rFormula(lhs, preds, inter, extra) {
    const t = preds.map(rs).concat(inter.map(p => rs(p[0]) + ':' + rs(p[1])));
    return (lhs ? rs(lhs) + ' ' : '') + '~ ' + (t.length ? t.join(' + ') : '1') + (extra || '');
  }

  function R(spec) {
    const s = norm(spec), a = s.analysis, C = columns(s), P = ['readr'], H = [], D = rRead(s, C), A = [];
    if (lacking(s).length) return assemble('R', s, P, H, D, [`# No code: the analysis specification lacks ${lacking(s).join(', ')}`]);
    const help = (...blocks) => blocks.forEach(b => { if (!H.includes(b)) H.push(b); });
    if (a === 'describe') {
      const g = s.group;
      D.push('# Rows with a missing value are dropped', `d <- d[complete.cases(d[${rvec(uniq([s.variable, s.by, g]))}]), ]`);
      if (g) help(R_RNG, rBoot(s));
      A.push(`# n, mean, SD, median and 95% CI of ${one(s.variable)} for each level of ${one(s.by)} (levels in alphabetical order)`,
        `results <- do.call(rbind, lapply(sort(unique(${rc(s.by)}), method = "radix"), function(level) {`,
        `  x <- ${rc(s.variable)}[${rc(s.by)} == level]`,
        g ? `  ci <- if (length(x) > 2) cluster_boot_ci(x, ${rc(g)}[${rc(s.by)} == level]) else c(NA, NA)  # resamples ${one(g)}`
          : '  ci <- if (length(x) > 2) mean(x) + c(-1, 1) * 1.96 * sd(x) / sqrt(length(x)) else c(NA, NA)  # normal approximation',
        '  data.frame(level = level, n = length(x), mean = mean(x), sd = sd(x), median = median(x), lo95 = ci[1], hi95 = ci[2])',
        '}))', 'print(results, digits = 4)');
      if (!g) A.push('# Rows are treated as independent; with several rows per person, set a grouping variable in the lab');
    } else if (a === 'compare') {
      D.push('# Rows without a group are dropped; each variable then uses the rows where it is observed, as the lab', `d <- d[!is.na(${rc(s.by)}), ]`);
      A.push(`vars <- ${rvec(s.variables)}`, `levels_by <- sort(unique(${rc(s.by)}), method = "radix")`,
        '# Kruskal-Wallis test per variable (H corrected for ties), epsilon squared = H / (n - 1), and group means',
        'results <- do.call(rbind, lapply(vars, function(v) {',
        '  ok <- !is.na(d[[v]])',
        `  kw <- kruskal.test(d[[v]][ok], factor(${rc(s.by)}[ok]))`,
        `  means <- tapply(d[[v]][ok], factor(${rc(s.by)}[ok], levels = levels_by), mean)`,
        '  data.frame(variable = v, H = unname(kw$statistic), df = unname(kw$parameter), p = kw$p.value,',
        '             epsilon2 = unname(kw$statistic) / (sum(ok) - 1), t(setNames(means, paste0("mean_", levels_by))), check.names = FALSE)',
        '}))',
        'results$q_BH <- p.adjust(results$p, method = "BH")  # Benjamini-Hochberg across the variables',
        'results <- results[c("variable", "H", "df", "p", "q_BH", "epsilon2", paste0("mean_", levels_by))]',
        'print(results, digits = 4)',
        '# Rows are treated as independent: with several rows per person the p values are too small (see the lab note)');
    } else if (a === 'correlate') {
      D.push('# Each pair of variables uses the rows where both are observed, as the lab');
      A.push(`vars <- ${rvec(s.variables)}`,
        s.spearman ? '# Spearman correlation; p from the t approximation (as the lab and scipy); 95% CI by Fisher\'s z with the'
          : '# Pearson correlation; p from the t test and 95% CI by Fisher\'s z (the same as cor.test())',
        ...(s.spearman ? ['# Bonett-Wright (2000) standard error'] : []),
        'pairs <- combn(vars, 2)',
        'results <- do.call(rbind, lapply(seq_len(ncol(pairs)), function(j) {',
        '  x <- d[[pairs[1, j]]]; y <- d[[pairs[2, j]]]; ok <- !is.na(x) & !is.na(y); x <- x[ok]; y <- y[ok]; n <- length(x)',
        `  r <- cor(x, y, method = "${s.spearman ? 'spearman' : 'pearson'}")`,
        '  tstat <- r * sqrt((n - 2) / (1 - r^2))',
        s.spearman ? '  se <- sqrt((1 + r^2 / 2) / (n - 3))' : '  se <- 1 / sqrt(n - 3)',
        '  ci <- tanh(atanh(r) + c(-1, 1) * qnorm(0.975) * se)',
        '  data.frame(a = pairs[1, j], b = pairs[2, j], r = r, lo = ci[1], hi = ci[2], p = 2 * pt(-abs(tstat), n - 2), n = n)',
        '}))',
        'results$q_BH <- p.adjust(results$p, method = "BH")  # Benjamini-Hochberg across the pairs',
        'results <- results[c("a", "b", "r", "lo", "hi", "p", "q_BH", "n")]',
        'print(results, digits = 4)');
    } else if (a === 'cooccur') {
      D.push(`vars <- ${rvec(s.variables)}`, '# Rows where every action is observed, as the lab', 'd <- d[complete.cases(d[vars]), ]');
      A.push(`threshold <- ${num(s.threshold)}`, 'active <- sapply(vars, function(v) d[[v]] >= threshold)  # an action is active when its value is >= threshold',
        'pairs <- combn(vars, 2)',
        'results <- do.call(rbind, lapply(seq_len(ncol(pairs)), function(j) {',
        '  A <- active[, pairs[1, j]]; B <- active[, pairs[2, j]]',
        '  n11 <- as.numeric(sum(A & B)); n10 <- as.numeric(sum(A & !B)); n01 <- as.numeric(sum(!A & B)); n00 <- as.numeric(sum(!A & !B))',
        '  # odds ratio with a Woolf CI; 0.5 is added to every cell when a cell is 0 (Haldane-Anscombe), as the lab',
        '  cc <- c(n11, n10, n01, n00) + if (min(n11, n10, n01, n00) == 0) 0.5 else 0',
        '  lor <- log(cc[1] * cc[4] / (cc[2] * cc[3])); se <- sqrt(sum(1 / cc))',
        '  data.frame(a = pairs[1, j], b = pairs[2, j], n11 = n11, n10 = n10, n01 = n01, n00 = n00,',
        '             jaccard = n11 / (n11 + n10 + n01),',
        '             phi = (n11 * n00 - n10 * n01) / sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00)),',
        '             p_b_given_a = n11 / (n11 + n10), p_a_given_b = n11 / (n11 + n01),',
        '             odds_ratio = exp(lor), or_lo = exp(lor - qnorm(0.975) * se), or_hi = exp(lor + qnorm(0.975) * se),',
        '             p = fisher.test(matrix(c(n11, n01, n10, n00), 2))$p.value)  # two-sided Fisher exact test',
        '}))',
        'results$q_BH <- p.adjust(results$p, method = "BH")  # Benjamini-Hochberg across the pairs',
        'print(results, digits = 4)');
    } else if ((a === 'lmm' || a === 'glmm') && !s.group) {
      A.push('stop("Choose a grouping variable (person, video or session) for the random intercept")');
    } else if (['binary', 'glmm', 'multinomial', 'lmm'].includes(a)) {
      D.push('# Keep rows with no missing value in the variables used (listwise deletion, as the lab)',
        `d <- d[complete.cases(d[${rvec(uniq([s.outcome].concat(s.predictors, s.group ? [s.group] : [])))}]), ]`, 'cat("Rows analysed:", nrow(d), "\\n")');
      let y = s.outcome;
      if (a === 'binary' || a === 'glmm') {
        if (s.positive != null) {
          y = 'y'; const used = new Set(C.text.concat(C.numeric)); while (used.has(y)) y += '_';
          D.push(`# Outcome: 1 when ${one(s.outcome)} is ${q(s.positive)}, 0 otherwise`, `${rc(y)} <- as.integer(${rc(s.outcome)} == ${q(s.positive)})`);
        } else D.push(`# Outcome: ${one(s.outcome)}, already coded 0/1`, `stopifnot(all(${rc(s.outcome)} %in% c(0, 1)))`);
      }
      if (a === 'multinomial') D.push('# Outcome classes in alphabetical order; the first is the reference class, as the lab',
        `${rc(y)} <- factor(${rc(y)}, levels = sort(unique(${rc(y)}), method = "radix"))`);
      const cats = s.predictors.filter(v => s.categorical.includes(v)), nums = s.predictors.filter(v => !s.categorical.includes(v));
      if (cats.length) D.push('# Categorical predictors: treatment coding with the alphabetically first level as reference, as the lab',
        `for (v in ${rvec(cats)}) d[[v]] <- factor(d[[v]], levels = sort(unique(d[[v]]), method = "radix"))`);
      if (s.standardize && nums.length) {
        help(R_ZSCORE);
        D.push('# z-score the numeric predictors in the analysed rows, as the lab: coefficients are per standard deviation',
          `num_pred <- ${rvec(nums)}`, 'd[num_pred] <- lapply(d[num_pred], zscore)');
      }
      const inter = s.interactions.length ? `# ${s.interactions.map(p => p[0] + ':' + p[1]).join(', ')}: product${s.interactions.length > 1 ? 's' : ''} of the ${s.standardize ? 'z-scored ' : ''}predictors` : null;
      if (a === 'binary') {
        if (s.method === 'ml' && s.group) P.push('sandwich', 'lmtest');
        if (s.method === 'firth') P.push('logistf');
        help(R_WALD);
        if (s.method !== 'ml' && s.group) help(R_CR1);
        if (s.method === 'ridge') help(R_RIDGE);
        A.push(...(inter ? [inter] : []), `f <- ${rFormula(y, s.predictors, s.interactions)}`);
        if (s.method === 'firth') A.push('# Firth logistic regression (bias reduction; finite estimates under separation)',
          'm <- logistf(f, data = d, pl = FALSE, control = logistf.control(maxit = 100, lconv = 1e-10, gconv = 1e-10, xconv = 1e-10))',
          'X <- model.matrix(f, d); b <- coef(m); prob <- plogis(drop(X %*% b))',
          '# The lab reports Wald tests with the inverse Fisher information at the Firth estimates',
          '# (summary(m) uses profile penalized likelihood and logistf\'s own covariance instead)',
          'V <- solve(crossprod(X, prob * (1 - prob) * X))');
        else if (s.method === 'ridge') A.push('X <- model.matrix(f, d)', `m <- ridge_logit(X, ${rc(y)}, lambda = 1)`,
          'b <- m$coef; V <- m$vcov; prob <- plogis(drop(X %*% b))');
        else A.push('m <- glm(f, family = binomial, data = d)', 'b <- coef(m)');
        if (s.group) {
          if (s.method === 'ml') A.push(`# Standard errors clustered by ${one(s.group)}: CR1, G/(G-1) x (N-1)/(N-K), as the lab and statsmodels`,
            `V <- vcovCL(m, cluster = ${rc(s.group)}, type = "HC1")`, 'print(coeftest(m, vcov. = V))');
          else A.push(`V <- cr1_vcov((${rc(y)} - prob) * X, V, ${rc(s.group)})  # standard errors clustered by ${one(s.group)} (CR1)`);
        } else if (s.method === 'ml') A.push('V <- vcov(m)', 'print(summary(m))');
        A.push('results <- wald_table(b, V)',
          'results$odds_ratio <- exp(results$estimate); results$or_lo <- exp(results$lo); results$or_hi <- exp(results$hi)',
          'print(results, digits = 4)');
        if (s.standardize) A.push('# Numeric predictors were z-scored: odds ratios are per standard deviation');
      } else if (a === 'glmm') {
        P.push('lme4'); help(R_WALD);
        A.push(...(inter ? [inter] : []), `# Random intercept for ${one(s.group)}; marginal likelihood by adaptive Gauss-Hermite quadrature with 7 nodes, as the lab`,
          `m <- glmer(${rFormula(y, s.predictors, s.interactions, ' + (1 | ' + rs(s.group) + ')')}, data = d, family = binomial, nAGQ = 7)`,
          'print(summary(m))',
          'results <- wald_table(fixef(m), vcov(m))',
          'results$odds_ratio <- exp(results$estimate); results$or_lo <- exp(results$lo); results$or_hi <- exp(results$hi)',
          'print(results, digits = 4)',
          'sigma_u <- as.data.frame(VarCorr(m))$sdcor[1]; aic <- AIC(m)',
          'cat("Random-intercept SD:", sigma_u, " AIC:", aic, "\\n")');
      } else if (a === 'multinomial') {
        P.push('nnet');
        if (s.group) help(R_CR1);
        A.push(...(inter ? [inter] : []), `f <- ${rFormula(y, s.predictors, s.interactions)}`,
          'm <- multinom(f, data = d, Hess = TRUE, maxit = 1000, reltol = 1e-12, MaxNWts = 1e5, trace = FALSE)',
          'b <- as.vector(t(coef(m)))  # class by class, the order of vcov(m)',
          'V <- vcov(m)                # inverse of the information matrix');
        if (s.group) A.push('# Cluster-robust SEs: score contributions (indicator - probability) x predictors, class by class',
          `X <- model.matrix(f, d); P <- fitted(m); Y <- sapply(levels(${rc(y)}), function(l) ${rc(y)} == l) * 1`,
          'scores <- do.call(cbind, lapply(2:ncol(P), function(k) (Y[, k] - P[, k]) * X))',
          `V <- cr1_vcov(scores, V, ${rc(s.group)})  # clustered by ${one(s.group)} (CR1)`);
        A.push('se <- sqrt(diag(V)); z <- b / se',
          'results <- data.frame(class = rep(rownames(coef(m)), each = ncol(coef(m))), term = rep(colnames(coef(m)), nrow(coef(m))),',
          '                      estimate = b, se = se, z = z, p = 2 * pnorm(-abs(z)), lo = b - qnorm(0.975) * se, hi = b + qnorm(0.975) * se,',
          '                      row.names = NULL)',
          'results$rrr <- exp(results$estimate)  # relative risk ratio versus the reference class',
          `cat("Reference class:", levels(${rc(y)})[1], "\\n")`, 'print(results, digits = 4)');
      } else {
        P.push('lmerTest'); help(R_ICC);
        A.push(...(inter ? [inter] : []), `# Linear mixed model, REML, random intercept for ${one(s.group)}`,
          `m <- lmer(${rFormula(y, s.predictors, s.interactions, ' + (1 | ' + rs(s.group) + ')')}, data = d, REML = TRUE)`,
          'print(summary(m))  # Satterthwaite degrees of freedom (lmerTest)',
          '# The lab tests the fixed effects with t statistics on N - p degrees of freedom (more liberal)',
          'b <- fixef(m); se <- sqrt(diag(vcov(m))); df <- nrow(d) - length(b); tstat <- b / se',
          'results <- data.frame(term = names(b), estimate = b, se = se, t = tstat, df = df, p = 2 * pt(-abs(tstat), df),',
          '                      lo = b - qt(0.975, df) * se, hi = b + qt(0.975, df) * se,',
          '                      p_satterthwaite = coef(summary(m))[, "Pr(>|t|)"], row.names = NULL)',
          'print(results, digits = 4)',
          'vc <- as.data.frame(VarCorr(m)); tau2 <- vc$vcov[1]; sigma2 <- vc$vcov[2]  # random-intercept and residual variances',
          `icc <- icc1(${rc(y)}, ${rc(s.group)}); n_groups <- length(unique(${rc(s.group)}))`,
          'cat("Random-intercept variance:", tau2, " residual variance:", sigma2, " unconditional ICC(1):", icc,',
          '    " design effect:", 1 + (nrow(d) / n_groups - 1) * max(0, icc), "\\n")');
      }
    } else if (a === 'cv' || a === 'transfer') {
      const g = s.group, tr = a === 'transfer', need0 = uniq([s.outcome, g, tr ? s.split : null]);
      if (!tr && (!g || s.permutations > 0)) help(R_RNG, R_SHUFFLE);
      help(R_SOFTMAX, R_MLOGIT, R_FITPRED, R_METRICS);
      if (!tr) help(R_CROSSVAL, g ? R_GROUPFOLDS : R_STRATFOLDS);
      D.push(`# Rows with a missing ${orList(need0)} are dropped; each feature set then drops rows with missing features`,
        `d <- d[complete.cases(d[${rvec(need0)}]), ]`,
        `classes <- sort(unique(${rc(s.outcome)}), method = "radix"); K <- length(classes)  # outcome classes, alphabetical`,
        `categorical <- ${s.categorical.length ? rvec(s.categorical) : 'character(0)'}`);
      const settings = `model = ${q(s.model)}, balanced = ${s.balanced ? 'TRUE' : 'FALSE'}, ridge = ${num(s.ridge)}`;
      A.push('# Feature sets: numeric predictors, dummies for categorical predictors and raw products for interactions;',
        '# every feature is z-scored inside each training fold',
        'feature_sets <- list(',
        s.sets.map(fs => `  list(name = ${q(fs.name)}, vars = ${rvec(fs.predictors, '    ')}, formula = ${rFormula(null, fs.predictors, fs.interactions)})`).join(',\n'),
        ')',
        tr ? 'results <- NULL' : 'results <- NULL; cvs <- list(); first <- NULL',
        'for (fs in feature_sets) {',
        '  ds <- d[complete.cases(d[fs$vars]), ]',
        '  for (v in intersect(fs$vars, categorical)) ds[[v]] <- factor(ds[[v]], levels = sort(unique(ds[[v]]), method = "radix"))',
        '  X <- model.matrix(fs$formula, ds)[, -1, drop = FALSE]',
        `  y <- match(${rc(s.outcome, 'ds')}, classes)`);
      if (!tr) {
        A.push(g ? `  folds <- group_folds(${rc(g, 'ds')}, ${s.folds})  # grouped by ${one(g)}` : `  folds <- stratified_folds(y, ${s.folds}, seed = ${s.seed})`,
          `  cv <- cross_validate(X, y, K, folds, ${settings})`,
          '  cvs[[fs$name]] <- cv',
          '  results <- rbind(results, data.frame(feature_set = fs$name, n_features = ncol(X), balanced_accuracy = cv$balanced_accuracy,',
          '    fold_sd = cv$fold_sd, macro_f1 = cv$macro_f1, auc = cv$auc, log_loss = cv$log_loss))',
          '  if (is.null(first)) first <- list(X = X, y = y, folds = folds, cv = cv)', '}',
          '# Majority-class baseline on the rows and folds of the first feature set',
          `base <- cross_validate(first$X, first$y, K, first$folds, model = "majority", balanced = FALSE, ridge = ${num(s.ridge)})`,
          'results <- rbind(results, data.frame(feature_set = "Majority class (baseline)", n_features = 0, balanced_accuracy = base$balanced_accuracy,',
          '  fold_sd = NA, macro_f1 = base$macro_f1, auc = NA, log_loss = NA))',
          'cat("Chance (1 / classes):", 1 / K, "\\n")', 'print(results, digits = 3)',
          'best <- names(cvs)[which.max(sapply(cvs, function(x) x$balanced_accuracy))]',
          'cat("Confusion matrix for", best, "(rows: true, columns: predicted)\\n"); print(cvs[[best]]$confusion)',
          'print(round(diag(prop.table(cvs[[best]]$confusion, 1)), 3))  # per-class recall');
        if (s.permutations > 0) A.push('',
          `# Permutation test for the first feature set: labels permuted across rows with the lab's generator (seed ${s.permSeed}),`,
          '# the whole cross-validation repeated; p = (1 + #{permuted >= observed}) / (1 + B)',
          `B <- ${s.permutations}; rng <- lab_rng(${s.permSeed})`,
          `null_bacc <- vapply(seq_len(B), function(b) cross_validate(first$X, lab_shuffle(first$y, rng), K, first$folds, ${settings})$balanced_accuracy, 0)`,
          'perm <- c(observed = first$cv$balanced_accuracy, null_mean = mean(null_bacc), null_95 = quantile(null_bacc, 0.95, names = FALSE),',
          '          p = (1 + sum(null_bacc >= first$cv$balanced_accuracy - 1e-12)) / (1 + B), B = B)',
          'print(perm)');
      } else {
        A.push(`  train <- ${rc(s.split, 'ds')} == ${q(s.trainLevel)}`,
          `  p1 <- fit_predict(X[train, , drop = FALSE], y[train], X[!train, , drop = FALSE], K, ${settings})  # train on the level, test on the rest`,
          `  p2 <- fit_predict(X[!train, , drop = FALSE], y[!train], X[train, , drop = FALSE], K, ${settings})  # and the reverse`,
          '  results <- rbind(results, data.frame(feature_set = fs$name,',
          '    train_level_test_rest = cv_metrics(y[!train], p1, K)$balanced_accuracy,',
          '    train_rest_test_level = cv_metrics(y[train], p2, K)$balanced_accuracy))', '}',
          `cat("Level:", ${q(s.trainLevel)}, " balanced accuracy; chance is", 1 / K, "\\n")`, 'print(results, digits = 3)');
      }
    } else A.push(`# No code export for analysis "${one(a)}"`);
    return assemble('R', s, P, H, D, A);
  }

  /* ============================== Python ============================== */
  const PY_RNG = [
    'def lab_rng(seed):',
    '    """The lab\'s seeded random number generator (mulberry32), so that folds, permutations and bootstrap',
    '    resamples are the same as in the browser. Returns a function giving numbers in [0, 1)."""',
    '    state = seed % 2**32 or 1',
    '',
    '    def rng():',
    '        nonlocal state',
    '        state = (state + 0x6D2B79F5) % 2**32',
    '        t = ((state ^ (state >> 15)) * (state | 1)) % 2**32',
    '        t = ((t + ((t ^ (t >> 7)) * (t | 61))) % 2**32) ^ t',
    '        return ((t ^ (t >> 14)) % 2**32) / 2**32',
    '    return rng'];
  const PY_SHUFFLE = [
    'def lab_shuffle(values, rng):',
    '    """Fisher-Yates shuffle from the last element down, as the lab."""',
    '    a = list(values)',
    '    for i in range(len(a) - 1, 0, -1):',
    '        j = int(rng() * (i + 1))',
    '        a[i], a[j] = a[j], a[i]',
    '    return np.array(a)'];
  const PY_DESIGN = [
    'def design(d, predictors, categorical, interactions, standardize, intercept=True):',
    '    """The lab\'s design matrix: numeric predictors (z-scored with the n - 1 SD when standardize), treatment',
    '    dummies for categorical predictors with the alphabetically first level as reference, and products of',
    '    numeric predictors for interactions."""',
    '    X = pd.DataFrame(index=d.index)',
    '    if intercept:',
    '        X["(Intercept)"] = 1.0',
    '    for v in predictors:',
    '        if v in categorical:',
    '            for level in sorted(d[v].unique())[1:]:',
    '                X[f"{v}[{level}]"] = (d[v] == level).astype(float)',
    '        else:',
    '            x = d[v].astype(float)',
    '            X[v] = (x - x.mean()) / (x.std() if x.std() > 0 else 1.0) if standardize else x',
    '    for a, b in interactions:',
    '        X[f"{a}:{b}"] = X[a] * X[b]',
    '    return X'];
  const PY_WALD = [
    'def wald_table(b, V, terms):',
    '    """Wald table with normal quantiles, as the lab."""',
    '    b = np.asarray(b, float)',
    '    se = np.sqrt(np.diag(V))',
    '    z = b / se',
    '    return pd.DataFrame({"term": list(terms), "estimate": b, "se": se, "z": z, "p": 2 * norm.sf(np.abs(z)),',
    '                         "lo": b - norm.ppf(0.975) * se, "hi": b + norm.ppf(0.975) * se})'];
  const PY_CR1 = [
    'def cr1_vcov(scores, bread, cluster):',
    '    """Cluster-robust sandwich covariance with the CR1 factor G/(G-1) x (N-1)/(N-K), as the lab and statsmodels."""',
    '    S = pd.DataFrame(scores).groupby(np.asarray(cluster)).sum().to_numpy()  # scores summed within clusters',
    '    N, K = scores.shape',
    '    G = len(S)',
    '    return G / (G - 1) * (N - 1) / (N - K) * bread @ S.T @ S @ bread'];
  const PY_PENLOGIT = [
    'def penalized_logit(X, y, ridge=0.0, firth=False):',
    '    """Logistic regression by Newton-Raphson with step halving, as the lab. ridge adds ridge/2 x the sum of',
    '    squared slopes (the intercept, column 0, is not penalized); firth uses Firth\'s bias-reducing penalty',
    '    (Heinze & Schemper 2002). Returns the coefficients and the inverse (penalized) Fisher information."""',
    '    X, y = np.asarray(X, float), np.asarray(y, float)',
    '    pen = np.r_[0.0, np.full(X.shape[1] - 1, ridge)]',
    '',
    '    def information(b):',
    '        mu = expit(X @ b)',
    '        return X.T @ (X * (mu * (1 - mu))[:, None]) + np.diag(pen), mu',
    '',
    '    def objective(b):',
    '        eta = X @ b',
    '        value = np.sum(y * eta - np.logaddexp(0, eta)) - 0.5 * np.sum(pen * b ** 2)',
    '        return value + 0.5 * np.linalg.slogdet(information(b)[0])[1] if firth else value',
    '',
    '    ybar = np.clip(y.mean(), 1e-6, 1 - 1e-6)',
    '    b = np.zeros(X.shape[1])',
    '    b[0] = np.log(ybar / (1 - ybar))',
    '    value = objective(b)',
    '    for _ in range(100):',
    '        info, mu = information(b)',
    '        info_inv = np.linalg.inv(info)',
    '        r = y - mu',
    '        if firth:',
    '            r = r + np.einsum("ij,jk,ik->i", X, info_inv, X) * mu * (1 - mu) * (0.5 - mu)  # leverages x (1/2 - p)',
    '        step = info_inv @ (X.T @ r - pen * b)',
    '        t = 1.0',
    '        while objective(b + t * step) < value - 1e-12 and t > 1e-9:',
    '            t /= 2',
    '        b = b + t * step',
    '        new = objective(b)',
    '        done = np.max(np.abs(t * step)) < 1e-10 or abs(new - value) < 1e-10 * (abs(new) + 1e-10)',
    '        value = new',
    '        if done:',
    '            break',
    '    return b, np.linalg.inv(information(b)[0])'];
  const PY_BH = [
    'def bh(p):',
    '    """Benjamini-Hochberg q values; missing p values stay missing, as the lab."""',
    '    p = np.asarray(p, float)',
    '    q = np.full(p.shape, np.nan)',
    '    ok = ~np.isnan(p)',
    '    if ok.any():',
    '        q[ok] = multipletests(p[ok], method="fdr_bh")[1]',
    '    return q'];
  const PY_FISHER = [
    'def fisher_p(n11, n10, n01, n00):',
    '    """Two-sided Fisher exact p as R\'s fisher.test and the lab: the summed probability of all tables with',
    '    these margins that are no more likely than the observed one."""',
    '    r1, c1, n = n11 + n10, n11 + n01, n11 + n10 + n01 + n00',
    '    k = np.arange(max(0, c1 - (n01 + n00)), min(r1, c1) + 1)',
    '    pk = hypergeom.pmf(k, n, r1, c1)',
    '    return min(1.0, pk[pk <= hypergeom.pmf(n11, n, r1, c1) * (1 + 1e-7)].sum())'];
  const PY_ICC = [
    'def icc1(y, g):',
    '    """Unconditional ICC(1) from one-way ANOVA with the n0 adjustment for unequal group sizes, as the lab."""',
    '    y = pd.Series(np.asarray(y, float))',
    '    groups = y.groupby(np.asarray(g))',
    '    N, G, n_g = len(y), groups.ngroups, groups.size()',
    '    msb = np.sum(n_g * (groups.mean() - y.mean()) ** 2) / (G - 1)',
    '    msw = np.sum((y - groups.transform("mean")) ** 2) / (N - G)',
    '    n0 = (N - np.sum(n_g ** 2) / N) / (G - 1)',
    '    return (msb - msw) / (msb + (n0 - 1) * msw)'];
  const PY_GLSV = [
    'def fixed_effect_vcov(X, groups, tau2, sigma2):',
    '    """Covariance of the fixed effects given the variance components, (X\' V^-1 X)^-1 with V = sigma2 I + tau2 J',
    '    within each group: what lme4 and the lab report (statsmodels\' bse_fe also differentiates through the',
    '    variance parameters, which changes the SEs slightly)."""',
    '    X, groups = np.asarray(X, float), np.asarray(groups)',
    '    A = np.zeros((X.shape[1], X.shape[1]))',
    '    for g in pd.unique(groups):',
    '        Xg = X[groups == g]',
    '        s = Xg.sum(axis=0)',
    '        A += (Xg.T @ Xg - tau2 / (sigma2 + len(Xg) * tau2) * np.outer(s, s)) / sigma2',
    '    return np.linalg.inv(A)'];
  const PY_GLMM = [
    'def glmm_negloglik(theta, X, y, gid, nodes, weights):',
    '    """Minus the marginal log-likelihood of a random-intercept logistic model; each group\'s random intercept',
    '    is integrated out by adaptive Gauss-Hermite quadrature, as the lab and lme4::glmer(nAGQ = 7).',
    '    theta = (coefficients, log SD of the random intercept)."""',
    '    beta, sigma, G = theta[:-1], np.exp(theta[-1]), gid.max() + 1',
    '    eta = X @ beta',
    '    u = np.zeros(G)',
    '    for _ in range(50):  # Newton steps to the mode of each group\'s integrand',
    '        m = expit(eta + sigma * u[gid])',
    '        grad = sigma * np.bincount(gid, y - m, G) - u',
    '        hess = -sigma ** 2 * np.bincount(gid, m * (1 - m), G) - 1',
    '        step = grad / hess',
    '        u = u - step',
    '        if np.max(np.abs(step)) < 1e-10:',
    '            break',
    '    s = 1 / np.sqrt(-hess)',
    '    terms = []',
    '    for x_k, w_k in zip(nodes, weights):',
    '        u_k = u + np.sqrt(2) * s * x_k',
    '        lin = eta + sigma * u_k[gid]',
    '        terms.append(np.log(w_k) + np.bincount(gid, y * lin - np.logaddexp(0, lin), G) - u_k ** 2 / 2 + x_k ** 2)',
    '    return -np.sum(logsumexp(terms, axis=0) + np.log(np.sqrt(2) * s) - 0.5 * np.log(2 * np.pi))'];
  const PY_SOFTMAX = [
    'def softmax(E):',
    '    E = np.exp(E - E.max(axis=1, keepdims=True))',
    '    return E / E.sum(axis=1, keepdims=True)'];
  const PY_MLOGIT = [
    'def fit_mlogit(X, y, K, w, ridge):',
    '    """Multinomial logistic regression with the first class as reference, case weights w and a ridge penalty',
    '    (ridge/2 x sum of squared slopes; intercepts are not penalized), by Newton-Raphson with step halving, as',
    '    the lab. Returns the p x K coefficient matrix (the reference column is 0)."""',
    '    n, p = X.shape',
    '    Y = np.eye(K)[y]',
    '    pen = np.tile(np.r_[0.0, np.full(p - 1, ridge)], K - 1)',
    '',
    '    def coefs(b):',
    '        return np.column_stack([np.zeros(p), b.reshape(K - 1, p).T])',
    '',
    '    def loglik(b):',
    '        E = X @ coefs(b)',
    '        return np.sum(w * (E[np.arange(n), y] - logsumexp(E, axis=1))) - 0.5 * np.sum(pen * b ** 2)',
    '',
    '    b = np.zeros(p * (K - 1))',
    '    ll = loglik(b)',
    '    for _ in range(100):',
    '        P = softmax(X @ coefs(b))',
    '        g = (X.T @ (w[:, None] * (Y - P)))[:, 1:].T.ravel() - pen * b',
    '        H = np.zeros((len(b), len(b)))',
    '        for a in range(1, K):',
    '            for c in range(1, K):',
    '                H[(a - 1) * p:a * p, (c - 1) * p:c * p] = X.T @ (X * (w * P[:, a] * ((a == c) - P[:, c]))[:, None])',
    '        step = np.linalg.solve(H + np.diag(pen), g)',
    '        t = 1.0',
    '        while True:',
    '            b_new = b + t * step',
    '            ll_new = loglik(b_new)',
    '            if ll_new >= ll - 1e-12 or t < 1e-9:',
    '                break',
    '            t /= 2',
    '        done = np.max(np.abs(t * step)) < 1e-10 or abs(ll_new - ll) < 1e-10 * (abs(ll_new) + 1e-10)',
    '        b, ll = b_new, ll_new',
    '        if done:',
    '            break',
    '    return coefs(b)'];
  const PY_FITPRED = [
    'def fit_predict(Xtr, ytr, Xte, K, model, balanced, ridge):',
    '    """One training/test split as in the lab: z-score the features with the training means and SDs, weight the',
    '    classes n / (classes x class count) when balanced, fit, and return class probabilities for the test rows.',
    '    The majority model predicts the class frequencies of the training rows (no weights)."""',
    '    mu, sd = Xtr.mean(axis=0), Xtr.std(axis=0, ddof=1)',
    '    sd[~(sd > 0)] = 1.0',
    '    Xtr = np.column_stack([np.ones(len(Xtr)), (Xtr - mu) / sd])',
    '    Xte = np.column_stack([np.ones(len(Xte)), (Xte - mu) / sd])',
    '    count = np.bincount(ytr, minlength=K)',
    '    if model == "majority" or Xtr.shape[1] == 1:',
    '        return np.tile((count + 1e-9) / (count.sum() + K * 1e-9), (len(Xte), 1))',
    '    w = len(ytr) / ((count > 0).sum() * count[ytr]) if balanced else np.ones(len(ytr))',
    '    return softmax(Xte @ fit_mlogit(Xtr, ytr, K, w, ridge))'];
  const PY_METRICS = [
    'def cv_metrics(y, prob, K):',
    '    """The lab\'s metrics: predicted class = most probable (first on ties); balanced accuracy and macro-F1 over',
    '    the classes present in y; one-vs-rest AUC averaged over classes; log loss."""',
    '    pred = prob.argmax(axis=1)',
    '    present = np.unique(y)',
    '    recall = [np.mean(pred[y == k] == k) for k in present]',
    '    f1 = [2 * np.sum((pred == k) & (y == k)) / (np.sum(pred == k) + np.sum(y == k)) for k in present]',
    '    auc = [roc_auc_score(y == k, prob[:, k]) for k in (range(1) if K == 2 else range(K)) if 0 < np.sum(y == k) < len(y)]',
    '    return {"balanced_accuracy": np.mean(recall), "macro_f1": np.mean(f1), "auc": np.mean(auc) if auc else np.nan,',
    '            "log_loss": -np.mean(np.log(np.clip(prob[np.arange(len(y)), y], 1e-15, 1 - 1e-15))),',
    '            "confusion": pd.DataFrame(confusion_matrix(y, pred, labels=range(K)), index=classes, columns=classes)}'];
  const PY_CROSSVAL = [
    'def cross_validate(X, y, K, folds, model, balanced, ridge):',
    '    """Out-of-fold predictions for every fold; pooled metrics plus the SD of the per-fold balanced accuracy."""',
    '    prob = np.zeros((len(y), K))',
    '    fold_bacc = []',
    '    for f in np.unique(folds):',
    '        te = folds == f',
    '        prob[te] = fit_predict(X[~te], y[~te], X[te], K, model, balanced, ridge)',
    '        fold_bacc.append(cv_metrics(y[te], prob[te], K)["balanced_accuracy"])',
    '    return {**cv_metrics(y, prob, K), "fold_sd": np.std(fold_bacc, ddof=1)}'];
  const PY_GROUPFOLDS = [
    'def group_folds(g, k):',
    '    """The lab\'s grouped folds (as scikit-learn GroupKFold): groups sorted by size, largest first (ties by name),',
    '    each put in the fold with the fewest rows so far, so no group is in two folds."""',
    '    size = pd.Series(g).value_counts()',
    '    k = min(k, len(size))',
    '    rows, fold_of = np.zeros(k), {}',
    '    for name in sorted(size.index, key=lambda s: (-size[s], s)):',
    '        f = int(np.argmin(rows))',
    '        rows[f] += size[name]',
    '        fold_of[name] = f',
    '    return np.array([fold_of[v] for v in g])'];
  const PY_STRATFOLDS = [
    'def stratified_folds(y, k, seed):',
    '    """The lab\'s stratified folds without groups: the rows of each class (classes in order of appearance) are',
    '    shuffled with the lab\'s generator and dealt to the folds in turn."""',
    '    rng = lab_rng(seed)',
    '    fold = np.zeros(len(y), int)',
    '    offset = 0',
    '    for cl in pd.unique(y):',
    '        ids = lab_shuffle(np.flatnonzero(y == cl), rng)',
    '        fold[ids] = (np.arange(len(ids)) + offset) % k',
    '        offset += len(ids)',
    '    return fold'];
  const pyBoot = s => [
    `def cluster_boot_ci(x, cluster, B=${s.bootstrap}, seed=${s.bootSeed}):`,
    '    """95% interval of the mean: cluster bootstrap resampling whole groups (percentile interval), drawn with',
    '    the lab\'s generator so that the limits match the browser."""',
    '    rng = lab_rng(seed)',
    '    rows = [np.flatnonzero(cluster == c) for c in pd.unique(cluster)]  # rows of each group, in order of appearance',
    '    G = len(rows)',
    '    means = [x[np.concatenate([rows[int(rng() * G)] for _ in range(G)])].mean() for _ in range(B)]',
    '    return np.quantile(means, [0.025, 0.975])'];

  function pyRead(s, C) {
    const sep = /\.(tsv|tab)$/i.test(s.file) ? ', sep="\\t"' : '';
    const L = ['# Read the data as the lab does: every field as text; blank, NA, NaN and null are missing',
      `d = pd.read_csv(${q(s.file)}${sep}, dtype=str, keep_default_na=False, na_values=${pyl(NA)})`];
    if (C.numeric.length) L.push('# Numeric columns: anything that is not a number becomes missing, as in the lab',
      wrap('num = [', C.numeric.map(q), ']', '       '), 'd[num] = d[num].apply(pd.to_numeric, errors="coerce")');
    return L;
  }

  function python(spec) {
    const s = norm(spec), a = s.analysis, C = columns(s), H = [], D = pyRead(s, C), A = [];
    const imp = ['import numpy as np', 'import pandas as pd'], pk = ['pandas', 'numpy'];
    const use = (line, pkg) => { if (!imp.includes(line)) imp.push(line); if (pkg && !pk.includes(pkg)) pk.push(pkg); };
    const help = (...blocks) => blocks.forEach(b => { if (!H.includes(b)) H.push(b); });
    if (lacking(s).length) A.push(`# No code: the analysis specification lacks ${lacking(s).join(', ')}`);
    else if (a === 'describe') {
      const g = s.group;
      D.push('# Rows with a missing value are dropped', `d = d.dropna(subset=${pyl(uniq([s.variable, s.by, g]))}).reset_index(drop=True)`);
      if (g) help(PY_RNG, pyBoot(s));
      A.push(`# n, mean, SD, median and 95% CI of ${one(s.variable)} for each level of ${one(s.by)} (levels in alphabetical order)`,
        'out = []', `for level in sorted(${pc(s.by)}.unique()):`, `    sub = d[${pc(s.by)} == level]`, `    x = ${pc(s.variable, 'sub')}.to_numpy()`,
        g ? `    lo, hi = cluster_boot_ci(x, ${pc(g, 'sub')}.to_numpy()) if len(x) > 2 else (np.nan, np.nan)  # resamples ${one(g)}`
          : '    lo, hi = x.mean() + np.array([-1, 1]) * 1.96 * x.std(ddof=1) / np.sqrt(len(x)) if len(x) > 2 else (np.nan, np.nan)  # normal approximation',
        '    out.append({"level": level, "n": len(x), "mean": x.mean(), "sd": x.std(ddof=1), "median": np.median(x), "lo95": lo, "hi95": hi})',
        'results = pd.DataFrame(out)', 'print(results.to_string(index=False))');
      if (!g) A.push('# Rows are treated as independent; with several rows per person, set a grouping variable in the lab');
    } else if (a === 'compare') {
      use('from scipy.stats import kruskal', 'scipy'); use('from statsmodels.stats.multitest import multipletests', 'statsmodels'); help(PY_BH);
      D.push('# Rows without a group are dropped; each variable then uses the rows where it is observed, as the lab', `d = d.dropna(subset=${pyl([s.by])})`);
      A.push(`variables = ${pyl(s.variables)}`,
        '# Kruskal-Wallis test per variable (H corrected for ties), epsilon squared = H / (n - 1), and group means',
        'out = []', 'for v in variables:', '    sub = d.dropna(subset=[v])',
        `    groups = [g[v].to_numpy() for _, g in sub.groupby(${q(s.by)})]`,
        '    H, p = kruskal(*groups)',
        '    out.append({"variable": v, "H": H, "df": len(groups) - 1, "p": p, "epsilon2": H / (len(sub) - 1),',
        `                **{f"mean_{k}": m for k, m in sub.groupby(${q(s.by)})[v].mean().items()}})`,
        'results = pd.DataFrame(out)',
        'results.insert(4, "q_BH", bh(results["p"]))  # Benjamini-Hochberg across the variables',
        'print(results.to_string(index=False))',
        '# Rows are treated as independent: with several rows per person the p values are too small (see the lab note)');
    } else if (a === 'correlate') {
      use(`from scipy.stats import norm, ${s.spearman ? 'spearmanr' : 'pearsonr'}`, 'scipy'); use('from itertools import combinations');
      use('from statsmodels.stats.multitest import multipletests', 'statsmodels'); help(PY_BH);
      D.push('# Each pair of variables uses the rows where both are observed, as the lab');
      A.push(`variables = ${pyl(s.variables)}`,
        s.spearman ? '# Spearman correlation; p from the t approximation (scipy, as the lab); 95% CI by Fisher\'s z with the'
          : '# Pearson correlation; p from the t test and 95% CI by Fisher\'s z',
        ...(s.spearman ? ['# Bonett-Wright (2000) standard error'] : []),
        'out = []', 'for a, b in combinations(variables, 2):', '    sub = d[[a, b]].dropna()', '    n = len(sub)',
        `    r, p = ${s.spearman ? 'spearmanr' : 'pearsonr'}(sub[a], sub[b])`,
        s.spearman ? '    se = np.sqrt((1 + r ** 2 / 2) / (n - 3))' : '    se = 1 / np.sqrt(n - 3)',
        '    lo, hi = np.tanh(np.arctanh(r) + np.array([-1, 1]) * norm.ppf(0.975) * se)',
        '    out.append({"a": a, "b": b, "r": r, "lo": lo, "hi": hi, "p": p, "n": n})',
        'results = pd.DataFrame(out)',
        'results.insert(6, "q_BH", bh(results["p"]))  # Benjamini-Hochberg across the pairs',
        'print(results.to_string(index=False))');
    } else if (a === 'cooccur') {
      use('from scipy.stats import hypergeom, norm', 'scipy'); use('from itertools import combinations');
      use('from statsmodels.stats.multitest import multipletests', 'statsmodels'); help(PY_BH, PY_FISHER);
      D.push(`variables = ${pyl(s.variables)}`, '# Rows where every action is observed, as the lab', 'd = d.dropna(subset=variables).reset_index(drop=True)');
      A.push(`threshold = ${num(s.threshold)}`, 'active = d[variables] >= threshold  # an action is active when its value is >= threshold',
        'out = []', 'for a, b in combinations(variables, 2):', '    A, B = active[a].to_numpy(), active[b].to_numpy()',
        '    n11, n10, n01, n00 = (int(np.sum(m)) for m in (A & B, A & ~B, ~A & B, ~A & ~B))',
        '    # odds ratio with a Woolf CI; 0.5 is added to every cell when a cell is 0 (Haldane-Anscombe), as the lab',
        '    cc = np.array([n11, n10, n01, n00], float) + (0.5 if min(n11, n10, n01, n00) == 0 else 0.0)',
        '    lor, se = np.log(cc[0] * cc[3] / (cc[1] * cc[2])), np.sqrt(np.sum(1 / cc))',
        '    den = np.sqrt(float(n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00))',
        '    out.append({"a": a, "b": b, "n11": n11, "n10": n10, "n01": n01, "n00": n00,',
        '                "jaccard": n11 / (n11 + n10 + n01) if n11 + n10 + n01 else np.nan,',
        '                "phi": (n11 * n00 - n10 * n01) / den if den > 0 else np.nan,',
        '                "p_b_given_a": n11 / (n11 + n10) if n11 + n10 else np.nan, "p_a_given_b": n11 / (n11 + n01) if n11 + n01 else np.nan,',
        '                "odds_ratio": np.exp(lor), "or_lo": np.exp(lor - norm.ppf(0.975) * se), "or_hi": np.exp(lor + norm.ppf(0.975) * se),',
        '                "p": fisher_p(n11, n10, n01, n00)})',
        'results = pd.DataFrame(out)',
        'results["q_BH"] = bh(results["p"])  # Benjamini-Hochberg across the pairs',
        'print(results.to_string(index=False))');
    } else if ((a === 'lmm' || a === 'glmm') && !s.group) {
      A.push('raise SystemExit("Choose a grouping variable (person, video or session) for the random intercept")');
    } else if (['binary', 'glmm', 'multinomial', 'lmm'].includes(a)) {
      if (!(a === 'binary' && s.method !== 'ml')) use('import statsmodels.api as sm', 'statsmodels');
      help(PY_DESIGN);
      D.push('# Keep rows with no missing value in the variables used (listwise deletion, as the lab)',
        `d = d.dropna(subset=${pyl(uniq([s.outcome].concat(s.predictors, s.group ? [s.group] : [])))}).reset_index(drop=True)`, 'print("Rows analysed:", len(d))');
      if (a === 'binary' || a === 'glmm') {
        if (s.positive != null) D.push(`y = (${pc(s.outcome)} == ${q(s.positive)}).astype(float)  # outcome: 1 when ${one(s.outcome)} is ${q(s.positive)}, 0 otherwise`);
        else D.push(`y = ${pc(s.outcome)}.astype(float)  # outcome, already coded 0/1`, 'assert y.isin([0, 1]).all()');
      } else if (a === 'multinomial') D.push(`classes = sorted(${pc(s.outcome)}.unique())  # the first (alphabetically) is the reference class, as the lab`,
        `y = ${pc(s.outcome)}.map({c: k for k, c in enumerate(classes)})`);
      else D.push(`y = ${pc(s.outcome)}`);
      const cats = s.predictors.filter(v => s.categorical.includes(v));
      D.push(`# Design matrix as the lab: ${s.standardize ? 'z-scored numeric predictors, ' : ''}dummies with the alphabetically first level as reference${s.interactions.length ? ', products of the ' + (s.standardize ? 'z-scored ' : '') + 'predictors for interactions' : ''}`,
        `X = design(d, predictors=${pyl(s.predictors, '               ')},`,
        `           categorical=${pyl(cats)}, interactions=${pyPairs(s.interactions)}, standardize=${s.standardize ? 'True' : 'False'})`);
      const grp = s.group ? `pd.factorize(${pc(s.group)})[0]` : null;
      if (a === 'binary') {
        use('from scipy.stats import norm', 'scipy'); help(PY_WALD);
        if (s.method === 'ml') {
          A.push(s.group ? `m = sm.Logit(y, X).fit(disp=0, cov_type="cluster", cov_kwds={"groups": ${grp}})  # CR1 standard errors clustered by ${one(s.group)}`
            : 'm = sm.Logit(y, X).fit(disp=0)', 'print(m.summary())', 'results = wald_table(m.params, m.cov_params(), X.columns)');
        } else {
          use('from scipy.special import expit'); help(PY_PENLOGIT);
          if (s.group) help(PY_CR1);
          A.push(s.method === 'firth' ? 'b, V = penalized_logit(X, y, firth=True)  # Firth: Wald tests with the inverse Fisher information, as the lab'
            : 'b, V = penalized_logit(X, y, ridge=1.0)  # ridge, lambda = 1: inverse penalized information, as the lab');
          if (s.group) A.push(`V = cr1_vcov(X.to_numpy() * (y.to_numpy() - expit(X.to_numpy() @ b))[:, None], V, ${pc(s.group)})  # clustered by ${one(s.group)} (CR1)`);
          A.push('results = wald_table(b, V, X.columns)');
        }
        A.push('results["odds_ratio"], results["or_lo"], results["or_hi"] = np.exp(results["estimate"]), np.exp(results["lo"]), np.exp(results["hi"])',
          'print(results.to_string(index=False))');
        if (s.standardize) A.push('# Numeric predictors were z-scored: odds ratios are per standard deviation');
      } else if (a === 'multinomial') {
        use('from scipy.stats import norm', 'scipy');
        A.push(`m = sm.MNLogit(y, X).fit(disp=0, method="newton", maxiter=200${s.group ? `, cov_type="cluster", cov_kwds={"groups": ${grp}})  # CR1, clustered by ${one(s.group)}` : ')'}`,
          'print(m.summary())',
          'results = pd.concat([pd.DataFrame({"class": c, "term": X.columns, "estimate": m.params.iloc[:, k].to_numpy(), "se": m.bse.iloc[:, k].to_numpy()})',
          '                     for k, c in enumerate(classes[1:])], ignore_index=True)',
          'results["z"] = results["estimate"] / results["se"]',
          'results["p"] = 2 * norm.sf(results["z"].abs())',
          'results["lo"] = results["estimate"] - norm.ppf(0.975) * results["se"]',
          'results["hi"] = results["estimate"] + norm.ppf(0.975) * results["se"]',
          'results["rrr"] = np.exp(results["estimate"])  # relative risk ratio versus the reference class',
          'print("Reference class:", classes[0])', 'print(results.to_string(index=False))');
      } else if (a === 'lmm') {
        use('from scipy.stats import t as t_dist', 'scipy'); help(PY_ICC, PY_GLSV);
        A.push(`# Linear mixed model, REML, random intercept for ${one(s.group)}`,
          `m = sm.MixedLM(y, X, groups=${pc(s.group)}).fit(reml=True)`, 'print(m.summary())',
          'tau2, sigma2 = float(m.cov_re.iloc[0, 0]), float(m.scale)  # random-intercept and residual variances',
          `b, se = m.fe_params.to_numpy(), np.sqrt(np.diag(fixed_effect_vcov(X, ${pc(s.group)}, tau2, sigma2)))`,
          '# The lab tests the fixed effects with t statistics on N - p degrees of freedom (lmerTest uses Satterthwaite)',
          'df = len(d) - X.shape[1]', 'tstat = b / se',
          'results = pd.DataFrame({"term": X.columns, "estimate": b, "se": se, "t": tstat, "df": df, "p": 2 * t_dist.sf(np.abs(tstat), df),',
          '                        "lo": b - t_dist.ppf(0.975, df) * se, "hi": b + t_dist.ppf(0.975, df) * se})',
          'print(results.to_string(index=False))',
          `icc = icc1(y, ${pc(s.group)})`, `n_groups = ${pc(s.group)}.nunique()`,
          'print("Random-intercept variance:", tau2, " residual variance:", sigma2, " unconditional ICC(1):", icc,',
          '      " design effect:", 1 + (len(d) / n_groups - 1) * max(0, icc))');
      } else {
        use('from scipy.stats import norm', 'scipy'); use('from scipy.optimize import minimize'); use('from scipy.special import expit, logsumexp');
        use('from statsmodels.tools.numdiff import approx_hess3'); help(PY_GLMM, PY_WALD);
        A.push(`# Random-intercept logistic model for ${one(s.group)}, maximum likelihood with 7-node adaptive Gauss-Hermite quadrature`,
          `args = (X.to_numpy(), y.to_numpy(), pd.factorize(${pc(s.group)})[0], *np.polynomial.hermite.hermgauss(7))`,
          'start = np.r_[sm.Logit(y, X).fit(disp=0).params, np.log(0.5)]  # logistic regression, random-intercept SD 0.5',
          'fit = minimize(glmm_negloglik, start, args=args, method="BFGS", options={"gtol": 1e-6, "maxiter": 1000})',
          'V = np.linalg.inv(approx_hess3(fit.x, glmm_negloglik, args=args))  # SEs from the numerical Hessian, as the lab',
          'results = wald_table(fit.x[:-1], V[:-1, :-1], X.columns)',
          'results["odds_ratio"], results["or_lo"], results["or_hi"] = np.exp(results["estimate"]), np.exp(results["lo"]), np.exp(results["hi"])',
          'print(results.to_string(index=False))',
          'sigma_u, aic = np.exp(fit.x[-1]), 2 * fit.fun + 2 * len(fit.x)',
          'print("Random-intercept SD:", sigma_u, " AIC:", aic)');
      }
    } else if (a === 'cv' || a === 'transfer') {
      const g = s.group, tr = a === 'transfer', need0 = uniq([s.outcome, g, tr ? s.split : null]);
      use('from scipy.special import logsumexp', 'scipy'); use('from sklearn.metrics import confusion_matrix, roc_auc_score', 'scikit-learn');
      if (!tr && (!g || s.permutations > 0)) help(PY_RNG, PY_SHUFFLE);
      help(PY_DESIGN, PY_SOFTMAX, PY_MLOGIT, PY_FITPRED, PY_METRICS);
      if (!tr) help(PY_CROSSVAL, g ? PY_GROUPFOLDS : PY_STRATFOLDS);
      D.push(`# Rows with a missing ${orList(need0)} are dropped; each feature set then drops rows with missing features`,
        `d = d.dropna(subset=${pyl(need0)}).reset_index(drop=True)`,
        `classes = sorted(${pc(s.outcome)}.unique())  # outcome classes, alphabetical`, 'K = len(classes)',
        `categorical = ${pyl(s.categorical)}`);
      const settings = `model=${q(s.model)}, balanced=${s.balanced ? 'True' : 'False'}, ridge=${num(s.ridge)}`;
      A.push('# Feature sets: numeric predictors, dummies for categorical predictors and raw products for interactions;',
        '# every feature is z-scored inside each training fold',
        'feature_sets = [',
        s.sets.map(fs => `    {"name": ${q(fs.name)}, "predictors": ${pyl(fs.predictors, '                   ')}, "interactions": ${pyPairs(fs.interactions)}}`).join(',\n'),
        ']',
        tr ? 'out = []' : 'out, cvs, first = [], {}, None',
        'for fs in feature_sets:',
        '    ds = d.dropna(subset=fs["predictors"]).reset_index(drop=True)',
        '    X = design(ds, fs["predictors"], categorical, fs["interactions"], standardize=False, intercept=False).to_numpy()',
        `    y = ${pc(s.outcome, 'ds')}.map({c: k for k, c in enumerate(classes)}).to_numpy()`);
      if (!tr) {
        A.push(g ? `    folds = group_folds(${pc(g, 'ds')}.to_numpy(), ${s.folds})  # grouped by ${one(g)}` : `    folds = stratified_folds(y, ${s.folds}, seed=${s.seed})`,
          `    cv = cross_validate(X, y, K, folds, ${settings})`, '    cvs[fs["name"]] = cv',
          '    out.append({"feature_set": fs["name"], "n_features": X.shape[1], "balanced_accuracy": cv["balanced_accuracy"],',
          '                "fold_sd": cv["fold_sd"], "macro_f1": cv["macro_f1"], "auc": cv["auc"], "log_loss": cv["log_loss"]})',
          '    if first is None:', '        first = (X, y, folds, cv)',
          '# Majority-class baseline on the rows and folds of the first feature set',
          `base = cross_validate(first[0], first[1], K, first[2], model="majority", balanced=False, ridge=${num(s.ridge)})`,
          'out.append({"feature_set": "Majority class (baseline)", "n_features": 0, "balanced_accuracy": base["balanced_accuracy"],',
          '            "macro_f1": base["macro_f1"]})',
          'results = pd.DataFrame(out)', 'print("Chance (1 / classes):", 1 / K)', 'print(results.round(3).to_string(index=False))',
          'best = max(cvs, key=lambda k: cvs[k]["balanced_accuracy"])',
          'print("Confusion matrix for", best, "(rows: true, columns: predicted)")', 'print(cvs[best]["confusion"])',
          'conf = cvs[best]["confusion"].to_numpy()',
          'print("Per-class recall:", dict(zip(classes, np.round(np.diag(conf) / conf.sum(axis=1), 3))))');
        if (s.permutations > 0) A.push('',
          `# Permutation test for the first feature set: labels permuted across rows with the lab's generator (seed ${s.permSeed}),`,
          '# the whole cross-validation repeated; p = (1 + #{permuted >= observed}) / (1 + B)',
          `B, rng = ${s.permutations}, lab_rng(${s.permSeed})`,
          `null_bacc = np.array([cross_validate(first[0], lab_shuffle(first[1], rng), K, first[2], ${settings})["balanced_accuracy"] for _ in range(B)])`,
          'observed = first[3]["balanced_accuracy"]',
          'perm = {"observed": observed, "null_mean": null_bacc.mean(), "null_95": np.quantile(null_bacc, 0.95),',
          '        "p": (1 + np.sum(null_bacc >= observed - 1e-12)) / (1 + B), "B": B}', 'print(perm)');
      } else {
        A.push(`    train = (${pc(s.split, 'ds')} == ${q(s.trainLevel)}).to_numpy()`,
          `    p1 = fit_predict(X[train], y[train], X[~train], K, ${settings})  # train on the level, test on the rest`,
          `    p2 = fit_predict(X[~train], y[~train], X[train], K, ${settings})  # and the reverse`,
          '    out.append({"feature_set": fs["name"], "train_level_test_rest": cv_metrics(y[~train], p1, K)["balanced_accuracy"],',
          '                "train_rest_test_level": cv_metrics(y[train], p2, K)["balanced_accuracy"]})',
          'results = pd.DataFrame(out)', `print("Level:", ${q(s.trainLevel)}, " balanced accuracy; chance is", 1 / K)`,
          'print(results.round(3).to_string(index=False))');
      }
    } else A.push(`# No code export for analysis "${one(a)}"`);
    pk.imports = imp;
    return assemble('Python', s, pk, H, D, A);
  }

  return {R, python, normalize: norm};
})();

return S;
});

/* ---- src/face3d.js ---- */
/* The face (chosen 22 Oct 2026): a realistic 3D head rendered as a clay sculpt.
 * Model: ICT-FaceKit Light, USC Institute for Creative Technologies (MIT licence). Every FACS action unit drives the
 * model's own expression shapes. Rendered with three.js r160, which the page provides as the global THREE (the face waits for it).
 *   FaceMesh.faceSVG(aus, opt)   an <img> of the face that fills in once rendered (opt.k intensities 0..1.6, opt.crop
 *                                'full' | 'tight' | 'face', opt.size, opt.fluid, opt.title, opt.hls actions to tint)
 *   FaceMesh.draw(kmap, opt)     the same from an intensity map
 *   FaceMesh.mount(el, aus, opt) a live face: set(aus, k, ms), loop(aus, {k, ms}), stop(), destroy(), state;
 *                                opt.callouts with opt.names labels each action where it moves the skin
 *   FaceMesh.ready               resolves once the model has loaded (rejects when WebGL or the data is unavailable) */
const FaceMesh = (function () {
  'use strict';
  // binary files travel as base64 text so any static host serves them
  const SRC = { json: 'ict_web.json', bin: 'ict_web_bin.txt', ao: 'ict_ao_bin.txt' };
  const b64 = t => { const s = atob(t.replace(/\s+/g, '')), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  let BASE = '';                       // where the model files sit, relative to the page (config({ base }))
  const url = f => BASE + f;
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  // camera framing per crop (model units are centimetres; +x is the person's left, +z points out of the face)
  const VIEW = {
    full: { t: [0, 1.0, 3], R: 103, w: 520, h: 640 },
    tight: { t: [0, 1.6, 5], R: 72, w: 300, h: 370 },
    face: { t: [0, -0.5, 6], R: 60, w: 260, h: 320 } };
  const YAW = 14, PITCH = 3, FOV = 16;
  // the clay look
  const LK = { skin: '#c2b3a4', brow: '#8e7e6f', lip: '#b19488', iris: '#8a7a6c', ring: '#665a4f', pupil: '#463d35', sclera: '#cfc3b6', teeth: '#d6cbbd', gums: '#a08a7f',
    rough: 0.86, sheen: 0.15, sss: 0.22, env: 0.38, key: 2.4, fill: 0.38, rim: 1.1, keyColor: '#fff4ea', paint: 0.45, aoK: 1, hot: '#3a6fc4' };
  // actions -> the model's expression shapes (ICT FaceKit follows the ARKit / FACS naming)
  const M = {
    '1': [['browInnerUp_L', 1], ['browInnerUp_R', 1]], '2': [['browOuterUp_L', 1], ['browOuterUp_R', 1]], '4': [['browDown_L', 1], ['browDown_R', 1]],
    '5': [['eyeWide_L', 1], ['eyeWide_R', 1]], '6': [['cheekSquint_L', 1], ['cheekSquint_R', 1]], '7': [['eyeSquint_L', 1], ['eyeSquint_R', 1]],
    '9': [['noseSneer_L', 1], ['noseSneer_R', 1]], '10': [['mouthUpperUp_L', 0.8], ['mouthUpperUp_R', 0.8], ['mouthShrugUpper', 0.5]], '11': [['mouthUpperUp_L', 0.45], ['mouthUpperUp_R', 0.45]],
    '12': [['mouthSmile_L', 1], ['mouthSmile_R', 1]], '13': [['mouthSmile_L', 0.5], ['mouthSmile_R', 0.5], ['cheekPuff_L', 0.25], ['cheekPuff_R', 0.25]], '14': [['mouthDimple_L', 1], ['mouthDimple_R', 1]],
    '15': [['mouthFrown_L', 1], ['mouthFrown_R', 1]], '16': [['mouthLowerDown_L', 1], ['mouthLowerDown_R', 1]], '17': [['mouthShrugLower', 1]], '18': [['mouthPucker', 1]],
    '20': [['mouthStretch_L', 1], ['mouthStretch_R', 1]], '22': [['mouthFunnel', 1]], '23': [['mouthPress_L', 0.6], ['mouthPress_R', 0.6], ['mouthRollUpper', 0.2], ['mouthRollLower', 0.2], ['mouthPucker', 0.15]],
    '24': [['mouthPress_L', 1], ['mouthPress_R', 1]], '25': [['mouthLowerDown_L', 0.55], ['mouthLowerDown_R', 0.55], ['mouthUpperUp_L', 0.15], ['mouthUpperUp_R', 0.15], ['jawOpen', 0.05]],
    '26': [['jawOpen', 0.4]], '27': [['jawOpen', 0.95], ['mouthStretch_L', 0.2], ['mouthStretch_R', 0.2]], '28': [['mouthRollUpper', 1], ['mouthRollLower', 1]], '34': [['cheekPuff_L', 1], ['cheekPuff_R', 1]],
    '41': [['eyeBlink_L', 0.3], ['eyeBlink_R', 0.3]], '42': [['eyeBlink_L', 0.55], ['eyeBlink_R', 0.55], ['eyeSquint_L', 0.3], ['eyeSquint_R', 0.3]], '43': [['eyeBlink_L', 1], ['eyeBlink_R', 1]],
    '44': [['eyeSquint_L', 0.8], ['eyeSquint_R', 0.8], ['eyeBlink_L', 0.15], ['eyeBlink_R', 0.15]], '45': [['eyeBlink_L', 1], ['eyeBlink_R', 1]], '46': [['eyeBlink_L', 1]],
    '61': [['eyeLookOut_L', 1], ['eyeLookIn_R', 1]], '62': [['eyeLookIn_L', 1], ['eyeLookOut_R', 1]], '63': [['eyeLookUp_L', 1], ['eyeLookUp_R', 1]], '64': [['eyeLookDown_L', 1], ['eyeLookDown_R', 1]] };
  // head movements are turns of the whole head (degrees about y, x, z) or a small move toward or away from us
  const POSE = { '51': [0, 16, 0, 0], '52': [0, -16, 0, 0], '53': [-12, 0, 0, 0], '54': [12, 0, 0, 0], '55': [0, 0, -12, 0], '56': [0, 0, 12, 0], '57': [0, 0, 0, 4], '58': [0, 0, 0, -4] };
  const DRAWN = new Set(Object.keys(M).concat(Object.keys(POSE)));

  let core = null, loading = null;
  const hasGL = () => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } };
  async function loadModel() {
    let tries = 0; while (!window.THREE && tries++ < 400) await new Promise(r => setTimeout(r, 50));
    if (!window.THREE) throw new Error('three.js did not load');
    if (!hasGL()) throw new Error('WebGL is not available');
    const [meta, buf, aob] = await Promise.all([fetch(url(SRC.json)).then(r => { if (!r.ok) throw new Error(SRC.json + ' ' + r.status); return r.json(); }),
      fetch(url(SRC.bin)).then(r => { if (!r.ok) throw new Error(SRC.bin + ' ' + r.status); return r.text(); }).then(b64),
      fetch(url(SRC.ao)).then(r => r.ok ? r.text().then(b64) : null).catch(() => null)]);
    const N = meta.vertexCount, q = new Uint16Array(buf, meta.posOffset, N * 3);
    const base = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) base[i * 3 + a] = meta.lo[a] + q[i * 3 + a] * meta.scale[a];
    const index = new Uint16Array(buf, meta.indexOffset, meta.triCount * 3);
    const SH = {}; meta.shapes.forEach(s => { SH[s.name] = { ids: new Uint16Array(buf, s.idOffset, s.n), d: new Int16Array(buf, s.deltaOffset, s.n * 3), sc: s.scale }; });
    const GI = {}; meta.groups.forEach((g, i) => { GI[g.name] = i; });
    const vgroup = new Uint8Array(N); meta.groups.forEach((g, gi) => { for (let k = g.start; k < g.start + g.count; k++) vgroup[index[k]] = gi; });
    const ao = new Float32Array(N).fill(1); if (aob && aob.byteLength === N) { const u = new Uint8Array(aob); for (let i = 0; i < N; i++) ao[i] = u[i] / 255; }
    // iris painted on the outer eyeball shell, by the angle from each eye's gaze axis
    const eyeT = new Float32Array(N).fill(-1);
    ['M_ScleraLeft', 'M_ScleraRight'].forEach(gname => {
      const g = meta.groups[GI[gname]]; const ids = new Set(); for (let k = g.start; k < g.start + g.count; k++) ids.add(index[k]);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let pole = -1, pz = -1e9;
      ids.forEach(i => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], base[i * 3 + a]); hi[a] = Math.max(hi[a], base[i * 3 + a]); } if (base[i * 3 + 2] > pz) { pz = base[i * 3 + 2]; pole = i; } });
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const ax = [base[pole * 3] - c[0], base[pole * 3 + 1] - c[1], base[pole * 3 + 2] - c[2]]; const al = Math.hypot(ax[0], ax[1], ax[2]); ax[0] /= al; ax[1] /= al; ax[2] /= al;
      ids.forEach(i => { const v = [base[i * 3] - c[0], base[i * 3 + 1] - c[1], base[i * 3 + 2] - c[2]]; const vl = Math.hypot(v[0], v[1], v[2]);
        eyeT[i] = Math.acos(Math.max(-1, Math.min(1, (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / vl))) * 180 / Math.PI; });
    });
    const LM = meta.landmarks68.map(i => [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]]);
    // where each action moves the skin most on each side (for callouts)
    const peak = {};
    for (const a of Object.keys(M)) { const dd = new Map();
      for (const [nm, w] of M[a]) { const s = SH[nm]; if (!s) continue; for (let j = 0; j < s.ids.length; j++) { const i = s.ids[j]; if (vgroup[i] !== GI.M_Face) continue; dd.set(i, (dd.get(i) || 0) + w * s.sc * Math.hypot(s.d[j * 3], s.d[j * 3 + 1], s.d[j * 3 + 2])); } }
      const best = { L: [-1, 0], R: [-1, 0], C: [-1, 0] };
      dd.forEach((m, i) => { const x = base[i * 3]; const sd = Math.abs(x) < 0.6 ? 'C' : (x > 0 ? 'L' : 'R'); if (m > best[sd][1]) best[sd] = [i, m]; });
      peak[a] = best; }
    const eyeC = new Float32Array(N * 3); const T = window.THREE;
    for (let i = 0; i < N; i++) if (eyeT[i] >= 0) { const c = eyeColor(T, eyeT[i]); eyeC[i * 3] = c.r; eyeC[i * 3 + 1] = c.g; eyeC[i * 3 + 2] = c.b; }
    return { meta, N, base, index, SH, GI, vgroup, ao, eyeT, eyeC, LM, peak };
  }
  function ready() {
    if (!loading) loading = loadModel().then(m => { core = m; return m; });
    return loading;
  }

  /* ---------------------------------------------------------------- a scene: renderer, lights, the head with its own geometry */
  function roomEnv(T, renderer) {
    // three.js RoomEnvironment (from Google model-viewer): a grey room with soft light panels, prefiltered for image-based lighting
    const scene = new T.Scene(), geo = new T.BoxGeometry(); geo.deleteAttribute('uv');
    const roomMat = new T.MeshStandardMaterial({ side: T.BackSide }), boxMat = new T.MeshStandardMaterial();
    const main = new T.PointLight(0xffffff, 900, 28, 2); main.position.set(0.418, 16.199, 0.3); scene.add(main);
    const add = (mat, p, r, sc) => { const m = new T.Mesh(geo, mat); m.position.set(p[0], p[1], p[2]); if (r) m.rotation.set(0, r, 0); m.scale.set(sc[0], sc[1], sc[2]); scene.add(m); };
    add(roomMat, [-0.757, 13.219, 0.717], 0, [31.713, 28.305, 28.591]);
    [[[-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]], [[-5.607, -0.754, -0.758], 0.994, [1.97, 1.534, 3.955]], [[6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]],
      [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]], [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]], [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]]].forEach(([p, r, sc]) => add(boxMat, p, r, sc));
    const lamp = k => { const m = new T.MeshBasicMaterial(); m.color.setScalar(k); return m; };
    add(lamp(50), [-16.116, 14.37, 8.208], 0, [0.1, 2.428, 2.739]); add(lamp(50), [-16.109, 18.021, -8.207], 0, [0.1, 2.425, 2.751]); add(lamp(17), [14.904, 12.198, -1.832], 0, [0.15, 4.265, 6.331]);
    add(lamp(43), [-0.462, 8.89, 14.52], 0, [4.38, 5.441, 0.088]); add(lamp(20), [3.235, 11.486, -12.541], 0, [2.5, 2, 0.1]); add(lamp(100), [0, 20, 0], 0, [1, 0.1, 1]);
    const pm = new T.PMREMGenerator(renderer); const tex = pm.fromScene(scene, 0.04).texture; pm.dispose(); return tex;
  }
  function buildScene(renderer) {
    const T = window.THREE, m = core;
    const scene = new T.Scene();
    scene.environment = roomEnv(T, renderer);
    const C = h => new T.Color(h);
    const key = new T.DirectionalLight(C(LK.keyColor), LK.key); key.position.set(-26, 30, 34); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04; key.shadow.radius = 9; key.shadow.blurSamples = 20;
    Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 }); scene.add(key);
    const fill = new T.DirectionalLight(0xffffff, LK.fill); fill.position.set(30, 2, 26); scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, LK.rim); rim.position.set(26, 16, -28); scene.add(rim);
    const rim2 = new T.DirectionalLight(0xffffff, LK.rim * 0.6); rim2.position.set(-28, 12, -24); scene.add(rim2);
    const N = m.N;
    const geo = new T.BufferGeometry();
    const pos = new Float32Array(m.base);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('p0', new T.BufferAttribute(new Float32Array(m.base), 3));
    geo.setIndex(new T.BufferAttribute(new Uint32Array(m.index), 1));
    const col = new Float32Array(N * 3).fill(1); geo.setAttribute('color', new T.BufferAttribute(col, 3));
    const mv = new Float32Array(N); geo.setAttribute('mv', new T.BufferAttribute(mv, 1));
    const hot = new Float32Array(N); geo.setAttribute('hot', new T.BufferAttribute(hot, 1));
    m.meta.groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
    const mats = materials(T, m);
    const mesh = new T.Mesh(geo, mats); mesh.castShadow = true; mesh.receiveShadow = true;
    const head = new T.Group(); head.add(mesh); scene.add(head);
    const camera = new T.PerspectiveCamera(FOV, 1, 1, 1000);
    return { T, scene, camera, geo, pos, col, mv, hot, mesh, head, disp: new Float32Array(N * 3) };
  }
  function materials(T, m) {
    const C = h => new T.Color(h);
    const v3 = i => new T.Vector3(m.LM[i][0], m.LM[i][1], m.LM[i][2]);
    const browR = [17, 18, 19, 20, 21].map(v3), browL = [22, 23, 24, 25, 26].map(v3);
    const lipO = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map(i => new T.Vector2(m.LM[i][0], m.LM[i][1]));
    const lipZ = Math.min(...[48, 54, 51, 57].map(i => m.LM[i][2])) - 1.2;
    const U = { uBrowR: { value: browR }, uBrowL: { value: browL }, uLip: { value: lipO }, uLipZ: { value: lipZ }, uBrowC: { value: C(LK.brow) }, uLipC: { value: C(LK.lip) },
      uPaint: { value: LK.paint }, uSSS: { value: LK.sss }, uHot: { value: C(LK.hot) } };
    const GLSL = `
uniform vec3 uBrowR[5]; uniform vec3 uBrowL[5]; uniform vec2 uLip[12]; uniform float uLipZ, uPaint, uSSS, uFace; uniform vec3 uBrowC, uLipC, uHot; varying vec3 vP0; varying float vMv; varying float vHot;
float segD(vec3 p, vec3 a, vec3 b, out float t){ vec3 ab=b-a; t=clamp(dot(p-a,ab)/dot(ab,ab),0.,1.); return length(p-(a+t*ab)); }
float segD2(vec2 p, vec2 a, vec2 b){ vec2 ab=b-a; float t=clamp(dot(p-a,ab)/dot(ab,ab),0.,1.); return length(p-(a+t*ab)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float browMask(vec3 p, vec3 B[5], float side){
  float best=1e3, bt=0.; for(int i=0;i<4;i++){ float t; float d=segD(p - vec3(0.,0.22,0.), B[i], B[i+1], t); if(d<best){best=d; bt=(float(i)+t)/4.;} }
  float inner = side > 0. ? bt : 1.-bt; float th = mix(0.5, 0.16, smoothstep(0.2, 1.0, inner));
  float m = 1. - smoothstep(th*0.35, th*1.05, best);
  float g = hash(floor(vec2((p.x*2.6 - p.y*1.1)*11., (p.y + p.x*0.35)*34.))); float g2 = hash(floor(vec2(p.x*23., p.y*61.)));
  return m * (0.55 + 0.3*g + 0.15*g2); }
float lipMask(vec3 p){ if (p.z < uLipZ) return 0.; vec2 q = p.xy; bool inside=false; float dmin=1e3;
  for(int i=0;i<12;i++){ vec2 a=uLip[i], b=uLip[(i+1)%12]; if(((a.y>q.y)!=(b.y>q.y)) && (q.x < (b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)) inside=!inside; dmin=min(dmin, segD2(q,a,b)); }
  float e = smoothstep(0.0, 0.16, dmin); return inside ? mix(0.55, 1.0, e) : (1.0 - smoothstep(0.0, 0.1, dmin))*0.5; }
vec3 paintSkin(vec3 c){ if (uFace < 0.5) return c; vec3 p = vP0;
  float bm = max(browMask(p, uBrowR, -1.), browMask(p, uBrowL, 1.)); c = mix(c, uBrowC, bm * uPaint * 0.92);
  float lm = lipMask(p); c = mix(c, uLipC, lm * uPaint * 0.85);
  c = mix(c, uHot, smoothstep(0.03, 0.3, vMv) * vHot * 0.55); return c; }`;
    const patch = (mat, face) => {
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U, { uFace: { value: face ? 1 : 0 } });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 p0; attribute float mv; attribute float hot; varying vec3 vP0; varying float vMv; varying float vHot;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP0 = p0; vMv = mv; vHot = hot;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL)
          .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = paintSkin(diffuseColor.rgb);')
          .replace('#include <lights_physical_pars_fragment>', T.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;',
            'vec3 irradiance = dotNL * directLight.color;\n\tfloat wNL = saturate( ( dot( geometryNormal, directLight.direction ) + uSSS ) / ( 1.0 + uSSS ) );\n\tvec3 irrD = wNL * mix( vec3( 1.0, 0.42, 0.32 ), vec3( 1.0 ), smoothstep( 0.0, 0.55, wNL ) ) * directLight.color;')
            .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += irrD * BRDF_Lambert( material.diffuseColor );'));
      };
      mat.customProgramCacheKey = () => 'clay' + (face ? 'f' : 'b');
    };
    const std = o => new T.MeshPhysicalMaterial(Object.assign({ vertexColors: true, envMapIntensity: LK.env }, o));
    const face = std({ color: C(LK.skin), roughness: LK.rough, sheen: LK.sheen, sheenColor: C('#ffffff'), sheenRoughness: 0.55 }); patch(face, true);
    const back = std({ color: C(LK.skin), roughness: LK.rough, sheen: LK.sheen, sheenColor: C('#ffffff'), sheenRoughness: 0.55 }); patch(back, false);
    const hidden = new T.MeshBasicMaterial({ visible: false });
    const mats = m.meta.groups.map(() => hidden);
    mats[m.GI.M_Face] = face; mats[m.GI.M_BackHead] = back;
    mats[m.GI.M_GumsTongue] = std({ color: C(LK.gums), roughness: 0.5 });
    mats[m.GI.M_Teeth] = std({ color: C(LK.teeth), roughness: 0.4, clearcoat: 0.2 });
    const sc = std({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: LK.env * 1.2 });
    mats[m.GI.M_ScleraLeft] = sc; mats[m.GI.M_ScleraRight] = sc;
    return mats;
  }
  const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  function eyeColor(T, t) {
    const pc = new T.Color(LK.pupil), ic = new T.Color(LK.iris), rc = new T.Color(LK.ring), sc = new T.Color(LK.sclera);
    const c = pc.clone().lerp(ic, sm(8.7, 10.9, t)); c.lerp(rc, sm(17.5, 25.5, t) * 0.7); c.lerp(sc, sm(25.8, 28.5, t));
    if (t > 28.5) c.multiplyScalar(1 - 0.12 * sm(40, 95, t));
    return c;
  }
  /* pose the head: expression shapes, shading colours, head turn, camera framing */
  function weights(K) {
    const inf = {};
    for (const [a, k] of Object.entries(K)) for (const [nm, w] of (M[a] || [])) inf[nm] = Math.min(1.25, (inf[nm] || 0) + w * k);
    return inf;
  }
  function pose(S, K, crop, hls, aspect) {
    const T = S.T, m = core, N = m.N, disp = S.disp, pos = S.pos;
    const inf = weights(K);
    disp.fill(0);
    for (const nm in inf) { const s = m.SH[nm]; if (!s) continue; const f = inf[nm] * s.sc;
      for (let j = 0; j < s.ids.length; j++) { const i = s.ids[j] * 3; disp[i] += s.d[j * 3] * f; disp[i + 1] += s.d[j * 3 + 1] * f; disp[i + 2] += s.d[j * 3 + 2] * f; } }
    for (let i = 0; i < N * 3; i++) pos[i] = m.base[i] + disp[i];
    const hotSet = new Set(); (hls || []).forEach(a => (M[a] || []).forEach(([nm]) => hotSet.add(nm)));
    S.hot.fill(0);
    if (hotSet.size) hotSet.forEach(nm => { const s = m.SH[nm]; if (!s) return; for (let j = 0; j < s.ids.length; j++) S.hot[s.ids[j]] = 1; });
    for (let i = 0; i < N; i++) S.mv[i] = Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]);
    S.geo.attributes.position.needsUpdate = true; S.geo.attributes.mv.needsUpdate = true; S.geo.attributes.hot.needsUpdate = true;
    S.geo.computeVertexNormals(); S.geo.computeBoundingSphere();
    // ambient occlusion (baked at rest), the dark mouth socket, painted eyes; teeth and tongue are lighter once they show
    const open = Math.min(1, (inf.jawOpen || 0) * 1.6 + (inf.mouthLowerDown_L || 0) * 0.5 + (inf.mouthUpperUp_L || 0) * 0.4 + (inf.mouthSmile_L || 0) * 0.25);
    const col = S.col, GI = m.GI, vg = m.vgroup;
    for (let i = 0; i < N; i++) {
      let a = Math.pow(Math.max(0, m.ao[i]), 1.35); a = 1 - LK.aoK * (1 - a);
      const g = vg[i];
      if (g === GI.M_Teeth || g === GI.M_GumsTongue) a = lerpN(a, 0.55 + 0.45 * a, open);
      let r = a, gg = a, b = a;
      if (g === GI.M_BackHead) { const x = m.base[i * 3], y = m.base[i * 3 + 1], z = m.base[i * 3 + 2]; if (Math.abs(x) < 4.6 && y > -7.5 && y < 1 && z > 0 && z < 11) { r *= 0.42; gg *= 0.3; b *= 0.3; } }
      if (m.eyeT[i] >= 0) { const ea = 1 - (1 - a) * 0.65; r = ea * m.eyeC[i * 3]; gg = ea * m.eyeC[i * 3 + 1]; b = ea * m.eyeC[i * 3 + 2]; }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    S.geo.attributes.color.needsUpdate = true;
    // head turn, nod, tilt, move
    let ry = 0, rx = 0, rz = 0, dz = 0;
    for (const [a, k] of Object.entries(K)) { const q = POSE[a]; if (q) { rx += q[0] * k; ry += q[1] * k; rz += q[2] * k; dz += q[3] * k; } }
    S.head.rotation.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180); S.head.position.set(0, 0, dz);
    const V = VIEW[crop] || VIEW.full, cam = S.camera;
    const yaw = YAW * Math.PI / 180, pitch = PITCH * Math.PI / 180;
    cam.aspect = aspect || V.w / V.h; cam.fov = FOV;
    cam.position.set(V.t[0] + Math.sin(yaw) * Math.cos(pitch) * V.R, V.t[1] + Math.sin(pitch) * V.R, V.t[2] + Math.cos(yaw) * Math.cos(pitch) * V.R);
    cam.lookAt(V.t[0], V.t[1], V.t[2]); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  const lerpN = (a, b, t) => a + (b - a) * t;
  function newRenderer(canvas) {
    const T = window.THREE;
    const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = T.SRGBColorSpace;
    r.shadowMap.enabled = true; r.shadowMap.type = T.VSMShadowMap; r.setClearColor(0x000000, 0);
    return r;
  }
  // where each action shows, projected to the picture (fractions of width and height); the side nearer the camera
  // where each action is marked: its strongest point on each side of the face and in the middle (projected, 0-1 of the box)
  function anchors(S, aus) {
    const T = S.T, m = core, v = new T.Vector3(), out = [];
    S.mesh.updateMatrixWorld(true);
    const at = i => { v.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]).applyMatrix4(S.mesh.matrixWorld).project(S.camera); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }; };
    const ok = q => q && q[0] >= 0 && q[1] > 0.02;
    for (const a of aus) { const pk = m.peak[a]; if (!pk) continue;
      const pick = ok(pk.L) ? pk.L : ok(pk.C) ? pk.C : pk.R; if (!pick || pick[0] < 0) continue;
      out.push(Object.assign({ a, central: pick === pk.C, L: ok(pk.L) ? at(pk.L[0]) : null, R: ok(pk.R) ? at(pk.R[0]) : null }, at(pick[0]))); }
    return out;
  }

  /* ---------------------------------------------------------------- pictures (shared off-screen renderer, cached) */
  const cache = new Map(), waiting = new Map(), roots = new Set(); let shot = null, busy = false;
  const allImgs = () => { const out = []; [document].concat([...roots]).forEach(r => { try { r.querySelectorAll('img[data-f3]').forEach(i => out.push(i)); } catch (e) { /* detached */ } }); return out; };
  const keyOf = (K, crop, hls) => (crop || 'full') + '|' + Object.keys(K).filter(a => K[a] > 0.004).sort((a, b) => +a - +b).map(a => a + ':' + (+K[a]).toFixed(2)).join(',') + (hls && hls.length ? '|h' + hls.slice().sort().join('.') : '');
  function renderTo(K, crop, hls) {
    if (!shot) { const cv = document.createElement('canvas'); const r = newRenderer(cv); shot = { r, S: buildScene(r) }; }
    const V = VIEW[crop] || VIEW.full; shot.r.setPixelRatio(1); shot.r.setSize(V.w, V.h, false);
    pose(shot.S, K, crop, hls); shot.r.render(shot.S.scene, shot.S.camera);
    let url = ''; try { url = shot.r.domElement.toDataURL('image/webp', 0.88); } catch (e) { url = shot.r.domElement.toDataURL(); }
    return url;
  }
  // pictures on screen, or about to be, render first; the rest follow
  function nearKey() {
    const H = (typeof innerHeight === 'number' && innerHeight) || 800;
    for (const img of allImgs()) { if (img.classList.contains('f3-on')) continue; const k = img.dataset.f3; if (!waiting.has(k)) continue;
      const r = img.getBoundingClientRect(); if (r.width > 0 && r.bottom > -0.5 * H && r.top < 1.6 * H) return k; }
    return null;
  }
  function pump() {
    if (busy || !core) return; busy = true;
    const step = () => {
      const t0 = performance.now();
      while (waiting.size && performance.now() - t0 < 24) {
        const key = nearKey() || waiting.keys().next().value, job = waiting.get(key); waiting.delete(key);
        let url = ''; try { url = renderTo(job.K, job.crop, job.hls); } catch (e) { url = ''; }
        if (url) { cache.set(key, url); allImgs().forEach(img => { if (img.dataset.f3 === key) { img.src = url; img.classList.add('f3-on'); } }); }
      }
      if (waiting.size) setTimeout(step, 16); else busy = false;
    };
    setTimeout(step, 0);
  }
  // pictures also fill in when they are added to the page after the model has loaded
  function sweep() {
    allImgs().forEach(img => { if (img.classList.contains('f3-on')) return; const key = img.dataset.f3; if (cache.has(key)) { img.src = cache.get(key); img.classList.add('f3-on'); } });
  }
  let sweepQ = 0; const sweepSoon = () => { if (sweepQ) return; sweepQ = requestAnimationFrame(() => { sweepQ = 0; sweep(); }); };
  function kmapOf(aus, k) { const K = {}; (aus || []).map(String).forEach(a => { if (DRAWN.has(a)) K[a] = Math.max(0, Math.min(1.6, k && k[a] != null ? +k[a] : 1)); }); return K; }
  function faceSVG(aus, opt) {
    opt = opt || {};
    const crop = VIEW[opt.crop] ? opt.crop : 'full', V = VIEW[crop];
    const K = kmapOf(aus, opt.k), hls = (opt.hls || []).map(String).filter(a => M[a]);
    const key = keyOf(K, crop, hls);
    const title = String(opt.title || 'Face').replace(/[<&>"]/g, '');
    const size = opt.size || 160, dims = opt.fluid ? ` style="width:100%;height:auto;aspect-ratio:${V.w}/${V.h}"` : ` width="${size}" height="${Math.round(size * V.h / V.w)}" style="aspect-ratio:${V.w}/${V.h}"`;
    const have = cache.get(key);
    if (!have) { waiting.set(key, { K, crop, hls }); ready().then(pump, () => {}); }
    return `<img class="face f3d${have ? ' f3-on' : ''}${opt.cls ? ' ' + opt.cls : ''}" data-f3="${key}" src="${have || BLANK}" alt="${title}" title="${title}"${dims} decoding="async">`;
  }
  function draw(kmap, opt) { const aus = Object.keys(kmap || {}).filter(a => kmap[a] > 0.02); return faceSVG(aus, Object.assign({}, opt, { k: kmap })); }
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const mo = new MutationObserver(() => { if (core) sweepSoon(); });
    const start = () => mo.observe(document.body, { childList: true, subtree: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  /* ---------------------------------------------------------------- a live face */
  // the head's outline at each height: its leftmost and rightmost projected point in thin horizontal bands (0-1 of the box)
  function outline(S) {
    const T = S.T, m = core, v = new T.Vector3(), N = 72, lo = new Float32Array(N).fill(2), hi = new Float32Array(N).fill(-1);
    for (let i = 0; i < m.N; i += 2) { const g = m.vgroup[i]; if (g !== m.GI.M_Face && g !== m.GI.M_BackHead) continue; if (m.base[i * 3 + 1] < -9) continue;
      v.set(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2]).applyMatrix4(S.mesh.matrixWorld).project(S.camera);
      const x = (v.x + 1) / 2, b = Math.floor((1 - v.y) / 2 * N); if (b < 0 || b >= N) continue;
      if (x < lo[b]) lo[b] = x; if (x > hi[b]) hi[b] = x; }
    return { N, lo, hi };
  }
  /* Callouts (29 Oct, A061): a small open ring on the point (nothing drawn over the
     skin inside it), a thin solid leader from the ring's edge, and an unboxed label. Labels sit just outside the head at
     their own height, in a column on each side. A two-sided action is marked on whichever side of the face has room for
     its label level with the point (the near side when there is room), so a crowded face spreads over both columns.
     Labels are measured in the page, so a long name breaks after the AU number (as in the explorer) and wraps into the room
     there is; they are stacked without overlap, and two labels whose leaders would cross swap places. Drawn in pixels so
     the rings stay round. */
  function callouts(callEl, pts, prof, names, W, H, room) {
    const RR = 3.6, PAD = 9, GAP = 5, MINW = 58, HE = 30, X0 = -(room ? room[0] : 0), X1 = W + (room ? room[1] : 0);
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // the head's edge (px) between two heights: its rightmost point for a label on the right, its leftmost for one on the left
    const edge = (y0, y1, left) => { let e = left ? Infinity : -Infinity;
      const b0 = Math.max(0, Math.floor(y0 / H * prof.N)), b1 = Math.min(prof.N - 1, Math.floor(y1 / H * prof.N));
      for (let b = b0; b <= b1; b++) { if (prof.hi[b] < 0) continue; e = left ? Math.min(e, prof.lo[b] * W) : Math.max(e, prof.hi[b] * W); }
      return e; };
    const colX = (px, py, h, left) => { const e = edge(py - h / 2, py + h / 2, left);
      return left ? Math.min(isFinite(e) ? e - PAD : px - 16, px - 16) : Math.max(isFinite(e) ? e + PAD : px + 16, px + 16); };
    // each action's point for a label on the right and on the left (the same point when it has only one)
    const items = pts.map(p => { const two = p.L && p.R, rp = two ? (p.L.x >= p.R.x ? p.L : p.R) : p, lp = two ? (p.L.x >= p.R.x ? p.R : p.L) : p;
      return { a: p.a, r: rp, l: lp, pref: (p.central || p.x < 0.47) ? 'l' : 'r' }; });
    // side: top to bottom, each label goes where it is pushed down least, with a little weight on leader length and on the usual side
    const last = { l: -Infinity, r: -Infinity };
    items.slice().sort((p, q) => p[p.pref].y - q[q.pref].y).forEach(it => {
      let best = null;
      ['r', 'l'].forEach(s => { const px = it[s].x * W, py = it[s].y * H, top = Math.max(py - HE / 2, last[s] + GAP);
        const cost = (top - (py - HE / 2)) + 0.05 * Math.abs(colX(px, py, HE, s === 'l') - px) + (s === it.pref ? 0 : 12);
        if (!best || cost < best.cost) best = { s, cost, top }; });
      it.left = best.s === 'l'; it.x = it[best.s].x * W; it.y = it[best.s].y * H; last[best.s] = best.top + HE;
    });
    callEl.innerHTML = items.map(it => `<div class="fc-lab ${it.left ? 'l' : 'r'}"><b>AU${esc(it.a)}</b> ${esc((names && names[it.a]) || '')}</div>`).join('');
    // each label's width on one line; a label that does not fit beside the head breaks after its AU number
    [...callEl.children].forEach((el, i) => { items[i].el = el; el.style.maxWidth = 'none'; items[i].nat = el.offsetWidth; });
    const place = (it, y0, y1) => {
      if (it.left) { it.end = Math.max(X0 + MINW, colX(it.x, (y0 + y1) / 2, y1 - y0, true)); it.w = it.end - X0 - 2; }
      else { it.st = Math.min(X1 - MINW, colX(it.x, (y0 + y1) / 2, y1 - y0, false)); it.w = X1 - 2 - it.st; }
      it.el.style.maxWidth = Math.floor(it.w) + 'px'; it.el.classList.toggle('br', it.nat > it.w + 0.5);
      it.h = it.el.offsetHeight || 15 * Math.max(1, Math.ceil(it.el.textContent.length * 6.4 / it.w));
    };
    const tip = it => [it.left ? it.end + 4 : it.st - 4, it.top + it.h / 2];
    const cross = (p, q) => { const [bx, by] = tip(p), [dx, dy] = tip(q), rx = bx - p.x, ry = by - p.y, sx = dx - q.x, sy = dy - q.y, d = rx * sy - ry * sx;
      if (Math.abs(d) < 1e-9) return false;
      const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / d, u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / d;
      return t > 0 && t < 1 && u > 0 && u < 1; };
    [true, false].forEach(left => {
      const S2 = items.filter(it => it.left === left).sort((p, q) => p.y - q.y);
      // stack top to bottom, each label as level with its point as the one above allows; pull back up if the column runs off the bottom
      const stack = () => { let lastB = -Infinity; S2.forEach(it => { it.top = Math.max(it.y - it.h / 2, lastB + GAP); lastB = it.top + it.h; });
        let lim = H + 6; for (let k = S2.length - 1; k >= 0; k--) { const it = S2[k]; if (it.top + it.h > lim) it.top = lim - it.h; lim = it.top - GAP; } };
      const settle = () => { for (let pass = 0; pass < 2; pass++) { stack(); S2.forEach(it => place(it, it.top, it.top + it.h)); } stack(); };
      S2.forEach(it => place(it, it.y - 8, it.y + 8)); settle();
      for (let round = 0; round < 2 * S2.length; round++) {
        let k = 0; while (k < S2.length - 1 && !cross(S2[k], S2[k + 1])) k++;
        if (k >= S2.length - 1) break;
        [S2[k], S2[k + 1]] = [S2[k + 1], S2[k]]; settle();
      }
    });
    const pc = v => (v * 100).toFixed(2) + '%';
    items.forEach(it => { const st = it.el.style; st.top = pc((it.top + it.h / 2) / H); if (it.left) st.right = pc((W - it.end) / W); else st.left = pc(it.st / W); });
    const lines = items.map(it => {
      const [tx, ty] = tip(it), ux = tx - it.x, uy = ty - it.y, len = Math.hypot(ux, uy) || 1;
      return `<path d="M${(it.x + ux / len * RR).toFixed(1)} ${(it.y + uy / len * RR).toFixed(1)} L${tx.toFixed(1)} ${ty.toFixed(1)}"/><circle cx="${it.x.toFixed(1)}" cy="${it.y.toFixed(1)}" r="${RR}"/>`;
    }).join('');
    callEl.insertAdjacentHTML('afterbegin', `<svg class="fc-lines" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>`);
  }
  function mount(el, aus, opt) {
    opt = opt || {};
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const crop = VIEW[opt.crop] ? opt.crop : 'full', V = VIEW[crop];
    let cur = kmapOf(aus, opt.k), raf = 0, loopT = 0, alive = true, looping = '', shown = '', target = Object.keys(cur);
    el.classList.add('facebox', 'f3box'); el.style.aspectRatio = `${V.w} / ${V.h}`;
    el.innerHTML = `<div class="fc-face"><canvas aria-label="${String(opt.title || 'Face').replace(/"/g, '')}" role="img"></canvas><div class="f3-wait">Loading the face…</div></div><div class="fc-calls"></div>`;
    const faceEl = el.firstChild, canvas = faceEl.firstChild, wait = faceEl.lastChild, callEl = el.lastChild;
    let L = null;
    const size = () => { if (!L) return; const w = Math.max(80, faceEl.clientWidth || 300), h = Math.round(w * V.h / V.w); L.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); L.r.setSize(w, h, false); canvas.style.width = '100%'; canvas.style.height = '100%'; };
    const paint = (K, tgt) => {
      if (!L) return;
      pose(L.S, K, crop, opt.outline ? (tgt || Object.keys(K)) : []); L.r.render(L.S.scene, L.S.camera);
      let key = (tgt || Object.keys(K)).slice().sort((a, b) => +a - +b).join('+'); if (!key && looping) key = looping;
      if (opt.callouts && key !== shown) { shown = key; const list = key ? key.split('+') : []; const K2 = {}; list.forEach(a => { K2[a] = 1; });
        if (list.length) { pose(L.S, Object.assign({}, K2), crop, []); const par = el.parentElement, rb = el.getBoundingClientRect(), pb = par ? par.getBoundingClientRect() : rb;
          const W = faceEl.clientWidth || 400, H = faceEl.clientHeight || W * V.h / V.w;
          callouts(callEl, anchors(L.S, list), outline(L.S), opt.names, W, H, [Math.max(0, rb.left - pb.left - 4), Math.max(0, pb.right - rb.right - 4)]); pose(L.S, K, crop, opt.outline ? (tgt || Object.keys(K)) : []); }
        else callEl.innerHTML = ''; }
    };
    ready().then(() => { if (!alive) return; L = { r: newRenderer(canvas) }; L.S = buildScene(L.r); size(); wait.remove(); paint(cur, target); },
      e => { wait.textContent = /WebGL/.test(String(e && e.message)) ? 'The 3D face needs WebGL, which this browser has turned off.' : 'The 3D face could not be loaded just now. The evidence still works; reload the page to try again.'; });
    // a new size lays the callouts out again (their room beside the head changes with it)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (L && alive) { size(); shown = ''; paint(cur, target); } }) : null; if (ro) ro.observe(faceEl);
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function set(aus2, k, ms) {
      if (!alive) return; cancelAnimationFrame(raf);
      const tgtK = kmapOf(aus2, k); target = Object.keys(tgtK);
      const from = Object.assign({}, cur), keys = [...new Set(Object.keys(from).concat(Object.keys(tgtK)))];
      const dur = reduce || !L ? 0 : (ms == null ? 420 : ms), t0 = performance.now();
      const step = now => { const t = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(t), kk = {};
        keys.forEach(a => { const v = (from[a] || 0) + ((tgtK[a] || 0) - (from[a] || 0)) * e; if (v > 0.004) kk[a] = v; });
        cur = kk; paint(kk, target);
        if (t < 1) raf = requestAnimationFrame(step); else cur = tgtK; };
      raf = requestAnimationFrame(step);
    }
    function loop(aus2, o) {
      o = o || {}; stop(); looping = (aus2 || []).map(String).sort((a, b) => +a - +b).join('+'); if (reduce) { set(aus2, o.k, 0); return; }
      let up = true; const tick = () => { if (!alive) return; set(up ? aus2 : [], o.k, o.ms || 900); up = !up; loopT = setTimeout(tick, (o.ms || 900) + (up ? 700 : 1300)); };
      tick();
    }
    function stop() { clearTimeout(loopT); loopT = 0; looping = ''; }
    return { set, loop, stop, destroy() { alive = false; stop(); cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (L) { L.r.dispose(); L.r.forceContextLoss && L.r.forceContextLoss(); L = null; } }, get state() { return Object.assign({}, cur); } };
  }
  function installDefs(root) { if (root && root !== document) watch(root); ready().catch(() => {}); }
  // pictures inside a shadow root fill in too once it is registered
  function watch(root) { roots.add(root); if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (core) sweepSoon(); }).observe(root, { childList: true, subtree: true }); }
  function config(o) { if (o && o.base != null) BASE = String(o.base); }
  const STYLES = [['clay', 'Clay sculpt']];
  const ANCHOR = {};
  return { faceSVG, draw, mount, installDefs, watch, config, STYLES, ANCHOR, DRAWN, get ready() { return ready(); }, calloutsHTML: () => '' };
})();
const faceSVG = FaceMesh.faceSVG;
if (typeof module !== 'undefined') module.exports = FaceMesh;

/* ---- src/au-evidence.js ---- */
/* AUEvidence: evidence logic shared by the evidence tool and its integration kit.
 * Pure functions over the knowledge base (kb.json). No DOM access.
 *
 * Principles built into these functions:
 *  - single-action evidence and evidence for a joint configuration are computed separately and never merged;
 *  - production (posed, spontaneous) and perception evidence are kept apart: they answer different questions;
 *  - states keep the source authors' terms (no merging of happiness, amusement, joy, positive affect...);
 *  - a reading supported only by single-action evidence is labelled a hypothesis about an untested combination;
 *  - nothing here labels a face with an emotion; readings are candidates with their evidence and counter-evidence.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AUEvidence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PROD = ['posed', 'spontaneous'];
  const STREAM_LABEL = {
    posed: 'Posed production', spontaneous: 'Spontaneous production', 'posed vs spontaneous': 'Posed vs spontaneous',
    perception: 'Perception', function: 'Functions beyond emotion', automated: 'Automated detection', theory: 'Theory',
    review: 'Review', method: 'Method', comparative: 'Comparative (non-human primates)', other: 'Other'
  };
  const LEVELS = [
    { level: 0, label: 'Speculative', desc: 'Only one of the selected actions has evidence for this state; the combination itself is untested.' },
    { level: 1, label: 'Hypothesis', desc: 'Two or more of the selected actions each have single-action evidence for this state, but no study in the evidence base reports them together for it.' },
    { level: 2, label: 'Joint, limited', desc: 'One independent sample reports the selected actions together for this state, or several do but none was coded from the full text.' },
    { level: 3, label: 'Joint, replicated', desc: 'Two or more independent samples report the selected actions together for this state, at least one coded from the full text. Reviews and theory do not count as samples.' }
  ];

  const LEVELS_SINGLE = [
    { level: 0, label: 'No positive link', desc: 'Only null or inverse findings for this action and state.' },
    { level: 1, label: '', desc: '' },
    { level: 2, label: 'One sample', desc: 'One independent sample reports this action with this state.' },
    { level: 3, label: 'Two or more samples', desc: 'Two or more independent samples report this action with this state.' }
  ];
  /* evidence-base labels that are not candidate states */
  const SKIP_STATES = new Set(['multiple categories (pooled / aggregate)', 'unspecified / unclear category', 'not applicable']);
  function normAU(x) {
    const m = String(x).trim().match(/^(?:AU\s*)?0*(\d+)/i);
    return m ? String(+m[1]) : null;
  }
  function parseCombo(str) {
    const out = [];
    String(str || '').split(/[^0-9A-Za-z]+/).forEach(t => { const a = normAU(t); if (a && !out.includes(a)) out.push(a); });
    return out.sort((a, b) => +a - +b);
  }
  function slug(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x'; }

  function index(kb) {
    const recById = new Map(kb.records.map(r => [r.id, r]));
    const claimById = new Map(kb.claims.map(c => [c.id, c]));
    const claimsByAU = new Map();
    kb.claims.forEach(c => c.aus.forEach(a => { if (!claimsByAU.has(a)) claimsByAU.set(a, []); claimsByAU.get(a).push(c); }));
    const stateSlug = new Map(), slugState = new Map();
    Object.keys(kb.states).forEach(s => { let g = slug(s), i = 2; while (slugState.has(g)) g = slug(s) + '-' + (i++); stateSlug.set(s, g); slugState.set(g, s); });
    const configsByAU = new Map();
    kb.configs.forEach((c, i) => { c._i = i; c.aus.forEach(a => { if (!configsByAU.has(a)) configsByAU.set(a, []); configsByAU.get(a).push(c); }); });
    return { kb, recById, claimById, claimsByAU, stateSlug, slugState, configsByAU };
  }

  /** Single-action evidence for one AU: evidence-base associations by stream (independent samples) and curated claims. */
  function single(I, code) {
    const au = I.kb.aus[code];
    const byStream = {};
    if (au) au.assoc.forEach(a => { (byStream[a.stream] = byStream[a.stream] || []).push(a); });
    Object.values(byStream).forEach(list => list.sort((x, y) => (y.present - x.present) || (y.unrelated + y.inverse - x.unrelated - x.inverse) || x.state.localeCompare(y.state)));
    return { au, byStream, claims: I.claimsByAU.get(code) || [] };
  }

  /** Joint evidence: reported configurations that contain all selected AUs (exact, with one or two more, or within a larger
   *  set), configurations that lie wholly within the selection (all their AUs selected), and other partial overlaps. */
  function joint(I, codes) {
    const S = new Set(codes);
    const exact = [], superset = [], embedded = [], within = [], partial = [];
    if (codes.length < 2) return { exact, superset, embedded, within, partial };
    I.kb.configs.forEach(c => {
      if (SKIP_STATES.has(c.state)) return;
      const C = new Set(c.aus);
      const inter = codes.filter(a => C.has(a)).length;
      const extra = C.size - inter;
      if (inter === codes.length && extra === 0) exact.push(c);
      else if (inter === codes.length && extra <= 2) superset.push(Object.assign({ extra }, c));
      else if (inter === codes.length) embedded.push(Object.assign({ extra }, c));
      else if (extra === 0 && inter >= 2) within.push(Object.assign({ missing: codes.length - inter }, c));
      else if (inter >= 2) partial.push(Object.assign({ overlap: inter }, c));
    });
    const by = (a, b) => (b.units - a.units) || a.state.localeCompare(b.state);
    return { exact: exact.sort(by), superset: superset.sort((a, b) => (a.extra - b.extra) || by(a, b)), embedded: embedded.sort(by),
      within: within.sort((a, b) => by(a, b) || (b.aus.length - a.aus.length)), partial: partial.sort((a, b) => (b.overlap - a.overlap) || by(a, b)) };
  }

  function typesDE(types) { return (types && (types.DE || 0) + (types.SA || 0)) || 0; }

  /** Candidate readings for a set of AUs, computed separately for production and perception (and functions beyond emotion).
   *  Returns {production:[...], perception:[...], function:[...]} sorted by evidence level. */
  /** Candidate readings for a set of AUs. Each stream is evaluated on its own: spontaneous and posed production,
   *  perception, and functions beyond emotion. `production` merges the two production streams per state and keeps
   *  both evaluations (spont, posed); spontaneous evidence is what bears on what a person may feel.
   *  A reading is `contested` when the same stream holds null, inverse or contradicting evidence. */
  function readings(I, codes, opt) {
    opt = opt || {};
    const J = joint(I, codes);
    const groups = { spontaneous: ['spontaneous'], posed: ['posed'], perception: ['perception'], function: ['function'] };
    const out = {};
    Object.entries(groups).forEach(([g, streams]) => {
      const cand = new Map();
      const get = s => { if (!cand.has(s)) cand.set(s, { state: s, singles: {}, jointSet: new Set(), jointRev: new Set(), jointDE: false, jointConfigs: [], jointContra: [], within: null, withinN: 0, counter: [], claims: [], counterClaims: [] }); return cand.get(s); };
      const claimStream = cl => cl.stream === 'posed vs spontaneous' ? 'spontaneous' : cl.stream;
      codes.forEach(a => {
        const au = I.kb.aus[a]; if (!au) return;
        au.assoc.forEach(x => {
          if (!streams.includes(x.stream) || SKIP_STATES.has(x.state)) return;
          const c = get(x.state);
          if (x.present > 0) c.singles[a] = (c.singles[a] || 0) + x.present;
          if (x.unrelated + x.inverse > 0) c.counter.push({ au: a, stream: x.stream, n: x.unrelated + x.inverse, recs: x.recs });
        });
        (I.claimsByAU.get(a) || []).forEach(cl => {
          if (!streams.includes(claimStream(cl))) return;
          cl.states.forEach(s => {
            if (SKIP_STATES.has(s) || (!cand.has(s) && cl.dir !== 'supports')) return;
            const c = get(s);
            if (!c.claims.includes(cl)) c.claims.push(cl);
            if ((cl.dir === 'null' || cl.dir === 'contradicts') && !c.counterClaims.includes(cl)) c.counterClaims.push(cl);
          });
        });
      });
      J.exact.concat(J.superset).forEach(cfg => {
        if (!streams.includes(cfg.stream)) return;
        if (!cfg.units && !cfg.reviews && !cfg.contra) return;
        const c = get(cfg.state);
        (cfg.unitIds || []).forEach(u => c.jointSet.add(u)); (cfg.reviewIds || []).forEach(u => c.jointRev.add(u));
        if (cfg.units && cfg.de) c.jointDE = true;
        if (cfg.units || cfg.reviews) c.jointConfigs.push(cfg);
        if (cfg.contra) c.jointContra.push(cfg);
      });
      /* part of the selection reported together (a configuration wholly within the selection): shown with the reading,
         never used to raise the level of the whole selection */
      J.within.forEach(cfg => {
        if (!streams.includes(cfg.stream) || !cand.has(cfg.state) || !cfg.units) return;
        const c = cand.get(cfg.state); c.withinN += 1;
        if (!c.within || cfg.units > c.within.units || (cfg.units === c.within.units && cfg.aus.length > c.within.aus.length)) c.within = { aus: cfg.aus, units: cfg.units, types: cfg.types };
      });
      const list = [];
      cand.forEach(c => {
        const nSingle = Object.keys(c.singles).length, jointUnits = c.jointSet.size, jointReviews = c.jointRev.size;
        if (!jointUnits && !nSingle) return;
        let level;
        if (codes.length === 1) level = (c.singles[codes[0]] || 0) >= 2 ? 3 : ((c.singles[codes[0]] || 0) >= 1 ? 2 : 0);
        else if (jointUnits >= 2 && c.jointDE) level = 3;
        else if (jointUnits >= 1) level = 2;
        else if (nSingle >= 2) level = 1;
        else level = 0;
        const contested = c.counter.length > 0 || c.counterClaims.length > 0 || c.jointContra.length > 0;
        list.push({
          state: c.state, stream: g, cls: (I.kb.states[c.state] || {}).cls || '', level, levelLabel: (codes.length === 1 ? LEVELS_SINGLE : LEVELS)[level].label,
          joint: jointUnits > 0, jointUnits, jointReviews, jointConfigs: c.jointConfigs, jointContra: c.jointContra,
          singles: c.singles, nSingle, hypothesis: !jointUnits && codes.length >= 2, contested,
          within: c.within ? Object.assign({ n: c.withinN }, c.within) : null,
          counter: c.counter, counterClaims: c.counterClaims, claims: c.claims,
          score: level * 1000 + jointUnits * 20 + (c.within ? Math.min(c.within.units, 20) * 4 : 0) + Object.values(c.singles).reduce((s, v) => s + v, 0) - c.counter.reduce((s, x) => s + x.n, 0) * 0.5 - (contested ? 5 : 0)
        });
      });
      list.sort((a, b) => b.score - a.score || a.state.localeCompare(b.state));
      out[g] = list;
    });
    const m = new Map();
    out.spontaneous.forEach(r => m.set(r.state, { state: r.state, cls: r.cls, spont: r, posed: null }));
    out.posed.forEach(r => { const x = m.get(r.state) || { state: r.state, cls: r.cls, spont: null, posed: null }; x.posed = r; m.set(r.state, x); });
    out.production = [...m.values()].map(x => Object.assign(x, {
      level: x.spont ? x.spont.level : -1, posedLevel: x.posed ? x.posed.level : -1,
      score: (x.spont ? x.spont.score : -999) * 10 + (x.posed ? x.posed.score : -999) / 100
    })).sort((a, b) => b.score - a.score || a.state.localeCompare(b.state));
    if (opt.limit) ['spontaneous', 'posed', 'perception', 'function', 'production'].forEach(g => { out[g] = out[g].slice(0, opt.limit); });
    out.joint = J;
    return out;
  }

  /** One best guess for a set of actions, always given, with what it rests on and how confident it is.
   *  Felt or expressed states are ranked from spontaneous production first (posed portrayals only when nothing
   *  spontaneous bears on the selection). A combination no study reports together is guessed from its parts:
   *  configurations within the selection first, then single actions. What observers infer is guessed separately. */
  function bestGuess(I, codes, R) {
    R = R || readings(I, codes);
    const sum = o => Object.values(o || {}).reduce((s, v) => s + v, 0);
    const score = r => !r ? -1e9 : 8 * r.jointUnits + (r.within ? 2.5 * Math.min(r.within.units, 12) : 0) + 1.4 * r.nSingle + 0.12 * Math.min(sum(r.singles), 40)
      - (r.contested ? 1.2 : 0) - 0.25 * r.counter.reduce((t, x) => t + x.n, 0);
    const conf = r => (r.jointUnits >= 2 && !r.contested) ? 'high' : (r.jointUnits >= 1 || (r.within && r.within.units >= 2 && r.nSingle >= Math.max(2, codes.length - 1))) ? 'moderate' : 'low';
    const pick = (list, minSingle) => list.filter(r => r.jointUnits || (r.within && r.within.units) || r.nSingle >= Math.min(minSingle, codes.length))
      .map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s || a.r.state.localeCompare(b.r.state));
    const why = (r, stream) => {
      const word = { spontaneous: 'in spontaneous behavior', posed: 'in posed portrayals', perception: 'by observers' }[stream] || '';
      if (r.jointUnits) return `${codes.map(a => 'AU' + a).join(' + ')} reported together with ${r.state} in ${r.jointUnits} independent sample${r.jointUnits === 1 ? '' : 's'} ${word}${r.contested ? '; some findings disagree' : ''}.`;
      const parts = Object.keys(r.singles).sort((a, b) => +a - +b);
      const w = r.within ? `AU${r.within.aus.join(' + AU')} together in ${r.within.units} sample${r.within.units === 1 ? '' : 's'}` : '';
      const singles = parts.length ? `${parts.map(a => 'AU' + a).join(', ')} ${parts.length === 1 ? 'has' : 'each have'} single-action evidence` : '';
      return `No study reports the whole selection together. Guessed from its parts ${word}: ${[w, singles].filter(Boolean).join('; ')}${r.contested ? '; some findings disagree' : ''}.`;
    };
    let stream = 'spontaneous', P = pick(R.spontaneous, 1);
    if (!P.length) { stream = 'posed'; P = pick(R.posed, 1); }
    const top = P[0] ? P[0].r : null;
    const perc = pick(R.perception, 1)[0], func = pick(R.function, 1)[0];
    return {
      state: top ? top.state : null, stream: top ? stream : null, confidence: top ? conf(top) : 'none',
      basis: top ? why(top, stream) : 'No evidence collected here bears on these actions.',
      tested: !!(top && top.jointUnits), reading: top,
      alternatives: P.slice(1, 4).map(x => ({ state: x.r.state, confidence: conf(x.r), tested: !!x.r.jointUnits })),
      perception: perc ? { state: perc.r.state, confidence: conf(perc.r), basis: why(perc.r, 'perception') } : null,
      function: func ? { state: func.r.state, confidence: conf(func.r) } : null
    };
  }

  /** Physical notes on combinations (FACS conventions and anatomical antagonism). */
  const PAIR_NOTES = [
    [['1', '2'], 'Inner and outer brow raised together: the whole brow lifts and the forehead wrinkles across its width.'],
    [['1', '4'], 'Inner brow raised while the brows are drawn together: the oblique brow, with the inner corners up.'],
    [['1', '2', '4'], 'Brows raised and drawn together: a flattened, raised brow with horizontal wrinkles concentrated in the centre.'],
    [['4', '5'], 'Brow lowering with upper-lid raising: a glare in which the eye stays wide under a lowered brow.'],
    [['4', '7'], 'Brow lowering with lid tightening: narrowed eyes under a lowered brow.'],
    [['5', '7'], 'Upper-lid raising and lid tightening pull the eye aperture in opposite directions; one usually dominates.'],
    [['5', '43'], 'Upper-lid raising and eye closure are mutually exclusive at the same moment; check for a sequence or a detector error.'],
    [['6', '12'], 'Cheek raising with lip-corner pulling: the configuration called the Duchenne smile. A strong AU12 alone also raises the cheeks, which can be coded as AU6.'],
    [['6', '7'], 'Cheek raising and lid tightening both narrow the eye from below; detectors often confuse them.'],
    [['9', '10'], 'Nose wrinkling and upper-lip raising share the levator muscles; AU9 usually raises the upper lip too.'],
    [['12', '15'], 'Lip-corner pulling and lip-corner depression are antagonists; together they produce a pulled, flattened mouth corner sometimes described as a masked or controlled smile.'],
    [['12', '14'], 'Lip-corner pulling with dimpling: a tighter, often asymmetric smile.'],
    [['12', '24'], 'Lip-corner pulling with lip pressing: a smile whose lips stay pressed together, one of the smile controls.'],
    [['12', '17'], 'Lip-corner pulling with chin raising: a smile with the lower lip pushed up, one of the smile controls.'],
    [['15', '17'], 'Lip-corner depression with chin raising: the lower face of the hypothesized sadness configuration.'],
    [['18', '20'], 'Lip puckering and lip stretching are antagonists.'],
    [['23', '24'], 'Lip tightening and lip pressing often occur together and are hard to separate.'],
    [['25', '26'], 'Lips parted with the jaw dropped: the mouth opens; AU26 includes AU25 in most coding.'],
    [['25', '27'], 'Lips parted with the mouth stretched open.'],
    [['26', '27'], 'Jaw drop and mouth stretch are alternative codes for degrees of mouth opening.']
  ];
  function pairNotes(codes) {
    const S = new Set(codes);
    return PAIR_NOTES.filter(([p]) => p.every(a => S.has(a)));
  }

  /* ---------- reliability and specificity (kb.relspec, kb.relspecTrace) ---------- */
  const RS_WITH = new Set(['reliability', 'study_share', 'time_share', 'coherence_correlation', 'agreement']);
  const RS_WITHOUT = new Set(['other_state', 'ppv', 'rate']);
  const RS_KIND = { 'meta-analysis': 0, 'systematic review': 1, study: 2, review: 3 };
  const rsRank = e => (e.meta ? (RS_KIND[e.kind] != null ? RS_KIND[e.kind] : 2) : 2);
  const rsSort = (a, b) => rsRank(a) - rsRank(b) || (a.measure === 'coherence_correlation') - (b.measure === 'coherence_correlation') || (b.estimate || 0) - (a.estimate || 0);
  /** The sentence an estimate stands for, as plain text: '35%' + 'of people in anger conditions showed ...'. */
  function relspecValue(e) {
    if (e.estimate == null) return '';
    if (e.measure === 'rate') return String(Math.round(100 * e.estimate));
    if (e.measure === 'coherence_correlation') return 'r = ' + e.estimate.toFixed(2).replace(/^(-?)0\./, '$1.');
    const p = 100 * e.estimate;
    return (p > 0 && p < 9.5 ? p.toFixed(1) : Math.round(p)) + '%';
  }
  function relspecSentence(e) {
    const st = e.state || '', ex = e.expression || 'the expression';
    if (e.say) return e.say.replace('{state}', st).replace('{expr}', ex).replace('{k}', e.k != null ? String(e.k) : '');
    switch (e.measure) {
      case 'reliability': return `of ${st} instances showed ${ex}`;
      case 'other_state': return `of ${st} instances showed ${ex}${e.proposedFor ? `, an expression proposed for ${e.proposedFor}` : ''}`;
      case 'ppv': return `of the occurrences of ${ex} came from ${st}`;
      case 'rate': return `occurrences of ${ex} per 100 five-second segments of ${st}`;
      case 'time_share': return `of the time in ${st} showed ${ex}`;
      case 'coherence_correlation': return `correlation between ${ex} and ${st}`;
      case 'agreement': return `of perceivers chose ${st} for ${ex}`;
      default: return `${ex}, ${st}`;
    }
  }
  /** Estimates of reliability (with the state) and specificity (without it) for a set of actions.
   *  exact: estimates for exactly these actions; related: estimates for configurations or groups that include all of them;
   *  claims: repeated claims traced to their sources (kb.relspecTrace) about one of the actions. Moderator subgroups are left out. */
  function relspec(kb, codes) {
    const want = (codes || []).map(normAU).filter(Boolean), key = want.slice().sort((a, b) => +a - +b).join('+');
    const L = (kb.relspec || []).filter(e => e.show !== false && e.named !== false && e.role !== 'moderator' && e.role !== 'bias' && e.estimate != null);
    const acts = e => e.acts && e.acts.length ? e.acts : (e.rel && e.rel.length ? e.rel : (e.aus || []));
    const same = e => (e.aus || []).length && e.aus.slice().sort((a, b) => +a - +b).join('+') === key;
    const exact = L.filter(same), related = L.filter(e => !same(e) && want.length && want.every(a => acts(e).includes(a)));
    const split = M => ({ withState: M.filter(e => RS_WITH.has(e.measure)).sort(rsSort), withoutState: M.filter(e => RS_WITHOUT.has(e.measure)).sort(rsSort) });
    const claims = ((kb.relspecTrace || {}).claims || []).filter(c => want.includes(c.focus));
    return { exact: split(exact), related: split(related), claims };
  }

  /* ---------- evidence strength (v4) ----------
   * One scale for every reading, from the samples behind it:
   *   4 Strong    four or more independent samples report it, at least two checked in the full text, and at least
   *               three in four of the samples that looked agree;
   *   3 Moderate  two or more samples, at least one checked in the full text, and at least half agree;
   *   2 Limited   one sample, samples known only from abstracts, or samples that disagree;
   *   1 Inferred  no sample reports these actions together: read from its parts (single actions or a sub-configuration);
   *   0 Untested  nothing but theory or reviews.
   * Mixed: the evidence holds samples against the reading (one in four or more), which lowers the grade by one step. */
  const GRADE = [
    { g: 0, label: 'Untested', desc: 'No study sample reports this; only theory or reviews.' },
    { g: 1, label: 'Inferred', desc: 'No sample reports these actions together; read from the single actions.' },
    { g: 2, label: 'Limited', desc: 'One sample, samples known only from abstracts, or samples that disagree.' },
    { g: 3, label: 'Moderate', desc: 'Two or more samples, at least one checked in the full text; most agree.' },
    { g: 4, label: 'Strong', desc: 'Four or more samples, two or more checked in the full text; three in four agree.' }
  ];
  function gradeOf(n, de, against) {
    if (!n) return { g: 0, mixed: false };
    let g = n >= 4 && de >= 2 ? 4 : n >= 2 && de >= 1 ? 3 : 2;
    const agree = n / (n + (against || 0)), mixed = agree < 0.75;
    if (mixed) g = Math.max(2, g - 1);
    if (agree < 0.5) g = Math.min(g, 2);
    return { g, mixed, agree };
  }
  const MSTREAMS = ['spontaneous', 'posed', 'perception', 'function'];
  /** Evidence matrix for a selection: one row per state, one cell per type of study, each graded on the scale above.
   *  A cell holds the samples for the whole selection (joint), or, when none exist, the parts it was inferred from. */
  function matrix(I, codes, opt) {
    opt = opt || {};
    codes = (codes || []).map(String);
    const rows = new Map();
    const row = s => { if (!rows.has(s)) rows.set(s, { state: s, cls: (I.kb.states[s] || {}).cls || '', cells: {} }); return rows.get(s); };
    const cellOf = (s, t) => { const r = row(s); if (!r.cells[t]) r.cells[t] = { stream: t, n: 0, de: 0, against: 0, joint: false, units: new Set(), unitsDE: new Set(), againstU: new Set(), parts: {}, within: null, recs: [] }; return r.cells[t]; };
    if (codes.length >= 2) {
      I.kb.configs.forEach(c => {
        if (SKIP_STATES.has(c.state) || !MSTREAMS.includes(c.stream)) return;
        const C = new Set(c.aus); if (!codes.every(a => C.has(a)) || C.size - codes.length > 2) return;   // the selection, alone or with up to two more actions
        if (!c.units && !c.contra) return;
        const x = cellOf(c.state, c.stream);
        (c.unitIds || []).forEach(u => x.units.add(u)); (c.unitIdsDE || []).forEach(u => x.unitsDE.add(u)); (c.contraIds || []).forEach(u => x.againstU.add(u));
        x.recs.push(...(c.recs || []));
      });
      I.kb.configs.forEach(c => {   // a configuration wholly inside the selection: shown with the reading, never raises it
        if (SKIP_STATES.has(c.state) || !MSTREAMS.includes(c.stream) || c.aus.length < 2 || c.aus.length >= codes.length || !c.aus.every(a => codes.includes(a)) || !c.units) return;
        const x = cellOf(c.state, c.stream); if (!x.within || c.units > x.within.units) x.within = { aus: c.aus, units: c.units };
      });
    }
    codes.forEach(a => {
      const au = I.kb.aus[a]; if (!au) return;
      au.assoc.forEach(e => {
        if (!MSTREAMS.includes(e.stream) || SKIP_STATES.has(e.state)) return;
        if (!e.present && !(e.unrelated + e.inverse)) return;
        const x = cellOf(e.state, e.stream);
        x.parts[a] = { n: e.present, de: e.presentDE || 0, against: e.unrelated + e.inverse };
        if (codes.length === 1) x.recs.push(...(e.recs || []));
      });
    });
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
    /* systematic reviews that counted how many studies found each action (vote counts): a selection covered by them gets
       the review's support (the lowest share among its actions), graded on the number of studies and the share */
    reviewSupport(I.kb, codes).forEach(rv => {
      let r = out.find(x => x.state === rv.state);
      if (!r) { r = { state: rv.state, cls: (I.kb.states[rv.state] || {}).cls || '', cells: {} }; out.push(r); }
      const c = r.cells[rv.stream] || (r.cells[rv.stream] = { stream: rv.stream, n: 0, de: 0, against: 0, joint: false, parts: {}, within: null, recs: [], g: 0, label: GRADE[0].label });
      c.review = rv; const rg = rv.k >= 10 && rv.share >= 0.6 ? 4 : rv.k >= 4 && rv.share >= 0.4 ? 3 : 2;
      if (rg > c.g) { c.g = rg; c.label = GRADE[rg].label; c.mixed = rv.share < 0.75; c.byReview = true; }
    });
    const best = r => Math.max(...MSTREAMS.map(t => r.cells[t] ? r.cells[t].g + (r.cells[t].n || 0) / 100 : -2));
    out.sort((a, b) => best(b) - best(a) || a.state.localeCompare(b.state));
    return out;
  }
  function reviewSupport(kb, codes) {
    const L = (kb.relspec || []).filter(e => e.measure === 'study_share' && e.show !== false && e.estimate != null && e.k);
    const byState = {};
    L.forEach(e => { const key = e.state + '|' + e.stream; (byState[key] = byState[key] || []).push(e); });
    const out = [];
    Object.entries(byState).forEach(([key, list]) => {
      // per action: pooled share across entries that name it (weighted by the number of studies)
      const per = {};
      list.forEach(e => (e.rel && e.rel.length ? e.rel : e.aus || []).forEach(a => { const p = per[a] || (per[a] = { yes: 0, k: 0, cite: e.cite }); p.yes += e.estimate * e.k; p.k += e.k; }));
      if (!codes.every(a => per[a])) return;
      const shares = codes.map(a => per[a].yes / per[a].k), ks = codes.map(a => per[a].k);
      const [state, stream] = key.split('|');
      out.push({ state, stream, share: Math.min(...shares), k: Math.min(...ks), cite: list[0].cite, perAU: Object.fromEntries(codes.map(a => [a, { share: per[a].yes / per[a].k, k: per[a].k }])) });
    });
    return out;
  }

  /* ---------- best guess (v4): rates, not counts ----------
   * For each state, the share of its study samples whose coded actions include each selected action, by type of study
   * (spontaneous weight 1, posed 0.75, perception 0.6), shrunk toward zero for small states; the geometric mean over the
   * selected actions; plus a bonus for samples that report the whole selection together. Using shares rather than counts
   * keeps heavily studied states (pain, happiness) from winning by attention alone. */
  const SK = { spontaneous: 'sp', posed: 'po', perception: 'pe' };
  const REV_CAP = 6;   // a review's studies count as at most six samples in the rates, so one well-coded literature cannot swamp the rest
  function rateTable(kb) {
    if (kb._rate) return kb._rate;
    const Nset = { sp: {}, po: {}, pe: {} }, Cset = { sp: {}, po: {}, pe: {} };
    kb.records.forEach(r => {
      const t = SK[r.stream]; if (!t || SKIP_STATES.has(r.state) || !['DE', 'AR', 'SA'].includes(r.type)) return;
      (Nset[t][r.state] = Nset[t][r.state] || new Set()).add(r.unit);
      ((r.links && r.links.present) || []).map(a => String(a).replace('*', '')).forEach(a => { const m = (Cset[t][r.state] = Cset[t][r.state] || {}); (m[a] = m[a] || new Set()).add(r.unit); });
    });
    const N = { sp: {}, po: {}, pe: {} }, C = { sp: {}, po: {}, pe: {} };
    ['sp', 'po', 'pe'].forEach(t => Object.keys(Nset[t]).forEach(s => { if (Nset[t][s].size < 3) return; N[t][s] = Nset[t][s].size; C[t][s] = {}; Object.keys(Cset[t][s] || {}).forEach(a => { C[t][s][a] = Cset[t][s][a].size; }); }));
    // systematic-review vote counts: the studies a review counted join the state's samples (shares per action)
    const rv = {};
    (kb.relspec || []).filter(e => e.measure === 'study_share' && e.show !== false && e.estimate != null && e.k && SK[e.stream]).forEach(e => {
      const key = SK[e.stream] + '|' + e.state; const r = rv[key] || (rv[key] = { k: 0, per: {} });
      (e.rel && e.rel.length ? e.rel : e.aus || []).forEach(a => { const p = r.per[a] || (r.per[a] = { yes: 0, k: 0 }); p.yes += e.estimate * e.k; p.k += e.k; });
      r.k = Math.max(r.k, e.k);
    });
    Object.entries(rv).forEach(([key, r]) => { const [t, s] = key.split("|"); const kk = Math.min(r.k, REV_CAP); N[t][s] = (N[t][s] || 0) + kk; C[t][s] = C[t][s] || {};
      Object.entries(r.per).forEach(([a, p]) => { C[t][s][a] = (C[t][s][a] || 0) + Math.round(kk * p.yes / p.k); }); });
    const J = kb.configs.filter(c => SK[c.stream] && !SKIP_STATES.has(c.state) && c.units).map(c => [SK[c.stream], c.state, c.aus.slice().sort((a, b) => +a - +b), c.unitIds || []]);
    Object.defineProperty(kb, '_rate', { value: { w: { sp: 1, po: 0.75, pe: 0.6 }, N, C, J }, enumerable: false });
    return kb._rate;
  }
  function guess(I, codes, opt) {
    opt = opt || {};
    const D = rateTable(I.kb), W = D.w, ST = ['sp', 'po', 'pe'];
    const sel = [...new Set((codes || []).map(String))].sort((a, b) => +a - +b);
    if (!sel.length) return null;
    const jointU = {};   // distinct samples reporting the whole selection (alone or with up to two more actions)
    D.J.forEach(([t, s, aus, units]) => { if (sel.length < 2 || !sel.every(a => aus.includes(a)) || aus.length - sel.length > 2) return; const m = (jointU[t] = jointU[t] || {}); (m[s] = m[s] || new Set()); units.forEach(u => m[s].add(u)); });
    const states = [...new Set(ST.flatMap(t => Object.keys(D.N[t])))];
    const fitOf = (t, s) => { const n = D.N[t][s] || 0; if (n < 3) return null; const C = D.C[t][s] || {}; return Math.exp(sel.reduce((p, a) => p + Math.log(((C[a] || 0) + 0.05) / (n + 6)), 0) / sel.length); };
    const streams = opt.streams || ST;
    const rows = [];
    states.forEach(s => {
      let tot = 0, jsp = 0;
      streams.forEach(t => { const f = fitOf(t, s); if (f != null) tot += W[t] * f; const u = jointU[t] && jointU[t][s] ? jointU[t][s].size : 0; tot += 0.08 * W[t] * u; if (t !== 'pe') jsp += u; });
      if (tot > 0) rows.push({ state: s, score: tot, joint: jsp });
    });
    rows.sort((a, b) => b.score - a.score || a.state.localeCompare(b.state));
    if (!rows.length) return null;
    const top = rows[0], ratio = rows[1] ? top.score / rows[1].score : 9;
    const confidence = (top.joint >= 2 && ratio >= 1.5) ? 'high' : (top.joint >= 1 || ratio >= 1.7) ? 'moderate' : 'low';
    return { state: top.state, score: top.score, ratio, confidence, joint: top.joint, ranked: rows.slice(0, 6) };
  }
  /* ---------- best guess (v4): nearest reported configuration ----------
   * Every configuration in the evidence base is an exemplar: a set of actions seen (or proposed) with a state, weighted by
   * its evidence (independent samples; reviews 0.5; theory 0.6; samples against it subtract). A selection is compared with
   * each exemplar by overlap (Jaccard, squared, so close matches dominate), and single-action samples (and review vote counts)
   * add a little for every selected action. Separate rankings: what the person may feel or express (spontaneous 1, posed 0.7,
   * proposed configurations 0.45, perception 0.6), what observers would infer (perception and proposed configurations), and
   * uses beyond emotion (function studies). The top state is always returned, with the match it rests on. */
  const GW = { spontaneous: 1, posed: 0.7, perception: 0.6, theory: 0.45, automated: 0.25, function: 0.6 };
  const GROUPS = { feel: ['spontaneous', 'posed', 'theory', 'perception'], observers: ['perception', 'theory'], function: ['function'] };
  function rankStates(I, codes, mode) {
    const groups = GROUPS[mode] || GROUPS.feel, sc = new Map();
    const add = (s, v, why) => { const o = sc.get(s) || { state: s, score: 0, best: 0, top: null }; o.score += v; if (v > o.best) { o.best = v; o.top = why; } sc.set(s, o); };
    I.kb.configs.forEach(c => {
      if (SKIP_STATES.has(c.state) || c.aus.length > 8 || !groups.includes(c.stream)) return;
      const inter = codes.filter(a => c.aus.includes(a)).length; if (!inter) return;
      const jac = inter / new Set(codes.concat(c.aus)).size;
      const ev = c.units + 0.5 * c.reviews + 0.6 * c.theory + 0.2 * c.indirect - 0.7 * c.contra; if (ev <= 0) return;
      add(c.state, GW[c.stream] * jac * jac * (1 + Math.log(1 + ev)), { kind: 'config', aus: c.aus, stream: c.stream, jac, units: c.units, unitsDE: c.unitsDE || 0, reviews: c.reviews, theory: c.theory, contra: c.contra });
    });
    codes.forEach(a => { const au = I.kb.aus[a]; if (!au) return; au.assoc.forEach(x => {
      if (SKIP_STATES.has(x.state) || !groups.includes(x.stream) || x.stream === 'theory') return;
      const net = x.present - 0.6 * (x.unrelated + x.inverse); if (net <= 0) return;
      add(x.state, 0.12 * GW[x.stream] * Math.log(1 + net) / codes.length, { kind: 'single', au: a, stream: x.stream, n: x.present }); }); });
    if (mode !== 'function') (I.kb.relspec || []).filter(e => e.measure === 'study_share' && e.show !== false && e.k && groups.includes(e.stream)).forEach(e => {
      const L = e.rel && e.rel.length ? e.rel : e.aus || []; codes.forEach(a => { if (!L.includes(a)) return;
        add(e.state, 0.12 * GW[e.stream] * Math.log(1 + e.k * e.estimate) / codes.length, { kind: 'review', au: a, stream: e.stream, k: e.k, share: e.estimate, cite: e.cite }); }); });
    return [...sc.values()].sort((a, b) => b.score - a.score || a.state.localeCompare(b.state));
  }
  function confidenceOf(top, second, codes, cellGrade, spread) {
    if (!top) return 'none';
    const t = top.top || {}, ratio = second ? top.score / second.score : 9;
    if (codes.length === 1) return (cellGrade >= 3 && ratio >= 2 && spread < 8) ? 'moderate' : 'low';     // a single action is rarely specific to one state
    if (t.kind === 'config' && t.jac === 1 && t.units >= 2 && ratio >= 1.5) return 'high';
    if (t.kind === 'config' && (t.jac >= 0.75 || (t.jac === 1 && (t.units >= 1 || t.theory))) && ratio >= 1.25) return 'moderate';
    if (t.kind === 'config' && t.jac >= 0.5 && ratio >= 2.2) return 'moderate';
    return 'low';
  }
  /** The best guess for a selection, always given, with the match it rests on, the strength of the evidence (graded per
   *  type of study), the readings it competes with, what observers would infer, and uses beyond emotion. */
  function bestGuess4(I, codes) {
    codes = [...new Set((codes || []).map(String))].sort((a, b) => +a - +b);
    const M = matrix(I, codes), byState = new Map(M.map(r => [r.state, r]));
    const cell = (s, t) => (byState.get(s) || { cells: {} }).cells[t] || null;
    const feel = rankStates(I, codes, 'feel'), obs = rankStates(I, codes, 'observers'), fn = rankStates(I, codes, 'function');
    if (!codes.length || !feel.length) return { state: null, confidence: 'none', matrix: M, alternatives: [], observers: null, functions: [] };
    const top = feel[0];
    const g = st => Math.max(...['spontaneous', 'posed', 'perception'].map(t => (cell(st, t) || { g: -1 }).g));
    const out = (r, i, L) => r && { state: r.state, score: r.score, basis: r.top, confidence: confidenceOf(r, L[i + 1], codes, g(r.state), codes.length === 1 && I.kb.aus[codes[0]] ? ((I.kb.aus[codes[0]].spread || {}).states || 0) : 0), share: r.score / L.slice(0, 5).reduce((t, x) => t + x.score, 0),
      spont: cell(r.state, 'spontaneous'), posed: cell(r.state, 'posed'), perc: cell(r.state, 'perception') };
    const best = out(top, 0, feel);
    return Object.assign(best, { tested: !!(top.top && top.top.kind === 'config' && top.top.jac === 1 && top.top.units), alternatives: feel.slice(1, 5).map((r, i) => out(r, i + 1, feel)),
      observers: out(obs[0], 0, obs), functions: fn.slice(0, 3).map((r, i) => out(r, i, fn)), matrix: M, codes });
  }

  /* ---------- reasoning (v5): exemplars, families, specificity, and what would change the reading ----------
   * 1. Exemplars. Every reported configuration, every record that links one action to a state, and every systematic-review
   *    vote count is an exemplar: a set of actions seen (or proposed) with a state, weighted by its evidence.
   * 2. Similarity. A selection is compared with each exemplar by overlap (Jaccard, squared). A review that pooled actions
   *    (e.g. AU6/AU7) counts them as one slot, because it did not separate them.
   * 3. Aggregation. Per state and type of study, the best exemplar counts fully, the next 0.35 and the rest 0.1 each (capped),
   *    so a heavily studied state cannot win by volume alone; types of study add up (convergent evidence).
   * 4. Verdict. A single state when it clearly leads and few related states compete; otherwise the family most of the
   *    evidence points to (pleasant, unpleasant, surprise, effort, social, bodily) with its likeliest members; otherwise
   *    "not specific" with the leading reading of each family.
   * 5. What would change it. For each common action not selected, the verdict with that action added.
   */
  const NONSTATE = new Set(['multiple', 'multiple categories', 'basic emotions', 'six basic emotions', 'six emotions', '14 emotions', '22 emotions', '60+ emotion words',
    'emotion categories', 'social motives', 'appraisals', 'smiling', 'brow raising', 'smiling (photograph)', 'facial dynamics', 'cross-species homology', 'not reported',
    'anger (posed face)', 'genuineness', 'positivity', 'smile genuineness (rated)', 'facial feedback (own experience)', 'emotion recognition (own)', 'physiological consequence',
    'mixed/ambiguous affect', 'indifference', 'repression', 'arousal', 'audience effects', 'developmental signal', 'embodied simulation for smile-meaning interpretation']);
  const NONSTATE_RE = /^valence|vs negative valence|^intensity \(|^power appraisal|^goal conduciveness x|^control appraisal|^other-agency|^high power/;
  const isState = s => !SKIP_STATES.has(s) && !NONSTATE.has(s) && !NONSTATE_RE.test(s);
  const FAMILIES = {
    pleasant: { label: 'Pleasant feeling', phrase: 'a pleasant feeling' },
    unpleasant: { label: 'Unpleasant feeling', phrase: 'an unpleasant feeling' },
    surprise: { label: 'Surprise or alertness', phrase: 'surprise or alertness' },
    effort: { label: 'Effort or thinking', phrase: 'effort or thinking' },
    social: { label: 'Social signal', phrase: 'a social signal' },
    bodily: { label: 'Bodily reaction', phrase: 'a bodily reaction' }
  };
  const FAM_RULES = [
    [null, /^happily (sad|disgusted|fearful)/],
    ['surprise', /surpris|startle|novelty|unexpected|expectation violation|^awe|^awed|interest/],
    ['social', /^social motive|question|backchannel|listener|greeting|emphasis|prominence|negation|turn management|politeness|appeasement|dominance|affiliation|trust|cooperation|rapport|eliciting help|strength|formidab|threat|prestige|attraction|authenticity|signalling|social referencing|withdrawal|therapeutic|leniency|cultural display|^reward|intelligence|communication|disapproval|commitment|contagion|persuasion|warmth|speech-act|discourse|^repair|^engagement$|grammatical|^responses|news receipt|sharing|altruism|^suppression|sympathy|compassion/],
    ['effort', /confusion|concentration|effort|exertion|fatigue|thinking|word search|processing|attention|vigilance|flow|perceptual|yawning|sleep/],
    ['bodily', /taste|odour|sensory|sickness/],
    ['unpleasant', /unpleasant|negative|boredom|worry/],
    ['pleasant', /happ|amuse|joy|content|pride|love|desire|relief|pleasure|pleasant|positive|enjoy|elat|triumph|seren|sexual|gratitude|delight|kama muta|schadenfreude|exhilaration|coyness|sweet/],
    ['unpleasant', /anger|angr|rage|fury|disgust|fear|panic|sad|contempt|pain|distress|despair|shame|anguish|embarrass|guilt|anxiety|tension|frustrat|disappoint|depress|hateful|appalled|lajya|malu|stress|bitter|sour|distaste|obstruct|obstacle|loss|low power|low coping/]
  ];
  const _fam = new Map();
  function familyOf(s) {
    if (_fam.has(s)) return _fam.get(s);
    let f = null; const t = String(s).toLowerCase();
    for (const [k, re] of FAM_RULES) if (re.test(t)) { f = k; break; }
    _fam.set(s, f); return f;
  }
  const EXEMPLAR_STREAMS = ['spontaneous', 'posed', 'perception', 'theory', 'function'];
  function exemplars(kb) {
    if (kb._ex) return kb._ex;
    const EX = [];
    kb.configs.forEach(c => {
      if (!isState(c.state) || c.aus.length > 8 || !EXEMPLAR_STREAMS.includes(c.stream)) return;
      EX.push({ kind: 'config', aus: c.aus.map(String), state: c.state, stream: c.stream, ev: (c.unitsW != null ? c.unitsW : c.units) + 0.5 * (c.reviews || 0) + 0.6 * (c.theory || 0) + 0.2 * (c.indirect || 0) - 0.7 * (c.contra || 0),
        units: c.units, unitsDE: c.unitsDE || 0, reviews: c.reviews || 0, theory: c.theory || 0, contra: c.contra || 0 });
    });
    // records that link single actions to a state (a record listing several actions without a reported configuration counts half for each)
    const EMP = new Set(['DE', 'AR', 'SA']), S = new Map();
    const strip = xs => (xs || []).map(x => String(x).replace('*', ''));
    const slot = (t, s, a) => { const k = t + '|' + s + '|' + a; if (!S.has(k)) S.set(k, { stream: t, state: s, au: a, units: new Map(), de: new Set(), th: new Set(), rv: new Set(), contra: new Set(), recs: [] }); return S.get(k); };
    kb.records.forEach(r => {
      if (!isState(r.state) || !EXEMPLAR_STREAMS.includes(r.stream)) return;
      const L = r.links || {}, pres = strip(L.present), against = strip(L.unrelated).concat(strip(L.inverse));
      const w = (pres.length === 1 ? 1 : (pres.length > 1 && !kb.configs.some(c => c.state === r.state && c.stream === r.stream && c.aus.length === pres.length && pres.every(a => c.aus.includes(a)))) ? 0.5 : 0) * (r.frac || 1);   // r.frac: the row covers part of a study (one culture of five)
      if (w) pres.forEach(a => { const x = slot(r.stream, r.state, a); x.recs.push(r.id);
        if (EMP.has(r.type)) { x.units.set(r.unit, r.frac ? Math.min(1, (x.units.get(r.unit) || 0) + w) : Math.max(w, x.units.get(r.unit) || 0)); if (r.type === 'DE') x.de.add(r.unit); }   // parts of one study add up
        else if (r.type === 'TH') x.th.add(r.unit); else if (r.type === 'RL') x.rv.add(r.unit); });
      if (EMP.has(r.type)) against.forEach(a => slot(r.stream, r.state, a).contra.add(r.unit));
    });
    S.forEach(x => {
      const u = [...x.units.values()].reduce((t, v) => t + v, 0);
      const ev = u + 0.6 * x.th.size + 0.5 * x.rv.size - 0.7 * x.contra.size;
      EX.push({ kind: 'single', aus: [x.au], au: x.au, state: x.state, stream: x.stream, ev, units: x.units.size, unitsDE: x.de.size, theory: x.th.size, reviews: x.rv.size, contra: x.contra.size, recs: x.recs });
    });
    // systematic-review vote counts: one exemplar per counted action (or pooled category of actions)
    (kb.relspec || []).filter(e => e.measure === 'study_share' && e.show !== false && e.estimate != null && e.k && EXEMPLAR_STREAMS.includes(e.stream) && isState(e.state)).forEach(e => {
      const aus = (e.rel && e.rel.length ? e.rel : e.aus || []).map(String); if (!aus.length) return;
      EX.push({ kind: 'review', aus, pooled: aus.length > 1, state: e.state, stream: e.stream, ev: Math.min(REV_CAP, e.k * e.estimate), k: e.k, share: e.estimate, cite: e.cite });
    });
    // reliability estimates (how often the face appeared with the state): exemplars weighted by the rate, so a face seen in
    // 12% of cases counts far less than one seen in most
    (kb.relspec || []).filter(e => ['reliability', 'time_share'].includes(e.measure) && e.show !== false && e.estimate != null && (e.aus || []).length && EXEMPLAR_STREAMS.includes(e.stream) && isState(e.state) && kb.states[e.state]).forEach(e => {
      const n = e.meta ? Math.min(3, e.k || 1) : 1;
      EX.push({ kind: 'estimate', aus: e.aus.map(String), pooled: !!e.alt && e.aus.length > 1, state: e.state, stream: e.stream, ev: n * Math.min(1, 2 * e.estimate), rate: e.estimate, k: e.k, cite: e.cite, units: n });
    });
    Object.defineProperty(kb, '_ex', { value: EX, enumerable: false });
    return EX;
  }
  const OBS_ONLY = new Set(['pleasantness', 'unpleasantness', 'unexpectedness']);   // appraisals observers inferred, not states people reported
  let MISS_SEL = 2.8, MISS_EX = 0.6, COVER_W = 1.5;
  function tune(a, b, c) { MISS_SEL = a; MISS_EX = b; if (c != null) COVER_W = c; }
  const MODES = { feel: ['spontaneous', 'posed', 'theory', 'perception'], observers: ['perception', 'theory'], function: ['function'] };
  function rank5(I, codes, mode) {
    const groups = MODES[mode] || MODES.feel, S = [...new Set((codes || []).map(String))];
    if (!S.length) return [];
    const per = new Map();
    exemplars(I.kb).forEach(x => {
      if (!groups.includes(x.stream) || x.ev <= 0 || (mode !== 'observers' && OBS_ONLY.has(x.state))) return;
      // Tversky overlap: selected actions the exemplar lacks count against it more (1.5) than exemplar actions not selected (0.6),
      // because real displays are often partial; a pooled review category is one slot, satisfied in part by one of its actions
      let inter, sMiss, eMiss;
      if (x.pooled) { const m = S.filter(a => x.aus.includes(a)).length; if (!m) return; inter = (1 + m) / (1 + x.aus.length); sMiss = S.length - m; eMiss = 0; }
      else { inter = S.filter(a => x.aus.includes(a)).length; if (!inter) return; sMiss = S.length - inter; eMiss = x.aus.length - inter; }
      const sim = inter / (inter + MISS_SEL * sMiss + MISS_EX * eMiss), v = GW[x.stream] * sim * sim * (1 + Math.log(1 + x.ev));
      if (!per.has(x.state)) per.set(x.state, {});
      const m = per.get(x.state); (m[x.stream] = m[x.stream] || []).push({ v, x, sim });
    });
    // coverage: how well the state's single-action evidence covers every selected action (geometric mean, floor 0.05),
    // so a display reported as separate components (smile, smile control, gaze down) still adds up for its state
    const cover = new Map();
    if (S.length >= 2) exemplars(I.kb).forEach(x => {
      if (x.kind === 'config' || !groups.includes(x.stream) || x.ev <= 0 || (!x.pooled && x.aus.length > 1) || (mode !== 'observers' && OBS_ONLY.has(x.state))) return;
      const v = Math.min(1, GW[x.stream] * (1 + Math.log(1 + x.ev)) / 2);
      x.aus.forEach(a => { if (!S.includes(a)) return; const c = cover.get(x.state) || {}; c[a] = Math.max(c[a] || 0, v); cover.set(x.state, c); });
    });
    const out = [];
    per.forEach((m, state) => {
      let score = 0, top = null;
      const c = cover.get(state);
      const coverage = c ? Math.exp(S.reduce((t, a) => t + Math.log(Math.max(0.05, c[a] || 0)), 0) / S.length) : 0;
      score += COVER_W * coverage;
      Object.values(m).forEach(L => {
        L.sort((a, b) => b.v - a.v);
        const agg = Math.min(2 * L[0].v, L[0].v + 0.35 * (L[1] ? L[1].v : 0) + 0.1 * L.slice(2).reduce((t, y) => t + y.v, 0));
        score += agg; if (!top || L[0].v > top.v) top = L[0];
      });
      if (!familyOf(state)) score *= 0.6;
      const x = top.x;
      const basis = x.kind === 'config' ? { kind: 'config', aus: x.aus, stream: x.stream, jac: top.sim, units: x.units, unitsDE: x.unitsDE, reviews: x.reviews, theory: x.theory, contra: x.contra }
        : x.kind === 'review' ? { kind: 'review', au: x.aus.join('/'), aus: x.aus, stream: x.stream, k: x.k, share: x.share, cite: x.cite, jac: top.sim }
        : x.kind === 'estimate' ? { kind: 'estimate', aus: x.aus, stream: x.stream, rate: x.rate, k: x.k, cite: x.cite, jac: top.sim, units: x.units }
        : { kind: 'single', au: x.au, aus: x.aus, stream: x.stream, n: x.units, units: x.units, unitsDE: x.unitsDE, theory: x.theory, contra: x.contra, jac: top.sim };
      out.push({ state, score, family: familyOf(state), top: basis, topV: top.v, streams: Object.keys(m), coverage });
    });
    return out.sort((a, b) => b.score - a.score || a.state.localeCompare(b.state));
  }
  function explain(I, codes, state, mode) {   // the exemplars behind one state's score, for checking the engine
    const groups = MODES[mode] || MODES.feel, S = [...new Set(codes.map(String))], out = [];
    exemplars(I.kb).forEach(x => { if (x.state !== state || !groups.includes(x.stream) || x.ev <= 0) return;
      let inter, sMiss, eMiss;
      if (x.pooled) { const m = S.filter(a => x.aus.includes(a)).length; if (!m) return; inter = (1 + m) / (1 + x.aus.length); sMiss = S.length - m; eMiss = 0; }
      else { inter = S.filter(a => x.aus.includes(a)).length; if (!inter) return; sMiss = S.length - inter; eMiss = x.aus.length - inter; }
      const sim = inter / (inter + MISS_SEL * sMiss + MISS_EX * eMiss); out.push({ v: GW[x.stream] * sim * sim * (1 + Math.log(1 + x.ev)), sim, kind: x.kind, stream: x.stream, aus: x.aus.join('+'), ev: x.ev, cite: x.cite }); });
    return out.sort((a, b) => b.v - a.v);
  }
  const CONF_RANK = { none: 0, low: 1, moderate: 2, high: 3 };
  function verdictOf(I, codes, R, M, mode) {
    const top = R[0]; if (!top) return { kind: 'none', state: null, label: '', members: [], confidence: 'none' };
    const N = R.slice(0, 12), tot = N.reduce((t, r) => t + r.score, 0) || 1;
    const fam = {};
    N.forEach(r => { if (!r.family) return; const f = fam[r.family] || (fam[r.family] = { family: r.family, label: FAMILIES[r.family].label, mass: 0, members: [] }); f.mass += r.score / tot; f.members.push(r); });
    const fams = Object.values(fam).sort((a, b) => b.mass - a.mass);
    const byState = new Map((M || []).map(r => [r.state, r]));
    const gradeOfState = s => { const r = byState.get(s); return r ? Math.max(...['spontaneous', 'posed', 'perception'].map(t => r.cells[t] ? r.cells[t].g : -1)) : -1; };
    const second = R[1], ratio = second ? top.score / second.score : 9;
    const rivals = N.slice(1).filter(r => r.family === top.family && gradeOfState(r.state) >= 2 && r.score >= 0.15 * top.score);
    const prodOK = mode === 'observers' ? ['perception'] : mode === 'function' ? ['function'] : ['spontaneous', 'posed'];
    const tested = top.top.jac === 1 && !!(top.top.units || top.top.k) && prodOK.includes(top.top.stream);   // an exemplar with exactly these actions, empirical evidence, and the right type of study
    const g = gradeOfState(top.state);
    let kind, members, confidence;
    // a moderate lead names one state only if it also has the better match: a lead built from many weak single-action links
    // (research attention) over a rival family with a closer reported configuration is not specific
    const cross = second && second.family !== top.family ? second : null, matchOK = !cross || (top.topV || 0) >= 0.8 * (cross.topV || 0);
    if (top.family && (ratio >= 2.5 || (ratio >= 1.6 && matchOK && !rivals.some(r => r.score >= 0.4 * top.score)))) {
      kind = 'state'; members = [top];
      confidence = (tested && g >= 3 && ratio >= 2.5) ? 'high' : ((codes.length === 1 ? g >= 3 : (tested || g >= 3))) ? 'moderate' : 'low';
      if (confidence === 'high' && rivals.some(r => r.score >= 0.25 * top.score)) confidence = 'moderate';
      if (codes.length === 1 && confidence === 'high') confidence = 'moderate';       // one action is rarely specific to one state
    } else if (fams[0] && fams[0].mass >= 0.55 && fams[0].family === top.family) {
      kind = 'family';
      const major = fams[0].members.filter(r => ((I.kb.states[r.state] || {}).n || 0) >= 2);   // prefer states studied more than once over one-off labels
      members = (major.length >= 2 ? major : fams[0].members).slice(0, 3);
      const fg = Math.max(...fams[0].members.slice(0, 3).map(r => gradeOfState(r.state)));
      confidence = (fams[0].mass >= 0.75 && fg >= 3) ? 'moderate' : 'low';
    } else {
      kind = 'mixed'; const seen = new Set(); members = [];
      N.forEach(r => { const k = r.family || r.state; if (members.length < 3 && !seen.has(k)) { seen.add(k); members.push(r); } });
      confidence = 'low';
    }
    const f = fams.find(x => x.family === (kind === 'mixed' ? null : members[0].family));
    return { kind, state: top.state, family: kind === 'mixed' ? null : members[0].family, familyLabel: kind === 'mixed' ? 'Not specific' : FAMILIES[members[0].family].label,
      familyShare: f ? f.mass : 0, members: members.map(r => r.state), confidence, tested, grade: g, ratio, families: fams.map(x => ({ family: x.family, label: x.label, share: x.mass, members: x.members.slice(0, 4).map(r => r.state) })) };
  }
  const NEXT_CANDIDATES = ['1', '2', '4', '5', '6', '7', '9', '10', '12', '14', '15', '17', '20', '23', '24', '25', '26', '43'];
  /** What if one more action were seen? For each common action not selected: the verdict with it added (which additions would
   *  sharpen or change the reading), and for each competing reading, the addition that would most favour it ("tips"). */
  function whatIf(I, codes, base, alts) {
    const S = [...new Set((codes || []).map(String))], next = [], tipBest = new Map();
    const rivals = (alts || []).slice(0, 4).map(a => a.state);
    NEXT_CANDIDATES.filter(a => !S.includes(a) && I.kb.aus[a]).forEach(a => {
      const S2 = S.concat(a).sort((x, y) => +x - +y), R = rank5(I, S2, 'feel'); if (!R.length) return;
      rivals.forEach(st => {
        const i = R.findIndex(r => r.state === st); if (i < 0) return;
        const rel = R[i].score / (i === 0 ? (R[1] ? R[1].score : R[0].score / 3) : R[0].score);   // >1: it leads, by this much
        const cur = tipBest.get(st); if (!cur || rel > cur.rel) tipBest.set(st, { state: st, add: a, rel, leads: i === 0 });
      });
      const v = verdictOf(I, S2, R, matrix(I, S2));
      if (v.kind !== 'state' || CONF_RANK[v.confidence] < 2) return;
      next.push({ add: a, codes: S2, state: v.state, family: v.family, confidence: v.confidence, tested: v.tested, grade: v.grade, changes: !base || v.state !== base.state });
    });
    next.sort((x, y) => CONF_RANK[y.confidence] - CONF_RANK[x.confidence] || (y.tested - x.tested) || (y.grade - x.grade) || (y.changes - x.changes) || (+x.add - +y.add));
    const seen = new Set();
    return { next: next.filter(x => !seen.has(x.state) && seen.add(x.state)).slice(0, 6), tips: [...tipBest.values()].filter(t => t.leads).sort((a, b) => b.rel - a.rel) };
  }
  function nextActions(I, codes, base) { return whatIf(I, codes, base, []).next; }
  /** The best guess (v5): verdict, ranked readings with their basis and graded evidence, what observers would infer,
   *  uses beyond emotion, and (opt.next) the actions whose addition would sharpen or change the reading. */
  function bestGuess5(I, codes, opt) {
    opt = opt || {};
    codes = [...new Set((codes || []).map(String))].filter(a => I.kb.aus[a]).sort((a, b) => +a - +b);
    const M = matrix(I, codes), byState = new Map(M.map(r => [r.state, r]));
    const cell = (s, t) => (byState.get(s) || { cells: {} }).cells[t] || null;
    const feel = rank5(I, codes, 'feel'), obs = rank5(I, codes, 'observers'), fn = rank5(I, codes, 'function');
    if (!codes.length || !feel.length) {
      const c1 = codes.length === 1 && I.kb.aus[codes[0]].interp4 && I.kb.aus[codes[0]].interp4.best, t1 = c1 && c1.state ? String(c1.state) : '';
      const V0 = { kind: 'none', members: [], confidence: 'none', families: [] };
      if (t1) { const cut = t1.indexOf(';'); V0.curated = { label: cut > 0 ? t1.slice(0, cut).trim() : t1, more: cut > 0 ? t1.slice(cut + 1).trim() : '', why: c1.why || '' }; V0.confidence = 'low'; }
      return { state: null, confidence: V0.confidence, verdict: V0, matrix: M, alternatives: [], observers: null, functions: fn.slice(0, 3).map(r => ({ state: r.state, family: r.family, score: r.score, basis: r.top })), codes, next: [] };
    }
    const V = verdictOf(I, codes, feel, M), tot = feel.slice(0, 5).reduce((t, x) => t + x.score, 0);
    // a single action: the curated reading written for it (from the evidence, weighing study designs the scores cannot see)
    const cur = codes.length === 1 && I.kb.aus[codes[0]].interp4 && I.kb.aus[codes[0]].interp4.best;
    if (cur && cur.state) {
      const txt = String(cur.state).trim(), cut = txt.indexOf(';');
      V.computed = { kind: V.kind, members: V.members.slice(), familyLabel: V.familyLabel, confidence: V.confidence };
      V.curated = { label: cut > 0 ? txt.slice(0, cut).trim() : txt, more: cut > 0 ? txt.slice(cut + 1).trim() : '', why: cur.why || '' };
      if (/^not specific/i.test(txt)) { V.kind = 'mixed'; V.familyLabel = 'Not specific'; V.confidence = 'low'; }
    }
    const out = r => r && { state: r.state, family: r.family, score: r.score, basis: r.top, share: r.score / tot, spont: cell(r.state, 'spontaneous'), posed: cell(r.state, 'posed'), perc: cell(r.state, 'perception'),
      confidence: r === feel[0] ? V.confidence : 'low' };
    const best = out(feel[0]);
    const obsV = obs.length ? verdictOf(I, codes, obs, M, 'observers') : null;
    return Object.assign(best, { verdict: V, tested: V.tested, alternatives: feel.slice(1, 6).map(out),
      observers: obs[0] ? Object.assign(out(obs[0]), { confidence: obsV.confidence, verdict: obsV }) : null,
      functions: fn.slice(0, 3).map(r => Object.assign(out(r), { grade: Math.max(-1, (cell(r.state, 'function') || { g: -1 }).g) })), matrix: M, codes,
      ...(opt.next ? (() => { const W = whatIf(I, codes, best, feel.slice(1, 5)); return { next: W.next, tips: W.tips }; })() : {}) });
  }

  return { PROD, STREAM_LABEL, LEVELS, LEVELS_SINGLE, SKIP_STATES, normAU, parseCombo, slug, index, single, joint, readings, bestGuess, pairNotes, relspec, relspecValue, relspecSentence,
    GRADE, gradeOf, matrix, reviewSupport, rateTable, guess, rankStates, bestGuess4: bestGuess5, bestGuess4Legacy: bestGuess4, bestGuess5, rank5, verdictOf, nextActions, exemplars, familyOf, FAMILIES, isState, explain, tune, whatIf };
});

/* ---- src/au-adapters.js ---- */
/* AUAdapters: read AU detector output (CSV text) into a common time-series format.
 * Presets: OpenFace 2, Py-Feat, FaceReader, iMotions/Affectiva AFFDEX, MediaPipe face blendshapes, generic AU columns.
 * Output: {format, label, t: number[] (seconds), aus: {code: number[] in 0..1}, raw: {code: column}, other: {name: number[]},
 *          notes: string[], approximate: bool, binary: [codes reported as 0/1 only], groups: null | {column, values: [{key, n}], selected}}.
 * Values are rescaled to 0..1 for display only (one scale per file); the original values are kept in raw.
 * Files with several faces, people or videos (a face_id, person, video, file... column with several values) are read one
 * group at a time: parse(text, {group: key}).
 * Vendor metrics that are not FACS action units (AFFDEX, MediaPipe) are mapped to the nearest AU and flagged as approximate. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AUAdapters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function parseCSV(text) {
    const first = text.slice(0, text.indexOf('\n') + 1 || text.length);
    const c = (first.match(/,/g) || []).length, s = (first.match(/;/g) || []).length, tb = (first.match(/\t/g) || []).length;
    const delim = tb > c && tb > s ? '\t' : s > c ? ';' : ',';
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
  }
  const AFFDEX = { 'inner brow raise': '1', 'brow raise': '2', 'brow furrow': '4', 'eye widen': '5', 'cheek raise': '6', 'lid tighten': '7', 'nose wrinkle': '9', 'upper lip raise': '10',
    'smile': '12', 'dimpler': '14', 'lip corner depressor': '15', 'chin raise': '17', 'lip pucker': '18', 'lip stretch': '20', 'lip press': '24', 'mouth open': '25', 'jaw drop': '26', 'lip suck': '28', 'eye closure': '43' };
  const MEDIAPIPE = { browinnerup: '1', browouterup: '2', browdown: '4', eyewide: '5', cheeksquint: '6', eyesquint: '7', nosesneer: '9', mouthupperup: '10', mouthsmile: '12',
    mouthdimple: '14', mouthfrown: '15', mouthshruglower: '17', mouthpucker: '18', mouthstretch: '20', mouthfunnel: '22', mouthpress: '24', mouthlowerdown: '25', jawopen: '26', mouthrollupper: '28', mouthrolllower: '28', eyeblink: '45' };
  const TIME = /^(time|timestamp|time_s|seconds|sec|t|approx_time|frame_time|video time|mediatime|media time|time \(s\))$/i;
  function num(v) { if (v == null) return NaN; const s = String(v).trim(); if (s === '' || /^(na|nan|null|none)$/i.test(s)) return NaN; return +s; }
  function timeVal(v) {
    const s = String(v).trim(); if (/^\d+:\d{2}:\d{2}(\.\d+)?$/.test(s)) { const [h, m, x] = s.split(':'); return 3600 * +h + 60 * +m + +x; }
    if (/^\d+:\d{2}(\.\d+)?$/.test(s)) { const [m, x] = s.split(':'); return 60 * +m + +x; }
    return num(s);
  }
  const FR_LETTER = { A: 0.2, B: 0.4, C: 0.6, D: 0.8, E: 1 };
  const GROUP = /^(face_?id|face|person(_?id)?|participant(_?id)?|subject(_?id)?|speaker|actor|input|video|file(name)?|clip|session|trial)$/i;
  function detect(head) {
    const H = head.map(h => String(h).trim());
    const low = H.map(h => h.toLowerCase());
    const out = { format: 'generic', label: 'Generic AU columns', cols: {}, presence: {}, scale: 1, approximate: false, notes: [] };
    if (low.some(h => /^au\d+_r$/.test(h)) && low.some(h => /^au\d+_c$/.test(h))) {
      out.format = 'openface'; out.label = 'OpenFace 2 (intensity 0–5 and presence)';
      H.forEach((h, j) => { const m = h.match(/^AU0*(\d+)_r$/i); if (m) out.cols[m[1]] = j; const c = h.match(/^AU0*(\d+)_c$/i); if (c) out.presence[c[1]] = j; });
      out.presenceOnly = {};
      Object.keys(out.presence).forEach(k => { if (out.cols[k] == null) { out.cols[k] = out.presence[k]; out.presenceOnly[k] = true; } });
      out.scale = 5; out.notes.push('OpenFace intensities (_r, 0 to 5) were divided by 5; presence (_c) is used for activity when available.');
      if (Object.keys(out.presenceOnly).length) out.notes.push(Object.keys(out.presenceOnly).sort((a, b) => a - b).map(a => 'AU' + a).join(', ') + ': presence only (0 or 1), no intensity.');
    } else if (low.some(h => /^action unit \d+/.test(h))) {
      out.format = 'facereader'; out.label = 'FaceReader action units';
      H.forEach((h, j) => { const m = h.match(/^Action Unit 0*(\d+)/i); if (m) out.cols[m[1]] = j; });
      out.notes.push('FaceReader intensity letters A to E were mapped to 0.2 to 1.');
    } else if (low.some(h => /^au0*\d+$/.test(h))) {
      out.format = 'pyfeat'; out.label = 'Py-Feat or similar (AU probabilities or intensities)';
      H.forEach((h, j) => { const m = h.match(/^AU0*(\d+)$/i); if (m) out.cols[m[1]] = j; });
    } else if (low.some(h => AFFDEX[h] != null)) {
      out.format = 'affdex'; out.label = 'iMotions / Affectiva AFFDEX (vendor metrics, approximate AU mapping)'; out.approximate = true; out.scale = 100;
      H.forEach((h, j) => { const k = AFFDEX[h.toLowerCase()]; if (k && out.cols[k] == null) out.cols[k] = j; });
      out.notes.push('AFFDEX metrics (0 to 100) were divided by 100 and mapped to the nearest FACS action unit; they are vendor classifiers, not FACS codes.');
    } else if (low.some(h => /^(browinnerup|jawopen|mouthsmile(left|right)?|eyeblink(left|right)?)$/.test(h.replace(/[_\s]/g, '')))) {
      out.format = 'mediapipe'; out.label = 'MediaPipe face blendshapes (approximate AU mapping)'; out.approximate = true;
      const acc = {};
      H.forEach((h, j) => { const k = h.toLowerCase().replace(/[_\s]/g, '').replace(/(left|right)$/, ''); const a = MEDIAPIPE[k]; if (a) (acc[a] = acc[a] || []).push(j); });
      out.multi = acc; Object.keys(acc).forEach(a => out.cols[a] = acc[a][0]);
      out.notes.push('MediaPipe blendshapes (0 to 1) were averaged over left and right and mapped to the nearest action unit; they are geometric coefficients, not FACS codes.');
    } else {
      H.forEach((h, j) => { const m = h.match(/^AU\s*0*(\d+)(?:[_\s-]*(r|int|intensity|prob|probability|evidence|value))?$/i); if (m && out.cols[m[1]] == null) out.cols[m[1]] = j; });
    }
    out.timeCol = low.findIndex(h => TIME.test(h));
    out.frameCol = low.findIndex(h => /^(frame|frame_number|frameindex|frame_idx)$/.test(h));
    const used = new Set(Object.values(out.cols).concat(Object.values(out.presence), out.multi ? Object.values(out.multi).flat() : [], [out.timeCol, out.frameCol]));
    /* columns that identify several faces, people or videos in one file */
    out.groupCols = H.map((h, j) => j).filter(j => !used.has(j) && GROUP.test(H[j].trim()));
    out.otherCols = H.map((h, j) => j).filter(j => !used.has(j) && !out.groupCols.includes(j) && !/^(face|success|confidence|facescore|face_id|person|id|input|file|video)/i.test(H[j]));
    return out;
  }
  function parse(text, opt) {
    opt = opt || {};
    const rows = parseCSV(text); if (rows.length < 2) throw new Error('The file has no data rows.');
    const head = rows[0].map(h => String(h).trim());
    let body = rows.slice(1);
    const D = detect(head);
    /* several faces, people or videos: keep one at a time */
    let groups = null;
    for (const j of D.groupCols) {
      const keys = []; const n = new Map();
      body.forEach(r => { const k = String(r[j] == null ? '' : r[j]).trim(); if (!n.has(k)) { n.set(k, 0); keys.push(k); } n.set(k, n.get(k) + 1); });
      if (keys.length > 1) { groups = { column: head[j], values: keys.map(k => ({ key: k, n: n.get(k) })) }; break; }
    }
    if (groups) {
      const key = opt.group != null && groups.values.some(v => v.key === String(opt.group)) ? String(opt.group) : groups.values[0].key, j = head.indexOf(groups.column);
      body = body.filter(r => String(r[j] == null ? '' : r[j]).trim() === key); groups.selected = key;
      D.notes.push(`The file holds ${groups.values.length} values of “${groups.column}”; showing ${groups.column} = ${key}. Choose another to view it.`);
    }
    if (!Object.keys(D.cols).length) throw new Error('No action-unit columns were recognised. Expected columns such as AU12, AU12_r, "Action Unit 12", AFFDEX metric names or MediaPipe blendshape names.');
    let t;
    if (D.timeCol >= 0) {
      t = body.map(r => timeVal(r[D.timeCol]));
      const hn = head[D.timeCol].toLowerCase();
      if (/timestamp|mediatime|media time/.test(hn) && Math.max(...t.filter(isFinite)) > 3600) { t = t.map(v => v / 1000); D.notes.push('Timestamps were read as milliseconds.'); }
    } else {
      const fps = opt.fps || 30; const fr = D.frameCol >= 0 ? body.map(r => num(r[D.frameCol])) : body.map((_, i) => i);
      t = fr.map(f => f / fps); D.notes.push('No time column was found; time was computed from frame numbers at ' + fps + ' frames per second.');
    }
    const aus = {}, raw = {}, active = {};
    /* one scale per file for formats without a documented scale (a column-by-column guess would rescale low columns wrongly) */
    let fileScale = null;
    if (D.format === 'generic' || D.format === 'pyfeat') {
      let mx = -Infinity; Object.values(D.cols).forEach(j => body.forEach(r => { const x = num(r[j]); if (isFinite(x) && x > mx) mx = x; }));
      fileScale = mx > 5.5 ? 100 : mx > 1.05 ? 5 : 1;
      if (fileScale !== 1) D.notes.push(`Values were divided by ${fileScale} for display (largest value in the file ${mx}).`);
    }
    Object.entries(D.cols).forEach(([a, j]) => {
      let v;
      if (D.multi && D.multi[a] && D.multi[a].length > 1) v = body.map(r => { const xs = D.multi[a].map(k => num(r[k])).filter(isFinite); return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN; });
      else if (D.format === 'facereader') v = body.map(r => { const s = String(r[j]).trim(); return FR_LETTER[s.toUpperCase()] != null ? FR_LETTER[s.toUpperCase()] : (/notactive|not active/i.test(s) ? 0 : num(s)); });
      else v = body.map(r => num(r[j]));
      raw[a] = v.slice();
      const sc = fileScale != null ? fileScale : (D.presenceOnly && D.presenceOnly[a] ? 1 : D.scale);
      aus[a] = v.map(x => isFinite(x) ? Math.max(0, Math.min(1, x / sc)) : NaN);
      if (D.presence[a] != null) active[a] = body.map(r => num(r[D.presence[a]]) >= 0.5 ? 1 : 0);
    });
    const other = {};
    D.otherCols.forEach(j => { const v = body.map(r => num(r[j])); if (v.filter(isFinite).length > 0.8 * v.length && new Set(v.filter(isFinite)).size > 2) other[head[j]] = v; });
    const order = t.map((x, i) => i).filter(i => isFinite(t[i])).sort((a, b) => t[a] - t[b]);
    const pick = arr => order.map(i => arr[i]);
    const res = { format: D.format, label: D.label, approximate: D.approximate, notes: D.notes, t: pick(t), aus: {}, raw: {}, active: {}, other: {}, groups };
    Object.keys(aus).forEach(a => { res.aus[a] = pick(aus[a]); res.raw[a] = pick(raw[a]); if (active[a]) res.active[a] = pick(active[a]); });
    Object.keys(other).forEach(k => res.other[k] = pick(other[k]));
    if (res.t.length > 1) { const dt = (res.t[res.t.length - 1] - res.t[0]) / (res.t.length - 1); res.fps = dt > 0 ? 1 / dt : null; }
    { let dup = 0; for (let i = 1; i < res.t.length; i++) if (res.t[i] === res.t[i - 1]) dup++;
      if (dup > 0.1 * res.t.length) res.notes.push(`${dup} rows share a time stamp with the previous row; the file may hold several faces without an identifying column.`); }
    /* actions reported only as 0 or 1 (presence, not a graded estimate) */
    res.binary = Object.keys(res.raw).filter(a => { const f = res.raw[a].filter(isFinite); return f.length > 2 && f.every(x => x === 0 || x === 1); }).sort((a, b) => +a - +b);
    const binNote = res.binary.filter(a => !(D.presenceOnly && D.presenceOnly[a]));
    if (binNote.length) res.notes.push(binNote.map(a => 'AU' + a).join(', ') + ' contain only 0 and 1: the detector reports presence for ' + (binNote.length > 1 ? 'these actions' : 'this action') + ', not a graded estimate.');
    return res;
  }
  /** Median filter (odd window, in samples) for display smoothing. */
  function smooth(v, w) {
    if (!w || w < 3) return v.slice(); const h = Math.floor(w / 2), out = new Array(v.length);
    for (let i = 0; i < v.length; i++) { const s = v.slice(Math.max(0, i - h), i + h + 1).filter(isFinite).sort((a, b) => a - b); out[i] = s.length ? s[Math.floor(s.length / 2)] : NaN; }
    return out;
  }
  /** Measured values at time t (nearest sample) and the actions at or above a threshold (or flagged present by the
   *  detector's own presence column). Measurement only: this says which movements the detector reported, nothing more. */
  function at(series, t, opt) {
    opt = opt || {}; const thr = opt.threshold == null ? 0.5 : opt.threshold, T = series.t;
    if (!T || !T.length) return null;
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m; else hi = m; }
    const i = Math.abs(T[lo] - t) <= Math.abs(T[hi] - t) ? lo : hi;
    const values = {}, active = [];
    Object.keys(series.aus).forEach(a => {
      const v = series.aus[a][i]; values[a] = v;
      const on = series.active && series.active[a] ? series.active[a][i] === 1 : v >= thr;
      if (isFinite(v) && on) active.push(a);
    });
    return { i, t: T[i], values, active: active.sort((a, b) => +a - +b), threshold: thr, format: series.format, label: series.label, approximate: !!series.approximate, binary: series.binary || [] };
  }
  return { parseCSV, detect, parse, smooth, at, AFFDEX, MEDIAPIPE };
});

/* ---- app/js/core.js ---- */
/* Core: state, loading, routing, shared components. */
'use strict';
/* The tool's public name lives in one place: the <title> element of index.html. The header, the footer, page titles
 * and the citation line read it from there, so renaming the tool means editing that one line. */
const TITLE = String(document.title || '').trim();
document.querySelectorAll('[data-tool-title]').forEach(el => { el.textContent = TITLE; });
const A = { v43: true, kb: null, I: null, cr: null, frames: null, framesP: null, route: { v: 'home' } };
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = window.AUEvidence;
const fmt = {
  n: (x, d = 0) => x == null || !isFinite(x) ? '–' : (+x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  p: p => p == null || !isFinite(p) ? '–' : p < .001 ? '< .001' : p.toFixed(3).replace(/^0/, ''),
  r: (x, d = 2) => { if (x == null || !isFinite(x)) return '–'; let s = (+x).toFixed(d); if (/^-0\.0*$/.test(s)) s = s.slice(1); return s.replace(/^(-?)0\./, '$1.'); },
  pct: (x, d = 0) => x == null || !isFinite(x) ? '–' : (100 * x).toFixed(d) + '%'
};
const STREAMS = ['posed', 'spontaneous', 'posed vs spontaneous', 'perception', 'function', 'theory', 'review', 'automated', 'method', 'other'];
const STREAM_SHORT = { posed: 'Posed', spontaneous: 'Spontaneous', 'posed vs spontaneous': 'Posed vs spontaneous', perception: 'Perception', function: 'Function', theory: 'Theory', review: 'Review', automated: 'Automated', method: 'Method', comparative: 'Comparative', other: 'Other' };
const swClass = s => s === 'posed' ? 'posed' : s === 'spontaneous' ? 'spontaneous' : s === 'perception' ? 'perception' : s === 'function' ? 'function' : s === 'posed vs spontaneous' ? 'pvs' : '';
const streamTag = s => `<span class="stream"><i class="sw ${swClass(s)}"></i>${esc(STREAM_SHORT[s] || s)}</span>`;
/* n with the right noun form: pl(1, 'sample') -> '1 sample', pl(3, 'sample') -> '3 samples' */
const pl = (n, one, many) => `${fmt.n(n)} ${n === 1 ? one : (many || one + 's')}`;
/* evidence type as a word with a strength dot (filled: coded data; half: as reported; hollow: reviews, theory, indirect) */
const ET_WORD = { DE: 'direct', SA: 'secondary analysis', AR: 'author-reported', RL: 'review', TH: 'theory', IN: 'indirect' };
function typeBadge(t, opt) {
  const d = A.kb && A.kb.meta.evidenceTypes[t];
  return `<abbr class="et et-${esc(t)}${opt && opt.dot ? ' dot' : ''}" title="${esc(d ? d.label + ': ' + d.desc : t)}">${opt && opt.dot ? '' : esc(ET_WORD[t] || t)}</abbr>`;
}
const DIR_LABEL = { supports: 'supports', null: 'null result', qualifies: 'qualifies', contradicts: 'contradicts' };
const dirMark = d => `<span class="dir dir-${esc(d)}">${esc(DIR_LABEL[d] || d)}</span>`;
function auName(c) { const a = A.kb.aus[c]; return a ? a.name : 'Action unit ' + c; }
function auChip(c, on) { return `<a class="auchip${on ? ' on' : ''}" href="#au-${esc(c)}" title="${esc(auName(c))}"><b>AU${esc(c)}</b><span>${esc(auName(c))}</span></a>`; }
function auCode(c) { return `<a href="#au-${esc(c)}" class="mono" title="${esc(auName(c))}">AU${esc(c)}</a>`; }
function stateLabel(s) { const d = A.kb && A.kb.states[s] && A.kb.states[s].display; return d && d.label ? d.label : String(s); }
function stateLink(s, label) { const g = A.I.stateSlug.get(s); const d = A.kb.states[s] && A.kb.states[s].display; const t = label || stateLabel(s);
  return g ? `<a href="#state-${esc(g)}"${d && d.gloss ? ` title="${esc(d.gloss)}"` : ''}>${esc(t)}</a>` : esc(t); }
function studyOf(id) { return A.kb.studies[id]; }
/* "Crivelli, C., Carrera, P., & Fernández-Dols, J.-M. (2015). Title…" -> "Crivelli et al., 2015" */
function shortCite(cit) {
  const s = String(cit || ''); const y = (s.match(/\((\d{4}[a-z]?)\)/) || [])[1];
  const authors = s.split(/\(\d{4}/)[0]; const surn = authors.split(/,\s*(?:[A-Z]\.\s*-?)+(?:,|&|$)\s*&?\s*/).map(x => x.trim().replace(/^&\s*/, '')).filter(x => x && !/^[A-Z]\.$/.test(x));
  if (!y || !surn.length) return s.slice(0, 80);
  return (surn.length === 1 ? surn[0] : surn.length === 2 ? surn[0] + ' & ' + surn[1] : surn[0] + ' et al.') + ', ' + y;
}
function citeLink(cl) {
  const st = studyOf(cl.study);
  const url = st && (st.doi ? 'https://doi.org/' + st.doi : st.url);
  return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(cl.cite)}</a>` : esc(cl.cite);
}
/* one verified finding as a ledger row: [stream, direction, states | finding, numbers, limitation | source, actions, evidence] */
function claimCard(cl, opt) {
  opt = opt || {};
  const aus = cl.aus.length ? cl.aus.map(a => auCode(a)).join(', ') : 'not action-specific';
  return `<article class="claim c-${esc(cl.dir)}" id="claim-${esc(cl.id)}">
    <div class="c-a">${opt.noStream ? '' : streamTag(cl.stream)}${dirMark(cl.dir)}<div class="sts">${cl.states.map(s => stateLink(s)).join(', ')}</div></div>
    <div class="c-b"><div class="txt">${esc(cl.text)}</div>${cl.num ? `<div class="num">${esc(cl.num)}</div>` : ''}${cl.lim ? `<div class="lim">Limitation: ${esc(cl.lim)}</div>` : ''}</div>
    <div class="c-c"><div class="cite">${citeLink(cl)}</div><div class="codes">${aus}</div><div class="ev">${typeBadge(cl.type)}<span>${esc(cl.basis)}</span><a href="#claim-${esc(cl.id)}" class="mono">${esc(cl.id)}</a></div></div>
  </article>`;
}
/* one verified finding as a card: the key number large, the finding as its caption, details on demand */
const STREAM_COL = { spontaneous: 'var(--s-spont)', posed: 'var(--s-posed)', perception: 'var(--s-perc)', function: 'var(--s-func)', 'posed vs spontaneous': 'var(--s-posed)' };
function findingCard(c, opt) {
  opt = opt || {};
  const t = c.v4 || {}, num = t.num || c.num, lim = t.lim || c.lim;
  const key = t.key && t.key.value ? `<div class="fk"><b>${esc(t.key.value)}</b><span>${esc(t.key.what || '')}</span></div>` : '';
  return `<article class="fcard c-${esc(c.dir)}" id="claim-${esc(c.id)}" style="--fc:${STREAM_COL[c.stream] || 'var(--s-other)'}">${key}
    <p class="fh">${esc(t.head || c.text)}</p>
    ${t.detail || num || lim ? `<details${opt.open ? ' open' : ''}><summary>Details</summary>${t.detail ? `<p class="fd">${esc(t.detail)}</p>` : ''}${num ? `<p class="fn">${esc(num)}</p>` : ''}${lim ? `<p class="fl">Limitation: ${esc(lim)}</p>` : ''}</details>` : ''}
    <div class="fm"><span class="fcite">${citeLink(c)}</span>${opt.noStream ? '' : streamTag(c.stream)}<span class="dirtag">${esc(DIR_LABEL[c.dir] || c.dir)}</span>${typeBadge(c.type)}<a href="#claim-${esc(c.id)}" class="mono" title="This finding on its own page">Details</a></div></article>`;
}
function findingGrid(list, n, label, o) {
  if (!list.length) return '<div class="empty small">No verified finding.</div>';
  const N = n || 9, card = c => findingCard(c, o); if (list.length <= N) return `<div class="fcards">${list.map(card).join('')}</div>`;
  return `<div class="fcards">${list.slice(0, N).map(card).join('')}</div><details class="more"><summary class="small soft">${esc(label || 'More findings')} (${list.length - N})</summary><div class="fcards" style="margin-top:10px">${list.slice(N).map(card).join('')}</div></details>`;
}
/* findings grouped by type of study, with a filter; used on action entries */
function claimLedger(claims, streams, opt) {
  opt = opt || {};
  const groups = streams.map(s => [s, claims.filter(c => c.stream === s)]).filter(([, L]) => L.length || opt.showEmpty);
  const id = 'lg' + Math.random().toString(36).slice(2, 7);
  const html = `<div class="seg" role="group" aria-label="Type of study" id="${id}"><button data-s="" aria-pressed="true">All <span class="num-t">${claims.filter(c => streams.includes(c.stream)).length}</span></button>${groups.map(([s, L]) => `<button data-s="${esc(s)}" aria-pressed="false"><i class="sw ${swClass(s)}"></i> ${esc(E.STREAM_LABEL[s] || STREAM_SHORT[s] || s)} <span class="num-t">${L.length}</span></button>`).join('')}</div>
    <div class="ledger">${groups.map(([s, L]) => `<section class="lgroup" data-s="${esc(s)}"><h4 class="lg-h"><i class="sw ${swClass(s)}"></i>${esc(E.STREAM_LABEL[s] || STREAM_SHORT[s] || s)}<span class="num-t">${L.length}</span></h4>${findingGrid(L, opt.n || 6, null, { noStream: true })}</section>`).join('')}</div>`;
  setTimeout(() => { const seg = document.getElementById(id); if (!seg) return; const root = seg.nextElementSibling;
    seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; $$('button', seg).forEach(x => x.setAttribute('aria-pressed', x === b)); $$('.lgroup', root).forEach(g => { g.hidden = !!b.dataset.s && g.dataset.s !== b.dataset.s; }); }; }, 0);
  return html;
}
function layerHead(kind, title, def) {
  const tag = { m: 'Measurement', a: 'Association', i: 'Interpretation', s: 'Association' }[kind];
  const cls = { m: 'l-m', a: 'l-a', i: 'l-i', s: 'l-a' }[kind];
  const same = String(title).toLowerCase().startsWith(tag.toLowerCase().slice(0, 9));
  return `<div class="layer-head"><h2>${esc(title)}</h2>${same ? '' : `<span class="layer-tag ${cls}">${tag} layer</span>`}${def ? `<p class="layer-def">${esc(def)}</p>` : ''}</div>`;
}
const LAYER_DEF = {
  m: 'What the face does: movement, appearance, timing and coordination, independent of any meaning.',
  a: 'What studies found: how often the action occurred with a state, or what observers inferred from it, by type of study and evidence.',
  i: 'What it may mean in a given situation: the best guess with its evidence and confidence, the alternatives, and what would distinguish them.'
};
/* tooltip */
let TIP;
function tipShow(ev, html) {
  if (!TIP) { TIP = document.createElement('div'); TIP.className = 'tip'; TIP.setAttribute('role', 'tooltip'); document.body.appendChild(TIP); }
  TIP.innerHTML = html; TIP.style.display = 'block';
  const r = TIP.getBoundingClientRect(); let x, y;
  if (ev.clientX != null && ev.type.startsWith('pointer')) { x = ev.clientX + 14; y = ev.clientY + 14; }
  else { const b = ev.target.getBoundingClientRect(); x = b.right + 8; y = b.top; }
  if (x + r.width > innerWidth - 8) x = Math.max(8, (ev.clientX || innerWidth) - r.width - 14);
  if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
function tipHide() { if (TIP) TIP.style.display = 'none'; }
document.addEventListener('pointermove', ev => {
  const t = ev.target.closest && ev.target.closest('[data-tip]');
  if (t) tipShow(ev, t.getAttribute('data-tip')); else tipHide();
});
document.addEventListener('focusin', ev => { const t = ev.target.closest && ev.target.closest('[data-tip]'); if (t) tipShow(ev, t.getAttribute('data-tip')); });
document.addEventListener('focusout', tipHide);
document.addEventListener('scroll', tipHide, true);
/* toast */
function toast(msg, ms) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms || 3200);
}
/* downloads: a plain browser download */
async function saveFile(filename, data) {
  try {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) { toast('The download could not be completed.'); }
}
function toCSV(cols, rows) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map(q).join(',')].concat(rows.map(r => r.map(q).join(','))).join('\n') + '\n';
}
/* loading */
async function loadJSON(path) { const r = await fetch(path, { cache: 'force-cache' }); if (!r.ok) throw new Error(path + ': HTTP ' + r.status); return r.json(); }
/* routing */
const NAV = [['home', 'Compose'], ['actions', 'Actions'], ['states', 'States']].concat([['findings', 'Findings'], ['reliability', 'Reliability'], ['map', 'Map'], ['lab', 'Lab'], ['timeline', 'Timeline'], ['method', 'Method']]);
/* look and face style: a per-viewer convenience, remembered in this browser when storage is available */
/* the look a first visit opens in; a look the visitor chooses (Auto included) is remembered in this browser */
const DEFAULT_LOOK = 'obs';
const LOOKS = [['auto', 'Auto', 'Plate in light mode, Observatory in dark mode'], ['plate', 'Plate', ''], ['obs', 'Observatory', ''], ['studio', 'Studio', '']];
const LOOK_SW = { auto: 'linear-gradient(135deg,#f2f4f4 50%,#0f1424 50%)', plate: '#f2f4f4', obs: '#0f1424', studio: '#dfe3de' };
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } return null; }
function applyLook(look, face) {
  const r = document.documentElement;
  if (look) { if (look === 'auto') delete r.dataset.look; else r.dataset.look = look; }
  if (face) { if (face === 'orig') delete r.dataset.face; else r.dataset.face = face; }
}
function initLook() {
  applyLook(store('evidence.look') || DEFAULT_LOOK, store('evidence.face') || 'orig');
  if (window.FaceMesh && FaceMesh.installDefs) FaceMesh.installDefs();
  const btn = $('#lookbtn'), menu = $('#lookmenu'); if (!btn || !menu) return;
  const cur = () => ({ look: document.documentElement.dataset.look || 'auto', face: document.documentElement.dataset.face || 'orig' });
  const draw = () => { const c = cur();
    menu.innerHTML = `<div><div class="lab">Look</div><div class="looks">${LOOKS.map(([k, l, t]) => `<button type="button" data-look="${k}" aria-pressed="${c.look === k}"${t ? ` title="${esc(t)}"` : ''}><i style="background:${LOOK_SW[k]}"></i>${esc(l)}</button>`).join('')}</div></div>`; };
  const open = o => { menu.hidden = !o; btn.setAttribute('aria-expanded', o); if (o) draw(); };
  btn.onclick = e => { e.stopPropagation(); open(menu.hidden); };
  menu.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.look) { applyLook(b.dataset.look, null); store('evidence.look', b.dataset.look); }
    if (b.dataset.facePick) { applyLook(null, b.dataset.facePick); store('evidence.face', b.dataset.facePick === 'orig' ? null : b.dataset.facePick); }
    draw(); });
  document.addEventListener('click', e => { if (!menu.hidden && !e.target.closest('.lookwrap')) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { open(false); btn.focus(); } });
}
function parseHash() {
  let h = location.hash.replace(/^#/, ''); try { h = decodeURIComponent(h); } catch (e) { /* keep raw */ }
  let m;
  if ((m = h.match(/^au-(\d+)$/))) return { v: 'au', a: String(+m[1]) };
  if ((m = h.match(/^combo-([\d-]+)$/))) return { v: 'combo', a: E.parseCombo(m[1].replace(/-/g, ' ')) };
  if ((m = h.match(/^state-(.+)$/))) return { v: 'state', a: m[1] };
  if ((m = h.match(/^(lab|timeline|map|method|states|findings|actions|combo|home|reliability|credits)$/))) return { v: m[1] };
  if ((m = h.match(/^reliability-([a-z0-9-]+)$/))) return { v: 'reliability', a: m[1] };
  if ((m = h.match(/^claim-([A-Z]\d+)$/))) return { v: 'claim', a: m[1] };
  if ((m = h.match(/^rec-([A-Z]\d+-\d+)$/))) return { v: 'rec', a: m[1] };
  return { v: 'home' };
}
/* The "#..." part of the address is how the tool moves between views. Some app previews show a page in a sandboxed frame
   that refuses to change it (a page shown from a blob: address); there the change is written with history and the views
   are told directly, so links and the search still work (29 Oct). Elsewhere this is exactly what a "#..." link does. */
let viaHistory = false, routedHash = null;
function setHash(h) {
  h = String(h == null ? '' : h).replace(/^#/, '');
  const before = location.hash, want = '#' + h;
  const same = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch (e) { return a === b; } };
  if (same(before, want)) return false;
  if (!viaHistory) { try { location.hash = h; } catch (e) { /* refused */ } if (location.hash !== before) return true; viaHistory = true; }
  try { history.pushState(null, '', location.href.replace(/#.*$/, '') + want); } catch (e) { return false; }
  dispatchEvent(new HashChangeEvent('hashchange'));
  return true;
}
// Back and Forward: such frames move through the history without a hashchange, so show the view the address now names
addEventListener('popstate', () => setTimeout(() => { if (A.kb && location.hash !== routedHash) route(); }, 60));
document.addEventListener('click', e => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a || a.target || a.hasAttribute('download') || a.getAttribute('href') === '#') return;
  e.preventDefault(); setHash(a.getAttribute('href'));
});
function go(hash) { if (!setHash(hash)) route(); }
const VIEWS = {};
function setHdr() { const h = document.querySelector('.top'); if (h) document.documentElement.style.setProperty('--hdr', (getComputedStyle(h).position === 'sticky' ? h.offsetHeight : 0) + 'px'); }
addEventListener('resize', setHdr);
function route() {
  routedHash = location.hash; setHdr();
  const r = parseHash(); A.route = r; tipHide();
  const navKey = { au: 'actions', state: 'states', claim: 'findings', rec: 'findings', combo: 'home' }[r.v] || r.v;
  $$('.nav a').forEach(a => a.setAttribute('aria-current', a.dataset.k === navKey ? 'page' : 'false'));
  const main = $('#main');
  const fn = VIEWS[r.v] || VIEWS.home;
  if (A.face) { try { A.face.destroy(); } catch (e) { /* already gone */ } A.face = null; }
  (A.mounts || []).forEach(m => { try { m.destroy(); } catch (e) { /* already gone */ } }); A.mounts = [];
  main.className = '';
  try { main.innerHTML = ''; fn(main, r); }
  catch (e) { console.error(e); main.innerHTML = `<div class="empty">This view could not be drawn: ${esc(e.message)}</div>`; }
  if (!r.keepScroll) window.scrollTo(0, 0);
  const t = { au: 'AU' + r.a, combo: 'Combination', state: 'State', claim: 'Finding ' + r.a, rec: 'Record ' + r.a }[r.v];
  document.title = (t ? t + ', ' : '') + TITLE;
}
/* phone tables: copy each column header into its cells, so rows can stack as labelled records */
function labelTables(root) {
  $$('table.tbl', root).forEach(t => { if (t.dataset.lab === '1') return; const hs = $$('thead th', t).map(th => th.textContent.trim()); if (!hs.length) return;
    $$('tbody tr', t).forEach(tr => [...tr.children].forEach((td, j) => { if (hs[j] && !td.hasAttribute('data-label')) td.setAttribute('data-label', hs[j]); }));
    if (hs.length >= 3) t.classList.add('stackable'); t.dataset.lab = '1'; });
}
new MutationObserver(ms => { if (ms.some(m => m.addedNodes.length)) { const mn = document.getElementById('main'); if (mn) $$('table.tbl', mn).forEach(t => { if (t.dataset.lab === '1' && $$('tbody td:not([data-label])', t).length) t.dataset.lab = ''; }); labelTables(mn); } })
  .observe(document.documentElement, { childList: true, subtree: true });
/* search */
function searchIndex() {
  const out = [];
  Object.values(A.kb.aus).forEach(a => out.push({ k: 'AU' + a.code + ' ' + a.name + ' ' + a.muscles, h: '#au-' + a.code, t: `<span><b class="mono">AU${esc(a.code)}</b> ${esc(a.name)}</span>`, s: 'action' }));
  Object.keys(A.kb.states).forEach(s => out.push({ k: s, h: '#state-' + A.I.stateSlug.get(s), t: esc(s), s: pl(A.kb.states[s].n, 'record') }));
  A.kb.claims.forEach(c => out.push({ k: c.cite + ' ' + c.text, h: '#claim-' + c.id, t: esc(c.cite), s: 'finding ' + c.id }));
  return out;
}
function initSearch() {
  const inp = $('#q'), box = $('#sugg'); let IDX = null, sel = -1;
  const close = () => { box.hidden = true; sel = -1; };
  inp.addEventListener('input', () => {
    IDX = IDX || searchIndex();
    const q = inp.value.trim().toLowerCase(); if (!q) return close();
    const combo = /^(au)?\d+(\s*[+,\s]\s*(au)?\d+)+$/i.test(q) ? E.parseCombo(q) : null;
    const hits = IDX.filter(x => x.k.toLowerCase().includes(q)).slice(0, 12);
    let html = combo ? `<a href="#combo-${combo.join('-')}"><b class="mono">${combo.map(a => 'AU' + a).join(' + ')}</b><span class="muted small">open as a combination</span></a>` : '';
    html += hits.map(x => `<a href="${esc(x.h)}">${x.t}<span class="muted small">${esc(x.s)}</span></a>`).join('');
    box.innerHTML = html || '<div class="muted small" style="padding:8px">No match.</div>'; box.hidden = false;
  });
  inp.addEventListener('keydown', e => {
    const items = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); items.forEach((a, i) => a.classList.toggle('on', i === sel)); }
    else if (e.key === 'Enter') { const a = items[Math.max(0, sel)]; if (a) { setHash(a.getAttribute('href')); inp.value = ''; close(); inp.blur(); } }
    else if (e.key === 'Escape') close();
  });
  box.addEventListener('click', e => { if (e.target.closest('a')) { inp.value = ''; close(); } });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) close(); });
}
/* small helpers */
function sum(a) { return a.reduce((s, x) => s + x, 0); }
function uniq(a) { return [...new Set(a)]; }
function countBy(a, f) { const m = new Map(); a.forEach(x => { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }); return m; }
function moreList(items, n, render, label) {
  if (items.length <= n) return items.map(render).join('');
  return items.slice(0, n).map(render).join('') + `<details class="more"><summary class="small soft">${esc(label || 'Show all')} (${items.length - n} more)</summary><div class="stack" style="margin-top:8px">${items.slice(n).map(render).join('')}</div></details>`;
}
function recTable(recs, opt) {
  opt = opt || {};
  if (!recs.length) return '<div class="empty">No records.</div>';
  const rows = recs.map(r => {
    const st = studyOf(r.study) || {};
    const url = st.doi ? 'https://doi.org/' + st.doi : st.url;
    /* lead with the movements: the configuration (all together) or the actions linked one by one, then the authors' words */
    const cl = x => (x || []).map(a => a.replace('*', '')), P = cl(r.links.present || r.links.predicted), N = cl([].concat(r.links.unrelated || [], r.links.inverse || []));
    const acts = r.config ? r.config.split('+').map(a => auCode(a)).join(' + ') : P.map(a => auCode(a)).join(', ');
    return `<tr><td class="mono"><a href="#rec-${esc(r.id)}">${esc(r.id)}</a></td><td>${streamTag(r.stream)}</td><td>${typeBadge(r.type)}</td><td>${stateLink(r.state)}</td>
      <td class="clip">${acts || N.length ? `<div class="rec-acts">${acts}${N.length ? `<span class="nl">${acts ? '; ' : ''}not linked: ${N.map(a => auCode(a)).join(', ')}</span>` : ''}</div>` : ''}${esc(r.behavior || '')}${r.finding ? `<div class="muted small">${esc(r.finding)}</div>` : ''}</td>
      <td class="nw">${esc(r.measure)}</td><td class="small">${esc(r.population)}</td><td class="small nw">${esc(r.coded)}</td>
      <td class="small"><span class="clamp2" title="${esc(st.cit || r.study)}">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(st.cit || r.study)}</a>` : esc(st.cit || r.study)}</span></td></tr>`;
  });
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Record</th><th>Stream</th><th>Type</th><th>State (authors' term)</th><th>Facial behavior and finding</th><th>Measure</th><th>Population</th><th>Coded from</th><th>Source</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
/* apply the remembered look before the first view is drawn */
applyLook(store('evidence.look') || DEFAULT_LOOK, store('evidence.face') || 'orig');

/* ---- app/js/reading.js ---- */
/* The v4 reading: what a face most likely indicates, shown as evidence rather than prose.
 *   readingHTML(codes, opt)  best guess with its grade and confidence, the evidence grid by type of study, how often the
 *                            whole combination appears, what observers would read and uses beyond emotion
 *   wireReading(root, opt)   wires the links that add one more action
 * Shared vocabulary: a filled square is one independent sample that found the link, a hollow square one that looked and did
 * not; grades come from AUEvidence.GRADE. */
'use strict';
const RD = {
  /* states the source authors named differently but that the reading folds under one family (display only) */
  FAM: { happiness: ['joy', 'elation', 'happy/delighted (latent pattern 1)', 'elated joy', 'happiness (joy)', 'happily surprised'], anger: ['hot anger', 'rage/fury (latent pattern 4)', 'cold anger', 'irritation'],
    fear: ['panic fear', 'anxiety', 'fearfully surprised'], sadness: ['despair', 'shame/anguish (latent pattern 2)'], surprise: ['surprise/excited/ecstatic (latent pattern 3)', 'awed'] },
  fam(s) { return Object.keys(RD.FAM).find(k => k === s || RD.FAM[k].includes(s)) || s; },
  label(s) { const d = A.kb.states[s] && A.kb.states[s].display; return d && d.label ? d.label : String(s).replace(/\s*\(latent pattern \d\)/, '').replace(/^(appraisal|social motive): /, ''); },
  gloss(s) { const d = A.kb.states[s] && A.kb.states[s].display; return d && d.gloss ? d.gloss : ''; },
  COL: { spontaneous: 'var(--s-spont)', posed: 'var(--s-posed)', perception: 'var(--s-perc)', function: 'var(--s-func)' },
  TYPES: [['spontaneous', 'Felt'], ['posed', 'Posed'], ['perception', 'Seen by observers']],
  conf(c) { return c ? c[0].toUpperCase() + c.slice(1) : ''; },
  bestCell(G) { return [G.spont, G.posed, G.perc].filter(Boolean).sort((a, b) => b.g - a.g)[0] || { g: 0, label: 'Untested' }; },
  why(G, codes) {
    const b = G.basis || {}, A_ = x => 'AU' + x.join(' + AU'), st = s => RD.label(s);
    const T = { spontaneous: 'spontaneous', posed: 'posed', perception: 'perception', theory: 'proposed', function: 'social-use' };
    if (b.kind === 'config') {
      if (b.jac === 1 && b.units) return `${A_(b.aus)} reported with ${st(G.state)} in ${pl(b.units, T[b.stream] + ' sample')}.`;
      if (b.jac === 1) return `Matches the configuration proposed for ${st(G.state)} (${A_(b.aus)}); no study has tested it.`;
      return `Closest reported configuration: ${A_(b.aus)} with ${st(G.state)}${b.units ? ` (${pl(b.units, T[b.stream] + ' sample')})` : ' (proposed)'}. The whole selection is untested.`;
    }
    if (b.kind === 'review') return `A review of ${b.k} studies found ${(b.aus || [b.au]).map(a => 'AU' + a).join(' or ')} increased with ${st(G.state)} in ${Math.round(b.share * 100)}% of them (${b.cite}).`;
    if (b.kind === 'estimate') return `${A_(b.aus)} appeared in ${Math.round(b.rate * 100)}% of ${st(G.state)} cases (${b.cite})${b.jac < 1 ? '; the whole selection is untested' : ''}.`;
    if (b.kind === 'single') return `AU${b.au} was linked to ${st(G.state)} in ${pl(b.n, 'sample')}${codes.length > 1 ? '; the combination is untested' : ''}.`;
    return '';
  },
  meter(g) { return `<span class="gbars" aria-hidden="true">${[1, 2, 3, 4].map(i => `<i class="${i <= g ? 'on' : ''}"></i>`).join('')}</span>`; },
  squares(c, t) {
    if (!c) return '<span class="none" aria-label="no evidence">&ndash;</span>';
    if (c.byReview && c.review) { const on = Math.round(c.review.share * 10);
      return `<span class="sq" title="${esc(`${Math.round(c.review.share * 100)}% of ${c.review.k} studies in a review (${c.review.cite})`)}">${Array.from({ length: 10 }, (_, i) => `<b class="r${i < on ? '' : ' x'}" style="background:${RD.COL[t]}"></b>`).join('')}</span><span class="gw">${E.GRADE[c.g].label}</span>`; }
    if (c.g === 1) return `<span class="inf" title="No study reports these actions together; read from ${esc(c.inferredFrom && c.inferredFrom.within ? 'AU' + c.inferredFrom.within.aus.join(' + AU') : 'the single actions')}">inferred</span>`;
    if (!c.n && c.against) return `<span class="sq" title="${pl(c.against, 'sample')} looked and did not find it">${Array.from({ length: Math.min(c.against, 8) }, () => '<b class="x"></b>').join('')}</span><span class="gw">not found</span>`;
    if (!c.n) return '<span class="none" aria-label="no evidence">&ndash;</span>';
    return `<span class="sq" title="${esc(`${pl(c.n, 'sample')} found it (${c.de} checked in the full text)${c.against ? `; ${c.against} did not` : ''}`)}">${Array.from({ length: Math.min(c.n, 12) }, () => `<b style="background:${RD.COL[t]}"></b>`).join('')}${c.n > 12 ? '<em>+</em>' : ''}${Array.from({ length: Math.min(c.against, 8) }, () => '<b class="x"></b>').join('')}</span><span class="gw">${E.GRADE[c.g].label}${c.mixed ? ', mixed' : ''}</span>`;
  },
  grid(G, n) {
    const V = G.verdict || {};
    const states = [G.state].concat(V.members || [], G.alternatives.map(a => a.state)).filter((s, i, a) => s && a.indexOf(s) === i).slice(0, n || 5);
    const rows = states.map(s => G.matrix.find(r => r.state === s) || { state: s, cells: {} });
    return `<div class="egrid" role="table" aria-label="Evidence by type of study"><div role="row" class="eg-h"><span role="columnheader"></span>${RD.TYPES.map(([t, l]) => `<span role="columnheader"><i style="background:${RD.COL[t]}"></i>${l}</span>`).join('')}</div>
      ${rows.map((r, i) => `<div role="row" class="eg-r${i ? '' : ' top'}"><span role="rowheader" class="st" title="${esc(RD.gloss(r.state))}">${stateLink(r.state, RD.label(r.state))}</span>${RD.TYPES.map(([t]) => `<span role="cell" class="c">${RD.squares(r.cells[t], t)}</span>`).join('')}</div>`).join('')}</div>
      <div class="eg-legend"><span><span class="sq"><b style="background:var(--ink-2)"></b></span>a sample that found it</span><span><span class="sq"><b class="x"></b></span>a sample that did not</span><span><span class="sq"><b class="r" style="background:var(--ink-2)"></b></span>tenths of a review's studies</span></div>`;
  },
  /* how often the whole combination appears: reliability estimates for exactly these actions */
  often(codes, n) {
    const key = codes.slice().sort((a, b) => +a - +b).join('+');
    /* only estimates that name these exact actions and counted them all together (join 'all') or the configuration whole or
       in part (join 'part', labelled so); whole-face ratings and category codes never appear here */
    const L = (A.kb.relspec || []).map((e, i) => Object.assign({ _i: i }, e)).filter(e => e.show !== false && e.named !== false && e.estimate != null && e.measure === 'reliability' && e.role !== 'moderator' && !/strict/i.test(e.subset || '') &&
      (e.join === 'all' || e.join === 'part') && RS.acts(e).slice().sort((a, b) => +a - +b).join('+') === key);
    const rank = e => (/Meta-analysis 1/.test(e.subset || '') ? 0 : /Meta-analysis 2/.test(e.subset || '') ? 1 : e.stream === 'spontaneous' ? 2 : 3);
    L.sort((a, b) => rank(a) - rank(b) || (b.n || b.k || 0) - (a.n || a.k || 0));
    if (!L.length) return '';
    const row = e => { const t = e.v4 || {}, p = e.estimate, pct = Math.round(p * 100);
      const label = t.label || `${e.state}${e.n ? `, n = ${e.n}` : e.k ? `, ${e.k} studies` : ''}`;
      return `<div class="often-r" title="${esc(t.sentence || '')}"><div class="ctx">${esc(label)}${e.join === 'part' ? ' <b class="part">all or part</b>' : ''} <em>${esc(e.cite)}</em></div><div class="val">${pct}%</div>
        <div class="dots${e.stream === 'posed' ? ' posed' : ''}" aria-hidden="true">${Array.from({ length: 50 }, (_, i) => `<i class="${i < Math.round(p * 50) ? 'on' : ''}"></i>`).join('')}</div></div>`; };
    return `<div class="often"><div class="lab">How often these actions appear together</div>${L.slice(0, n || 3).map(row).join('')}${L.length > (n || 3) ? `<a class="small" href="#reliability">${pl(L.length - (n || 3), 'more estimate')}</a>` : ''}</div>`;
  },
  pills(L, t) { return L.filter(Boolean).slice(0, 3).map(x => `<a class="pill" href="#state-${esc(A.I.stateSlug.get(x.state) || '')}"><i style="background:${RD.COL[t]}"></i>${esc(RD.label(x.state))}</a>`).join('') || '<span class="none">none recorded</span>'; },
  cap(t) { t = String(t || ''); return t ? t[0].toUpperCase() + t.slice(1) : t; },
  list(L, last) { L = L.filter(Boolean); return L.length < 2 ? (L[0] || '') : L.slice(0, -1).join(', ') + ' ' + (last || 'or') + ' ' + L[L.length - 1]; },
  /* where the evidence points: one bar split by family of states, the leading family dark */
  famBar(V) {
    const F = (V.families || []).filter(f => f.share >= 0.02).slice(0, 5); if (!F.length) return '';
    const lead = V.kind === 'mixed' ? null : V.family, tot = F.reduce((t, f) => t + f.share, 0);
    return `<div class="rd-fbar" role="img" aria-label="${esc('Where the evidence points: ' + F.map(f => `${f.label} ${Math.round(f.share * 100)}%`).join(', '))}">${F.map(f => { const w = f.share / tot;
      return `<span class="seg${f.family === lead ? ' lead' : ''}" style="flex:${w.toFixed(3)} 1 0" title="${esc(`${f.label}: ${Math.round(f.share * 100)}% of the evidence weight (${f.members.map(RD.label).join(', ')})`)}">${w >= 0.3 ? `<b>${esc(f.label)}</b><em>${Math.round(f.share * 100)}%</em>` : w >= 0.1 ? `<em>${Math.round(f.share * 100)}%</em>` : ''}</span>`; }).join('')}</div>`;
  },
  pips(c) { const n = { low: 1, moderate: 2, high: 3 }[c] || 0; return `<span class="rd-pips" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`; },
  head(G) {
    const V = G.verdict || {}; let big, sub = '', tag = '';
    /* the members worth naming: no appraisals, no near-duplicates (awe, awed), and without the lead when it is already the headline */
    const felt = (L, dropLead) => { const lead = G.state ? RD.label(G.state).toLowerCase() : '', out = []; L.forEach(m => { const l = RD.label(m).toLowerCase(); if (/appraisal/i.test(m) || /appraisal/.test(l) || /^\w+ly \w+$/.test(l)) return;   // appraisals and posed compounds ("happily surprised") are not named here
      if (out.some(o => { const k = RD.label(o).toLowerCase(); return l.startsWith(k) || k.startsWith(l); })) return; if (dropLead && lead && (l === lead || l.startsWith(lead))) return; out.push(m); }); return out; };
    if (V.curated) { big = RD.cap(V.curated.label); sub = V.curated.more ? RD.cap(V.curated.more) : ''; }
    else if (V.kind === 'state') { big = RD.label(G.state); const alt = (V.families || [])[0], o = alt ? felt(alt.members.filter(m => m !== G.state), true) : []; if (o.length) sub = 'or ' + RD.list(o.slice(0, 2).map(RD.label)); }
    else if (V.kind === 'family') { big = V.familyLabel; sub = 'Most likely ' + RD.list(felt(V.members).map(RD.label)); }
    else { big = 'Not specific'; sub = RD.cap(RD.list(felt(V.members).map(RD.label))); }
    return { big, sub, tag };
  },
  /* what one more action would do: additions that sharpen the reading or tip it to a rival */
  whatIf(G, codes) {
    const seen = new Set(), L = [];
    (G.next || []).forEach(n => { if (!seen.has(n.state)) { seen.add(n.state); L.push({ add: n.add, state: n.state, conf: n.confidence, same: n.state === G.state }); } });
    (G.tips || []).forEach(t => { if (!seen.has(t.state)) { seen.add(t.state); L.push({ add: t.add, state: t.state, conf: '', same: false }); } });
    if (!L.length) return `<p class="rd-none">No single added action changes this reading.</p>`;
    const sel = codes.slice();
    return `<div class="rd-wi">${L.slice(0, 5).map(x => { const nc = sel.concat(x.add).sort((a, b) => +a - +b);
      return `<a class="wi${x.same ? ' same' : ''}" href="#combo-${nc.join('-')}" data-codes="${nc.join('+')}" title="${esc(`With AU${x.add} (${auName(x.add)}) added: ${RD.label(x.state)}${x.conf ? `, ${x.conf} confidence` : ''}`)}"><span class="wa">+AU${x.add}</span><span class="wr" aria-hidden="true"></span><span class="ws">${esc(RD.label(x.state))}</span>${x.conf ? RD.pips(x.conf) : ''}</a>`; }).join('')}</div>`;
  },
};
function readingHTML(codes, opt) {
  opt = opt || {};
  const known = codes.filter(a => A.kb.aus[a]);
  if (!known.length) return `<div class="rd rd-empty"><div class="lab">Best guess</div><p class="soft">Switch on one or more actions, or pick a face from the literature.</p></div>`;
  const G = E.bestGuess4(A.I, known, { next: true }), V = G.verdict || {};
  if (!G.state && !V.curated) return `<div class="rd rd-empty"><div class="lab">Best guess</div><p class="soft">No study in the evidence base bears on ${known.map(a => 'AU' + a).join(' + ')}.</p></div>`;
  const bc = G.state ? RD.bestCell(G) : { g: 0 }, H = RD.head(G);
  const why = V.curated ? V.curated.why : RD.why(G, known);
  const conf = V.confidence || G.confidence || 'low';
  return `<div class="rd">
    ${RD.famBar(V)}
    <div class="rd-best"><div class="rd-hl">${H.tag ? `<span class="rd-tag">${esc(H.tag)}</span>` : ''}<div class="rd-big">${esc(H.big)}</div>${H.sub ? `<div class="rd-sub">${esc(H.sub)}</div>` : ''}</div>
      <div class="rd-meters">${G.state ? `<div class="rd-m" title="${esc(E.GRADE[Math.max(0, bc.g)].desc)}">${RD.meter(bc.g)}<span><b>${E.GRADE[Math.max(0, bc.g)].label}</b> evidence</span></div>` : ''}
        <div class="rd-m">${RD.pips(conf)}<span><b>${RD.conf(conf)}</b> confidence</span></div></div></div>
    ${why ? `<p class="rd-why">${esc(why)}</p>` : ''}
    <div class="rd-two"><div><div class="lab">People would read</div><div class="pills">${G.observers ? `<a class="pill" href="#state-${esc(A.I.stateSlug.get(G.observers.state) || '')}"><i style="background:${RD.COL.perception}"></i>${esc(RD.label(G.observers.state))}${RD.pips(G.observers.confidence)}</a>` : '<span class="none">no perception study</span>'}</div></div>
      <div><div class="lab">Beyond emotion</div><div class="pills">${RD.pills(G.functions, 'function')}</div></div></div>
    <div class="rd-wiw"><div class="lab">One more action would give</div>${RD.whatIf(G, known)}</div>
    ${G.state ? `<section class="eg-wrap"><div class="lab">Evidence by type of study</div>${RD.grid(G, opt.rows || 5)}</section>` : ''}
    ${RD.often(known)}</div>`;
}

function wireReading(root, opt) {
  opt = opt || {};
  if (opt.onAdd) $$('.rd-wi a.wi', root).forEach(a => a.onclick = ev => { ev.preventDefault(); opt.onAdd(a.dataset.codes.split('+')); });
}

/* ---- app/js/charts.js ---- */
/* Small SVG chart helpers. Marks are thin, axes are hairlines, text stays in ink tokens; colour carries identity only. */
'use strict';
function niceTicks(min, max, n) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min, step0 = span / Math.max(1, n || 5), mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(s => s * mag).find(s => s >= step0) || 10 * mag;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const tf = (v, d) => fmt.r(v, d == null ? 2 : d);
/* horizontal dot + interval chart; rows: {label, v, lo, hi, tip, color} */
function chartDotCI(rows, opt) {
  opt = opt || {};
  const lw = opt.labelW || 110, W = opt.w || 520, rh = 26, top = 8, H = top + rows.length * rh + 28;
  const vals = rows.flatMap(r => [r.lo, r.hi, r.v]).filter(Number.isFinite);
  const min = opt.min != null ? opt.min : Math.min(0, ...vals), max = opt.max != null ? opt.max : Math.max(...vals) * 1.08;
  const x = v => lw + (W - lw - 16) * (v - min) / (max - min || 1);
  const ticks = niceTicks(min, max, 5);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(opt.title || 'Dot and interval chart')}">`;
  ticks.forEach(t => { s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 24}"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle">${esc(opt.tick ? opt.tick(t) : tf(t, opt.dec))}</text>`; });
  if (opt.ref != null) s += `<line x1="${x(opt.ref)}" x2="${x(opt.ref)}" y1="${top}" y2="${H - 24}" stroke="var(--ink-3)" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const y = top + i * rh + rh / 2, col = r.color || opt.color || 'var(--ink-2)';
    s += `<g tabindex="0" data-tip="${esc(r.tip || (r.label + ': ' + tf(r.v, opt.dec)))}"><rect x="0" y="${y - rh / 2}" width="${W}" height="${rh}" fill="transparent"/>`;
    s += `<text x="${lw - 10}" y="${y + 4}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
    if (Number.isFinite(r.lo) && Number.isFinite(r.hi)) s += `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
    if (Number.isFinite(r.v)) s += `<circle cx="${x(r.v)}" cy="${y}" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`;
    if (opt.valueLabels && Number.isFinite(r.v)) s += `<text x="${Math.min(W - 4, x(Number.isFinite(r.hi) ? r.hi : r.v) + 8)}" y="${y + 4}" class="val" ${x(Number.isFinite(r.hi) ? r.hi : r.v) + 40 > W ? 'text-anchor="end"' : ''}>${esc(tf(r.v, opt.dec))}</text>`;
    s += '</g>';
  });
  s += `<line class="axis" x1="${lw}" x2="${W - 16}" y1="${H - 24}" y2="${H - 24}"/></svg>`;
  return `<div class="chart">${s}</div>`;
}
/* horizontal bars; rows: {label, v, tip, color} */
function chartBarH(rows, opt) {
  opt = opt || {};
  const lw = opt.labelW || 150, W = opt.w || 560, rh = opt.rowH || 24, top = 6, H = top + rows.length * rh + (opt.axis === false ? 6 : 26);
  const max = opt.max != null ? opt.max : Math.max(1e-9, ...rows.map(r => r.v));
  const min = opt.min || 0;
  const x = v => lw + (W - lw - 56) * (v - min) / (max - min || 1);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(opt.title || 'Bar chart')}">`;
  if (opt.axis !== false) niceTicks(min, max, 4).forEach(t => { s += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 22}"/><text x="${x(t)}" y="${H - 6}" text-anchor="middle">${esc(opt.tick ? opt.tick(t) : tf(t, opt.dec))}</text>`; });
  if (opt.ref != null) s += `<line x1="${x(opt.ref)}" x2="${x(opt.ref)}" y1="${top - 2}" y2="${H - 22}" stroke="var(--ink)" stroke-width="1"/><text x="${x(opt.ref) + 4}" y="${top + 9}" class="lbl">${esc(opt.refLabel || '')}</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rh, bh = Math.min(14, rh - 8), x0 = x(Math.max(min, 0)), x1 = x(r.v);
    const col = r.color || opt.color || 'var(--ink-2)';
    s += `<g tabindex="0" data-tip="${esc(r.tip || (r.label + ': ' + tf(r.v, opt.dec)))}"><rect x="0" y="${y}" width="${W}" height="${rh}" fill="transparent"/>`;
    s += `<text x="${lw - 10}" y="${y + rh / 2 + 4}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
    const w = Math.max(1, x1 - x0);
    s += `<path d="M${x0} ${y + (rh - bh) / 2} h${Math.max(0, w - 3)} a3 3 0 0 1 3 3 v${bh - 6} a3 3 0 0 1 -3 3 h${-Math.max(0, w - 3)} z" fill="${col}"/>`;
    s += `<text x="${x0 + w + 6}" y="${y + rh / 2 + 4}" class="val">${esc(opt.vfmt ? opt.vfmt(r.v) : tf(r.v, opt.dec))}</text></g>`;
  });
  if (opt.axis !== false) s += `<line class="axis" x1="${lw}" x2="${W - 56}" y1="${H - 22}" y2="${H - 22}"/>`;
  return `<div class="chart">${s}</svg></div>`;
}
/* heat map with a one-hue ink ramp (or a diverging pair when opt.diverging) */
function chartHeat(rowLabels, colLabels, val, opt) {
  opt = opt || {};
  const lw = opt.labelW || 130, cw = opt.cellW || 30, ch = opt.cellH || 22, th = opt.headH || 90;
  const longest = Math.max(0, ...colLabels.map(c => String(c).length)), padR = Math.min(170, Math.max(6, Math.round(longest * 6.2 * Math.cos(55 * Math.PI / 180)) - cw / 2));
  const W = lw + colLabels.length * cw + padR, H = th + rowLabels.length * ch + 6;
  let max = opt.max; if (max == null) { max = 0; rowLabels.forEach((r, i) => colLabels.forEach((c, j) => { const v = val(i, j); if (v != null && isFinite(v)) max = Math.max(max, Math.abs(v)); })); }
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(opt.title || 'Heat map')}">`;
  colLabels.forEach((c, j) => { const x = lw + j * cw + cw / 2; s += `<text transform="translate(${x + 4} ${th - 6}) rotate(-55)" class="lbl"${opt.colHref ? '' : ''}>${esc(c)}</text>`; });
  rowLabels.forEach((r, i) => {
    const y = th + i * ch;
    s += `<text x="${lw - 8}" y="${y + ch / 2 + 4}" text-anchor="end" class="lbl">${esc(r)}</text>`;
    colLabels.forEach((c, j) => {
      const v = val(i, j), x = lw + j * cw;
      if (v == null || !isFinite(v)) { s += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="var(--sunk)"/>`; return; }
      const t = max ? Math.min(1, Math.abs(v) / max) : 0;
      const fill = opt.diverging ? (v >= 0 ? 'var(--div-pos)' : 'var(--div-neg)') : 'var(--ink)';
      const op = opt.diverging ? (0.08 + 0.85 * t) : (v === 0 ? 0 : 0.08 + 0.82 * t);
      const tip = opt.tip ? opt.tip(i, j, v) : `${r} × ${c}: ${tf(v, opt.dec)}`;
      s += `<g tabindex="-1" data-tip="${esc(tip)}"${opt.onCell ? ` data-cell="${i},${j}"` : ''}><rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="var(--sunk)"/>`;
      if (op > 0) s += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" rx="2" fill="${fill}" fill-opacity="${op.toFixed(3)}"/>`;
      if (opt.labels) s += `<text x="${x + cw / 2}" y="${y + ch / 2 + 4}" text-anchor="middle" style="font-size:11.5px;fill:${op > .55 ? 'var(--paper)' : 'var(--ink-2)'}">${esc(opt.labels === true ? tf(v, opt.dec) : opt.labels(v))}</text>`;
      s += '</g>';
    });
  });
  return `<div class="chart hscroll">${s}</svg></div>`;
}
/* simple network: nodes {id,label,x?,y?,kind}, edges {a,b,w,tip}; circular or two-column layout */
function chartNetwork(nodes, edges, opt) {
  opt = opt || {};
  const W = opt.w || 560, H = opt.h || 420, cx = W / 2, cy = H / 2;
  const pos = {};
  if (opt.layout === 'bipartite') {
    const L = nodes.filter(n => n.side === 'L'), R = nodes.filter(n => n.side !== 'L');
    L.forEach((n, i) => pos[n.id] = [150, 30 + (H - 60) * (L.length === 1 ? .5 : i / (L.length - 1))]);
    R.forEach((n, i) => pos[n.id] = [W - 190, 20 + (H - 40) * (R.length === 1 ? .5 : i / (R.length - 1))]);
  } else nodes.forEach((n, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / nodes.length, r = Math.min(W, H) / 2 - 60; pos[n.id] = [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  const wmax = Math.max(1e-9, ...edges.map(e => e.w));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="${esc(opt.title || 'Network')}">`;
  edges.forEach(e => {
    const [x1, y1] = pos[e.a] || [0, 0], [x2, y2] = pos[e.b] || [0, 0];
    s += `<g data-tip="${esc(e.tip || '')}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="10"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${e.color || 'var(--ink-2)'}" stroke-opacity="${(0.25 + 0.65 * e.w / wmax).toFixed(2)}" stroke-width="${(1 + 4 * e.w / wmax).toFixed(1)}" stroke-linecap="round"/></g>`;
  });
  nodes.forEach(n => {
    const [x, y] = pos[n.id] || [0, 0], left = opt.layout === 'bipartite' ? n.side === 'L' : x < cx - 5;
    const r = n.r || 6;
    s += `<g tabindex="0" data-tip="${esc(n.tip || n.label)}"${n.href ? ` data-href="${esc(n.href)}" style="cursor:pointer"` : ''}><circle cx="${x}" cy="${y}" r="${r + 8}" fill="transparent"/><circle cx="${x}" cy="${y}" r="${r}" fill="${n.color || 'var(--ink)'}" stroke="var(--surface)" stroke-width="2"/>
      <text x="${left ? x - r - 6 : x + r + 6}" y="${y + 4}" text-anchor="${left ? 'end' : 'start'}" class="lbl">${esc(n.label)}</text></g>`;
  });
  return `<div class="chart">${s}</svg></div>`;
}
/* forest plot for odds ratios on a log scale; rows {label, est, lo, hi, tip} */
function chartForest(rows, opt) {
  opt = opt || {};
  const lw = opt.labelW || 140, W = opt.w || 560, rh = 28, top = 10, H = top + rows.length * rh + 44, pr = 24;
  const vals = rows.flatMap(r => [r.lo, r.hi, r.est]).filter(v => isFinite(v) && v > 0);
  let lmin = Math.log10(Math.min(0.5, ...vals)), lmax = Math.log10(Math.max(2, ...vals));
  const pad = (lmax - lmin) * 0.14; lmin = Math.max(lmin - pad, -3); lmax = Math.min(lmax + pad, 3);
  const x = v => lw + (W - lw - pr) * (Math.log10(Math.min(Math.max(v, 1e-3), 1e3)) - lmin) / (lmax - lmin);
  const ticks = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].filter(t => Math.log10(t) >= lmin - 1e-9 && Math.log10(t) <= lmax + 1e-9);
  const yb = top + rows.length * rh;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Odds ratios with 95% confidence intervals">`;
  ticks.forEach(t => { s += `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${yb}" stroke-dasharray="${t === 1 ? '' : '2 4'}"/><text x="${x(t)}" y="${yb + 18}" text-anchor="middle">${t}</text>`; });
  s += `<line x1="${x(1)}" x2="${x(1)}" y1="${top}" y2="${yb}" stroke="var(--ink)" stroke-width="1.2"/>`;
  rows.forEach((r, i) => {
    const y = top + i * rh + rh / 2;
    s += `<g tabindex="0" data-tip="${esc(r.tip || '')}"><rect x="0" y="${y - rh / 2}" width="${W}" height="${rh}" fill="transparent"/><text x="${lw - 14}" y="${y + 4}" text-anchor="end" class="lbl">${esc(r.label)}</text>`;
    if (isFinite(r.lo) && isFinite(r.hi)) s += `<line x1="${x(r.lo)}" x2="${x(r.hi)}" y1="${y}" y2="${y}" stroke="var(--ink-2)" stroke-width="2" stroke-linecap="round"/>`;
    if (isFinite(r.est)) s += `<rect x="${x(r.est) - 5}" y="${y - 5}" width="10" height="10" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/>`;
    s += '</g>';
  });
  return `<div class="chart">${s}<text x="${lw + (W - lw - pr) / 2}" y="${H - 4}" text-anchor="middle" class="lbl">odds ratio, log scale (1 = no association)</text></svg></div>`;
}
document.addEventListener('click', e => { const g = e.target.closest && e.target.closest('[data-href]'); if (g) setHash(g.getAttribute('data-href')); });

/* ---- app/js/secondary.js ---- */
/* Secondary analyses of AU data released by the studies themselves (open data deposits and published tables).
 * No video or images are analysed: every number here comes from AU codes the study authors provided.
 * secondary.json: {meta, datasets: [...], byAU: {code: [entry]}, reference: {datasetId: {...}}}
 *   dataset: {id, title, cite, doi, url, license, stream, unit, n, groups, groupVar, stateVar, states[], auCols {code: column},
 *             auScale, kind: 'micro'|'table', file, provided, method, caveats[]}
 *   byAU entry: {dataset, stream, measure, note, rows: [{state, v, lo, hi, n}], base: {label, v}}
 * Microdata files (sec_<id>.json): {names[], types[], cols: [values[]]} column-oriented, or {names, bits, rows} for presence bitmasks. */
'use strict';
const SEC = {
  data: null, micro: new Map(),
  datasets() { return (A.sec && A.sec.datasets) || []; },
  dataset(id) { return SEC.datasets().find(d => d.id === id); },
  microSets() { return SEC.datasets().filter(d => d.kind === 'micro' && d.file); },
  load(id) {
    if (!SEC.micro.has(id)) {
      const d = SEC.dataset(id);
      SEC.micro.set(id, loadJSON(d.file).then(raw => SEC.decode(raw, d)));
    }
    return SEC.micro.get(id);
  },
  /* decode to the lab's dataset shape: {name, n, cols: [{name, type, values}], group, builtin, meta} */
  decode(raw, d) {
    let cols;
    if (raw.cols) cols = raw.names.map((nm, j) => ({ name: nm, type: raw.types[j], values: raw.cols[j] }));
    else if (raw.bits) {
      /* presence bitmasks: raw.rows = [[maskString(base36 per 30-bit chunk joined by '.'), ...other values]] */
      const n = raw.rows.length, B = raw.bits; cols = [];
      const chunks = raw.rows.map(r => String(r[0]).split('.').map(s => parseInt(s, 36)));
      B.forEach((nm, k) => cols.push({ name: nm, type: 'num', values: chunks.map(c => (c[Math.floor(k / 30)] >> (k % 30)) & 1) }));
      raw.names.slice(1).forEach((nm, j) => cols.push({ name: nm, type: raw.types[j + 1], values: raw.rows.map(r => r[j + 1]) }));
      if (cols[0].values.length !== n) throw new Error('decode');
    } else throw new Error('Unknown microdata format');
    return { name: d.title, n: cols[0] ? cols[0].values.length : 0, cols, group: d.groupVar || null, builtin: true, meta: d, file: d.id + '.csv',
      note: `${d.cite}: ${d.provided}` };
  },
  cite(d) { return d.doi ? `<a href="https://doi.org/${esc(d.doi)}" target="_blank" rel="noopener">${esc(d.cite)}</a>` : esc(d.cite); },
  /* AU page: one block per dataset that codes this action */
  auSection(code) {
    /* the shares by state already appear as dumbbells under How often, and Kunz et al.'s rates as estimates there */
    const kunzLit = typeof RS !== 'undefined' && RS.lit().some(e => /kunz2013/.test(e.src || '') && (e.rel || e.aus || []).includes(code));
    const E2 = ((A.sec && A.sec.byAU && A.sec.byAU[code]) || []).filter(x => !(x.dataset === 'wsefep' && /^share of selected/.test(x.measure)) && x.dataset !== 'tab_scherer2019_table2a' && !(x.dataset === 'tab_kunz2013_table1' && kunzLit));
    if (!E2.length) return '';
    return `<div class="grid2">${E2.map(x => {
      const d0 = SEC.dataset(x.dataset) || { cite: x.dataset, stream: x.stream };
      if (x.rows.length === 1) { const r = x.rows[0]; return `<div class="block stack" style="gap:8px"><div class="row" style="justify-content:space-between">${streamTag(d0.stream)}${typeBadge('SA')}</div>
        <div class="small"><b>${SEC.cite(d0)}</b><br><span class="soft">${esc(x.measure)}</span></div><div class="fact"><b>${/share/.test(x.measure) ? fmt.pct(r.v, 0) : fmt.r(r.v, 2)}</b><span>${esc(r.state)}${r.lo != null ? `, 95% interval ${/share/.test(x.measure) ? fmt.pct(r.lo, 0) + ' to ' + fmt.pct(r.hi, 0) : fmt.r(r.lo, 2) + ' to ' + fmt.r(r.hi, 2)}` : ''}</span></div>${x.note ? `<p class="tiny muted">${esc(x.note)}</p>` : ''}</div>`; }
      const d = SEC.dataset(x.dataset) || { cite: x.dataset, stream: x.stream };
      const rows = x.rows.slice().sort((a, b) => b.v - a.v);
      const pts = rows.map(r => ({ label: r.state, v: r.v, lo: r.lo, hi: r.hi, tip: `<b>${esc(r.state)}</b>: ${fmt.r(r.v, 3)}${r.lo != null ? ` (95% CI ${fmt.r(r.lo, 2)} to ${fmt.r(r.hi, 2)})` : ''}${r.n != null ? `<br>n = ${r.n}` : ''}`, color: `var(--s-${d.stream === 'posed' ? 'posed' : d.stream === 'spontaneous' ? 'spont' : d.stream === 'perception' ? 'perc' : 'func'})` }));
      return `<div class="block stack" style="gap:8px"><div class="row" style="justify-content:space-between">${streamTag(d.stream)}${typeBadge('SA')}</div>
        <div class="small"><b>${SEC.cite(d)}</b><br><span class="soft">${esc(x.measure)}</span></div>
        ${A.v43 ? (() => { const share = /share/.test(x.measure), top = x.max != null ? x.max : Math.max(1e-9, ...rows.map(r => r.v)) * 1.08;
          return `<div class="bars pa">${rows.map(r => `<div class="bar-r" data-tip="${esc(pts.find(p => p.label === r.state).tip)}"><span class="bar-l">${esc(r.state)}</span><span class="bar-t"><i style="width:${(100 * Math.max(0, Math.min(1, r.v / top))).toFixed(1)}%"></i></span><b>${share ? FV.pct(r.v) : esc(fmt.n(r.v))}</b></div>`).join('')}</div>`; })()
          : chartDotCI(pts, { dec: 2, w: 420, labelW: 130, min: x.min != null ? x.min : 0, max: x.max != null ? x.max : undefined, ref: x.base ? x.base.v : undefined, refLabel: x.base ? x.base.label : undefined, title: `AU${code} in ${d.cite}` })}
        ${x.note ? `<p class="tiny muted">${esc(x.note)}</p>` : ''}</div>`;
    }).join('')}</div>`;
  },
  /* combination view: joint occurrence of the selected actions in each microdata set, by state */
  async comboSection(codes, el) {
    const L = SEC.microSets().filter(d => codes.every(a => d.auCols && d.auCols[a]));
    if (!L.length) { el.innerHTML = `<div class="empty small">${SEC.microSets().length ? 'No study-provided dataset codes all of these actions.' : 'No study-provided microdata have been analysed yet.'}</div>`; return; }
    el.innerHTML = '<span class="muted small">Computing…</span>';
    const blocks = [];
    for (const d of L) {
      let ds; try { ds = await SEC.load(d.id); } catch (e) { continue; }
      const st = colOf(ds, d.stateVar), cols = codes.map(a => colOf(ds, d.auCols[a]));
      const on = i => cols.every(c => c.values[i] != null && c.values[i] >= (d.activeAt || 0.5));
      const by = new Map(); let tot = 0, totOn = 0;
      for (let i = 0; i < ds.n; i++) { const s = st.values[i]; if (s == null) continue; const b = by.get(s) || { n: 0, k: 0 }; b.n++; tot++; if (on(i)) { b.k++; totOn++; } by.set(s, b); }
      const rows = [...by.entries()].map(([s, b]) => ({ s, p: b.k / b.n, n: b.n, k: b.k })).sort((a, b) => b.p - a.p);
      const isPerc = d.stream === 'perception';
      blocks.push(`<div class="block stack" style="gap:8px"><div class="row" style="justify-content:space-between">${streamTag(d.stream)}${typeBadge('SA')}</div>
        <div class="small"><b>${SEC.cite(d)}</b>: ${isPerc ? `among ${fmt.n(totOn)} ${esc(d.unit)}s in which all ${codes.length} actions were shown, share given each response` : `share of ${esc(d.unit)}s with all ${codes.length} actions, by ${esc(d.stateLabel || 'state')}`}</div>
        ${isPerc ? chartBarH([...by.entries()].map(([s]) => s).map(s => { const k = rows.find(r => r.s === s); const share = totOn ? (k ? k.k : 0) / totOn : 0; const base = (by.get(s).n) / tot; return { label: s, v: share, tip: `${esc(s)}: ${fmt.pct(share, 1)} of these ${esc(d.unit)}s (base rate ${fmt.pct(base, 1)})`, color: 'var(--s-perc)' }; }).sort((a, b) => b.v - a.v), { min: 0, max: 1, vfmt: v => fmt.pct(v, 0), tick: v => fmt.pct(v, 0), w: 440, labelW: 110, title: 'Responses when the actions were shown' })
          : chartBarH(rows.map(r => ({ label: r.s, v: r.p, tip: `${esc(r.s)}: ${r.k} of ${r.n} ${esc(d.unit)}s (${fmt.pct(r.p, 1)})`, color: `var(--s-${d.stream === 'spontaneous' ? 'spont' : 'posed'})` })), { min: 0, max: 1, vfmt: v => fmt.pct(v, 0), tick: v => fmt.pct(v, 0), w: 440, labelW: 110, title: 'Share with all selected actions' })}
        <p class="tiny muted">${isPerc ? `Responses are what observers chose; base rates differ by response, so compare each share with how often that response was chosen overall.` : `Counts of ${esc(d.unit)}s coded by the study; ${esc(d.unit)}s of the same ${esc(d.groupVar || 'person')} are not independent.`}</p></div>`);
    }
    el.innerHTML = blocks.length ? `<div class="grid2">${blocks.join('')}</div>` : '<div class="empty small">The study-provided data could not be loaded.</div>';
  },
  /* state page: the configurations a study-provided dataset holds for this state (exact term match only) */
  stateSection(label) {
    const L = SEC.datasets().filter(d => d.configs && d.configs[label]);
    if (!L.length) return '';
    return `<section class="block stack"><h3>In study-provided AU data ${typeBadge('SA')}</h3>${L.map(d => { const C = d.configs[label], tot = (A.sec.datasetN && A.sec.datasetN[d.id] && A.sec.datasetN[d.id][label]) || null;
      return `<div class="small"><b>${SEC.cite(d)}</b> ${streamTag(d.stream)}: most frequent configurations among ${esc(d.unit)}s of “${esc(label)}”: ${C.map(c => `${c.config === 'none' ? 'no action coded' : `<a href="#combo-${esc(c.config.replace(/\+/g, '-'))}">${c.config.split('+').map(a => 'AU' + a).join('+')}</a>`} (${c.n}${tot ? ' of ' + tot : ''})`).join('; ')}.</div>${(d.caveats || []).slice(0, 1).map(c => `<p class="tiny muted">${esc(c)}</p>`).join('')}`; }).join('')}</section>`;
  },
  methodHTML() {
    const D = SEC.datasets();
    if (!D.length) return '';
    return `<section class="stack"><h2>Secondary analyses of study-provided AU data</h2>
      <p class="small soft prose">Only AU codes released by the study authors were analysed (open data deposits and published tables); no video or images from these studies were downloaded or analysed.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dataset</th><th>Type of study</th><th>Provided</th><th>Licence</th><th>Analysis</th></tr></thead><tbody>
      ${D.map(d => `<tr><td class="small">${SEC.cite(d)}${d.url ? `<br><a class="tiny" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url.replace(/^https?:\/\//, ''))}</a>` : ''}</td><td>${streamTag(d.stream)}</td><td class="small">${esc(d.provided)}</td><td class="small">${esc(d.license || '')}</td><td class="small">${esc(d.method || '')}${(d.caveats || []).length ? `<br><span class="muted">${d.caveats.map(esc).join(' ')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
  }
};

/* ---- app/js/views_au.js ---- */
/* Views: overview, action index (face picker), action entry, finding. */
'use strict';
const UPPER = ['1', '2', '4', '5', '6', '7', '9', '43', '45', '38', '41', '44', '46'];
const LOWER = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '22', '23', '24', '25', '26', '27', '28'];
function spreadOf(code) {
  const a = A.kb.aus[code]; if (!a) return { states: 0, functions: 0 };
  return { states: (a.spread && a.spread.states) || 0, functions: (a.spread && a.spread.functions) || 0, claims: (a.claims || []).length };
}
/* face picker: single mode navigates; combine mode toggles a selection */
function pickerHTML(sel, mode) {
  const row = c => { const a = A.kb.aus[c]; if (!a) return ''; const sp = spreadOf(c); const on = sel.includes(c);
    return `<button class="aurow" data-au="${c}" aria-pressed="${on}" title="${esc(a.muscles)}"><b><span class="sr">AU</span>${c}</b><span>${esc(a.name)}</span><span class="sp" title="States with evidence">${sp.states}</span></button>`; };
  return `<div class="picker" data-mode="${mode}">
    <div class="col"><h4>Brows, eyes, nose</h4>${UPPER.map(row).join('')}</div>
    <div class="facecol"><figure class="plate"><div id="pickface">${faceSVG(sel, { muscles: true, hls: sel, fluid: true, title: sel.length ? sel.map(a => 'AU' + a).join(' + ') : 'Neutral face' })}</div></figure>
      <p class="picker-cap">${mode === 'combine' ? 'Select two or more actions, then open the combination.' : 'Point at an action to see it on the face; select it to open its entry.'} The number after each name counts the states with evidence.</p></div>
    <div class="col"><h4>Mouth, lips, jaw</h4>${LOWER.map(row).join('')}</div></div>`;
}
function attachPicker(root, mode, sel, onChange) {
  const face = $('#pickface', root);
  const draw = (aus, hl) => { face.innerHTML = faceSVG(aus, { muscles: true, hls: hl || aus, fluid: true, title: aus.length ? aus.map(a => 'AU' + a).join(' + ') : 'Neutral face' }); };
  root.addEventListener('pointerover', e => { const b = e.target.closest('.aurow'); if (!b) return; const c = b.dataset.au; draw(mode === 'combine' ? uniq(sel.concat([c])) : [c], [c]); });
  root.addEventListener('pointerout', e => { if (e.target.closest('.aurow') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.aurow'))) draw(sel); });
  root.addEventListener('click', e => {
    const b = e.target.closest('.aurow'); if (!b) return; const c = b.dataset.au;
    if (mode !== 'combine') { go('au-' + c); return; }
    const i = sel.indexOf(c); if (i >= 0) sel.splice(i, 1); else sel.push(c); sel.sort((x, y) => +x - +y);
    b.setAttribute('aria-pressed', sel.includes(c)); draw(sel); onChange && onChange(sel);
  });
}

/* ---------- home: the face composer ---------- */
const DESK = [
  ['Brows and forehead', ['1', '2', '4']],
  ['Eyes and lids', ['5', '6', '7', '43', '44', '45', '46']],
  ['Nose and cheeks', ['9', '10', '11', '38', '39']],
  ['Lips', ['12', '13', '14', '15', '16', '18', '20', '22', '23', '24', '28']],
  ['Jaw and chin', ['17', '25', '26', '27']],
  ['Head and gaze', ['51', '52', '53', '54', '55', '56', '61', '62']]
];
/* configurations named in the literature; the names say who proposed them, not what a face means */
const PRESETS = [
  ['Smile with cheek raising', ['6', '12'], 'the Duchenne smile'], ['Textbook surprise face', ['1', '2', '5', '26'], 'basic emotion theory'], ['Textbook fear face', ['1', '2', '4', '5', '7', '20', '26'], 'basic emotion theory'],
  ['Textbook anger face', ['4', '5', '7', '23'], 'basic emotion theory'], ['Textbook disgust face', ['9', '15', '16'], 'basic emotion theory'], ['Textbook sadness face', ['1', '4', '15'], 'basic emotion theory'],
  ['Pain face', ['4', '6', '7', '9', '10', '43'], 'the PSPI pain index'], ['Controlled smile, gaze down', ['12', '24', '64'], 'embarrassment, Keltner 1995'], ['Brow lowering alone', ['4'], 'one action']
];
/* numbers that challenge intuition: each is a verified finding's key number with its caption */
const SPARKS = ['S44', 'S15', 'S10', 'F06'];
function sparkHTML(id) {
  const c = A.I.claimById.get(id); if (!c) return '';
  const t = c.v4 || {}, k = t.key || {};
  return `<a class="spark" href="#claim-${esc(id)}" style="text-decoration:none"><div class="big">${esc(k.value || '')}</div><p>${esc(k.what || '')}</p><p class="soft">${esc(t.head || c.text)}</p><div class="src">${esc(c.cite)}</div></a>`;
}
const KSET = { A: .3, B: .6, C: 1, D: 1.25, E: 1.5 };
function formulaHTML(codes) {
  return codes.length ? `<span class="au-pre">AU</span>${codes.map(a => `<span class="n">${esc(a)}</span>`).join('<span class="plus">+</span>')}` : 'Neutral face';
}
function deskHTML() {
  return `<aside class="panel desk" aria-label="Facial actions"><div class="module-h"><span>Facial actions</span><button class="preset" id="clr" type="button">Clear</button></div>
    ${DESK.map(([g, L]) => { const L2 = L.filter(a => A.kb.aus[a]); return L2.length ? `<div class="desk-group"><h4>${esc(g)}</h4><div class="keys">${L2.map(a => `<button class="key" type="button" data-au="${a}" aria-pressed="false" title="AU${a} ${esc(auName(a))}: ${esc(A.kb.aus[a].muscles || '')}"><b>${a}</b>${esc(shortAU(a))}</button>`).join('')}</div></div>` : ''; }).join('')}
    <div class="intensity"><div class="cap"><span>Intensity</span><b id="kl">C</b></div><span>A</span><input type="range" id="kr" min="0" max="4" step="1" value="2" aria-label="Intensity, A (trace) to E (maximum)"><span>E</span></div></aside>`;
}
/* a short name for chips and callouts: "Lip corner puller" stays, "Upper lid raiser" stays; long ones lose their last word */
function shortAU(a) { const n = auName(a); return n.length > 22 ? n.replace(/\s+\S+$/, '') : n; }
/* wire the desk to a mounted face; onChange(sel) runs after every selection change */
function wireDesk(root, face, sel0, onChange) {
  const st = { sel: sel0.slice(), k: 'C' };
  const kmap = () => { const o = {}; st.sel.forEach(a => { o[a] = KSET[st.k]; }); return o; };
  const sync = ms => {
    $$('.key', root).forEach(b => b.setAttribute('aria-pressed', st.sel.includes(b.dataset.au)));
    $$('[data-p]', root).forEach(b => { const L = PRESETS[+b.dataset.p][1]; b.setAttribute('aria-pressed', L.length === st.sel.length && L.every(a => st.sel.includes(a))); });
    face.set(st.sel.filter(a => !NOT_DRAWN.has(a)), kmap(), ms); onChange(st.sel.slice());
  };
  $$('.key', root).forEach(b => {
    b.onclick = () => { const c = b.dataset.au, i = st.sel.indexOf(c); if (i >= 0) st.sel.splice(i, 1); else st.sel.push(c); st.sel.sort((x, y) => +x - +y); sync(); };
    b.onpointerenter = () => { if (!st.sel.includes(b.dataset.au)) { const o = kmap(); o[b.dataset.au] = KSET[st.k] * 0.9; face.set(st.sel.concat([b.dataset.au]), o, 260); } };
    b.onpointerleave = () => face.set(st.sel, kmap(), 260);
  });
  $$('[data-p]', root).forEach(b => b.onclick = () => { st.sel = PRESETS[+b.dataset.p][1].filter(a => A.kb.aus[a]).slice(); sync(700); if (b.classList.contains('litface')) { const t = $('.composer', root); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  $('#clr', root).onclick = () => { st.sel = []; sync(); };
  $('#kr', root).oninput = e => { st.k = 'ABCDE'[+e.target.value]; $('#kl', root).textContent = st.k; face.set(st.sel, kmap(), 200); };
  return { sync, st };
}
/* the computed reading of a configuration, in a few words (for thumbnails) */
function verdictShort(codes) {
  const G = E.bestGuess4(A.I, codes.filter(a => A.kb.aus[a])), V = G.verdict || {};
  if (V.curated) return { t: V.curated.label, c: V.confidence };
  if (!G.state) return { t: 'no evidence', c: 'none' };
  if (V.kind === 'state') return { t: stateLabel(G.state), c: V.confidence };
  if (V.kind === 'family') return { t: V.familyLabel, c: V.confidence };
  return { t: 'not specific', c: 'low' };
}
function litFacesHTML() {
  return `<div class="litfaces">${PRESETS.map(([n, L, who], i) => { const v = verdictShort(L);
    return `<button class="litface" type="button" data-p="${i}" aria-pressed="false" title="AU ${L.join(' + ')}: ${esc(who)}">${faceSVG(L.filter(a => !NOT_DRAWN.has(a)), { crop: 'tight', title: n })}
      <span class="ln">${esc(n)}</span><span class="lc">AU ${L.join(' + ')}</span><span class="lv">${RD.pips(v.c)}${esc(v.t)}</span></button>`; }).join('')}</div>`;
}
/* the composer: action desk, face stage with callouts, and the reading; shared by Compose and a combination's page */
function composerHTML(opt) {
  opt = opt || {};
  return `<div class="composer">
      ${deskHTML()}
      <section class="stage" aria-label="Composed face"><div class="stage-top"><div class="formula rest" id="formula">Neutral face</div><div class="names" id="fnames">Switch on an action</div></div>
        <div class="stage-face"><div id="stageface"></div></div>${opt.link ? '<a class="stage-link" id="fopen" href="#combo" hidden>All the evidence for this face</a>' : ''}</section>
      <section class="panel readout" id="readout" aria-live="polite"></section>
    </div>`;
}
/* mount the composer: onSel(sel) runs after every change of selection */
function mountComposer(main, sel0, onSel, opt) {
  opt = opt || {};
  const names = {}; Object.keys(A.kb.aus).forEach(a => { names[a] = shortAU(a); });
  const face = A.face = FaceMesh.mount($('#stageface', main), [], { callouts: true, names, title: 'Composed face' });
  const C = { face, desk: null };
  C.desk = wireDesk(main, face, [], sel => {
    const f = $('#formula', main); f.className = 'formula' + (sel.length ? '' : ' rest'); f.innerHTML = sel.length ? formulaHTML(sel) : 'Neutral face';
    $('#fnames', main).textContent = sel.length ? sel.map(a => auName(a)).join(', ') : (opt.hint || 'Switch on an action');
    const ln = $('#fopen', main); if (ln) { ln.hidden = !sel.length; ln.href = '#combo-' + sel.join('-'); }
    const ro = $('#readout', main); ro.innerHTML = readingHTML(sel); wireReading(ro, { onAdd: codes => { C.desk.st.sel = codes.filter(a => A.kb.aus[a]); C.desk.sync(500); } });
    if (onSel) onSel(sel);
  });
  C.desk.st.sel = sel0.filter(a => A.kb.aus[a]); C.desk.sync(opt.ms == null ? 900 : opt.ms);
  return C;
}
VIEWS.home = function (main) {
  main.innerHTML = `<div class="wrap">
    <h1 class="sr">Compose a face and read the evidence</h1>
    ${composerHTML({ link: true })}
    <section class="home-sec"><div class="section-h"><h2>Faces from the literature</h2><p>What a theory, an index or a study described, and the reading of the evidence for it.</p></div>${litFacesHTML()}</section>
    <section class="home-sec"><div class="section-h"><h2>Numbers that challenge intuition</h2></div>
      <div class="sparks">${SPARKS.map(sparkHTML).join('')}</div></section>
  </div>`;
  /* opening moment: the face performs a Duchenne smile once, then waits for the reader */
  mountComposer(main, ['6', '12'], null, { ms: 1100, hint: 'Switch on an action, or pick a face from the literature below' });
};
const REGION_ORDER = ['Brows and forehead', 'Eyes and lids', 'Eyes and cheeks', 'Nose', 'Cheeks and mid-face', 'Mouth and lips', 'Chin and jaw', 'Head', 'Gaze', 'Neck'];
const NOT_DRAWN = { has: a => !FaceMesh.DRAWN.has(String(a)) };   // actions the 3D face has no expression shape for
VIEWS.actions = function (main) {
  const codes = Object.keys(A.kb.aus).sort((a, b) => +a - +b);
  const regions = uniq(REGION_ORDER.concat(codes.map(c => A.kb.aus[c].region)));
  const tile = c => { const a = A.kb.aus[c], sp = spreadOf(c);
    return `<a class="tile" href="#au-${c}" title="AU${c} ${esc(a.name)}: ${esc(a.muscles)}">${faceSVG(NOT_DRAWN.has(c) ? [] : [c], { k: { [c]: 1.25 }, crop: 'tight', vectors: false, title: 'AU' + c })}
      <div class="tn"><b>${c}</b><span>${esc(a.name)}</span></div><div class="tm">${sp.states ? `${sp.states} ${sp.states === 1 ? 'state' : 'states'} with evidence` : 'no state with evidence'}${NOT_DRAWN.has(c) ? '; not drawn on the face' : ''}</div></a>`; };
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Facial action units</h1>
    <p class="lead">Every action as the face that makes it. Select one for its readings, how often it appears with each state, and the studies behind each statement.</p></div></section>
    <div>${regions.map(rg => { const L = codes.filter(c => A.kb.aus[c].region === rg); return L.length ? `<div class="region-h"><h2>${esc(rg)}</h2><span>${L.length} ${L.length === 1 ? 'action' : 'actions'}</span></div><div class="gallery">${L.map(tile).join('')}</div>` : ''; }).join('')}</div>
    <section class="stack"><h2>All entries</h2><p class="small soft prose">“States” counts distinct states (in the source authors' terms) with at least one positive link in the evidence base; it measures research attention as much as the action's range.</p>
    <div class="tbl-wrap"><table class="tbl" id="autbl"><thead><tr><th>Code</th><th>Name</th><th>Muscles</th><th>Region</th><th class="num">States</th><th class="num">Functions</th><th class="num">Findings</th></tr></thead><tbody>
    ${codes.map(c => { const a = A.kb.aus[c], sp = spreadOf(c); return `<tr><td><a class="mono" href="#au-${c}">AU${c}</a></td><td>${esc(a.name)}</td><td class="small">${esc(a.muscles)}</td><td class="small">${esc(a.region)}</td><td class="num">${sp.states}</td><td class="num">${sp.functions}</td><td class="num">${sp.claims}</td></tr>`; }).join('')}
    </tbody></table></div></section></div>`;
};

/* evidence-base matrix: states x streams with positive and null/inverse counts (independent samples) */
function evMatrix(au, opt) {
  opt = opt || {};
  const cols = opt.cols || ['posed', 'spontaneous', 'perception', 'function'];
  const byState = new Map();
  au.assoc.forEach(x => { if (!cols.includes(x.stream) || E.SKIP_STATES.has(x.state)) return; const s = byState.get(x.state) || { state: x.state, tot: 0, c: {} }; s.c[x.stream] = x; s.tot += x.present + x.unrelated + x.inverse; byState.set(x.state, s); });
  const rows = [...byState.values()].filter(r => r.tot > 0).sort((a, b) => b.tot - a.tot || a.state.localeCompare(b.state));
  if (!rows.length) return '<div class="empty">No coded associations for this action.</div>';
  const max = Math.max(1, ...rows.flatMap(r => Object.values(r.c).map(x => Math.max(x.present, x.unrelated + x.inverse))));
  const cell = (x, s) => { if (!x) return '<div></div>';
    const n0 = x.unrelated + x.inverse;
    const tip = `${esc(s)} · ${esc(STREAM_SHORT[x.stream])}<br><b>${pl(x.present, 'sample')}</b> with a positive link${n0 ? `, <b>${n0}</b> with null or inverse` : ''}${x.predicted ? `, ${x.predicted} proposed by theory only` : ''}${x.reviews ? `; ${x.reviews} review(s), not counted` : ''}${x.absent ? `; ${x.absent} absent by definition, not a null finding` : ''}<br><span class="k">types: ${esc(Object.entries(x.types).map(([k, v]) => k + ' ' + v).join(', '))}</span>`;
    const col = { posed: 'var(--s-posed)', spontaneous: 'var(--s-spont)', perception: 'var(--s-perc)', function: 'var(--s-func)' }[x.stream] || 'var(--ink-2)';
    return `<div class="ev-cell" data-tip="${esc(tip)}" tabindex="0">${x.present ? `<i class="bar" style="width:${Math.max(6, 60 * x.present / max)}px;background:${col}"></i><span class="n">${x.present}</span>` : ''}${n0 ? `<i class="bar nul" style="width:${Math.max(8, 60 * n0 / max)}px"></i><span class="n">${n0} null</span>` : ''}</div>`; };
  const render = r => `<div>${stateLink(r.state)}</div>${cols.map(c => cell(r.c[c], r.state)).join('')}`;
  const n = opt.n || 14;
  const head = `<div class="h">State (authors' term)</div>${cols.map(c => `<div class="h"><i class="sw ${swClass(c)}"></i>${esc(STREAM_SHORT[c])}</div>`).join('')}`;
  const grid = rows2 => `<div class="ev-strip" style="--n:${cols.length}">${head}${rows2.map(render).join('')}</div>`;
  return `<div class="tbl-wrap">${grid(rows.slice(0, n))}${rows.length > n ? `<details class="more"><summary class="small soft">All ${rows.length} states</summary>${grid(rows.slice(n))}</details>` : ''}</div>
    <div class="legend" style="margin-top:10px"><span><i class="bar" style="width:18px"></i> samples with a positive link (coloured by type of study)</span><span><i class="bar nul" style="width:18px"></i> samples with a null or inverse finding</span><span class="muted">Counts are independent samples, not effect sizes; they reflect research attention.</span></div>`;
}
/* non-human primate evidence is kept out of the human matrix and readings */
function compNote(au) {
  const L = au.assoc.filter(x => x.stream === 'comparative' && x.present > 0);
  return L.length ? `<p class="small soft" style="margin-top:10px">${typeBadge('IN')} Comparative evidence, kept out of the readings for human faces: in chimpanzees, a homologous action was coded in ${L.map(x => `${stateLink(x.state)} (${x.present})`).join(', ')}. It bears on evolutionary questions, not on what a human face shows.</p>` : '';
}
VIEWS.au = function (main, r) {
  const code = r.a, a = A.kb.aus[code];
  if (!a) { main.innerHTML = `<div class="wrap"><div class="empty">No entry for AU${esc(code)}. <a href="#actions">All actions</a></div></div>`; return; }
  const S = E.single(A.I, code);
  const claims = S.claims.filter(c => c.named !== false);
  const byStream = s => claims.filter(c => c.stream === s);
  const sp = spreadOf(code);
  const recs = A.kb.records.filter(rec => Object.values(rec.links).some(l => l.map(x => x.replace('*', '')).includes(code)));
  const types = countBy(recs, x => x.type), coded = countBy(recs, x => x.coded);
  const it = a.interp4, secHTML = SEC.auSection(code);
  const sec = (id, title, body) => body ? `<section class="layer" id="${id}"><div class="section-h"><h2>${esc(title)}</h2></div>${body}</section>` : '';
  main.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb" style="margin-bottom:12px"><a href="#actions">Actions</a><span aria-hidden="true">/</span><span>${esc(a.region)}</span></nav>
    <h1 class="sr">AU${esc(code)} ${esc(a.name)}</h1>
    <div class="au-hero">
      <section class="stage" aria-label="AU${esc(code)} on the face"><div class="stage-top"><div class="au-title"><span class="au-num"><span class="au-pre">AU</span>${esc(code)}</span><span class="au-name">${esc(a.name)}</span></div><div class="names">${esc(a.muscles)}</div></div>
        <div class="stage-face"><div id="auface"></div></div>
        <div class="intens"><span class="cap">Intensity <b id="intl">C</b></span><input type="range" min="0" max="4" step="1" value="2" id="ints" aria-label="Intensity, A (trace) to E (maximum)"><span></span><button class="preset" id="iplay" type="button" aria-pressed="true">Playing</button></div>
        ${NOT_DRAWN.has(code) ? '<p class="facecap">This action is not drawn on the face.</p>' : ''}</section>
      <section class="panel readout" id="aureading" aria-live="polite"></section>
    </div>
    <nav class="secnav" aria-label="Sections"><div class="wrap">${[['readings', 'Readings'], it && it.distinguish && it.distinguish.length ? ['tell', 'Tell apart'] : null, it && it.examples && it.examples.length ? ['examples', 'Examples'] : null, ['findings', 'Findings'], A.v43 ? null : ['relspec', 'How often'], secHTML ? ['secondary', 'Study data'] : null, ['behavior', 'Movement'], ['evidence', 'Evidence base']].filter(Boolean).map(([k, l]) => `<a href="#au-${code}" data-jump="${k}">${l}</a>`).join('')}<a href="#combo-${code}" class="out">Combine with others</a></div></nav>
    ${sec('readings', 'Readings to consider', it ? interp4HTML(code) : `<div class="empty">No reading has been written for AU${esc(code)}.</div>`)}
    ${it && it.distinguish && it.distinguish.length ? sec('tell', 'How to tell the readings apart', tellHTML(it)) : ''}
    ${it && it.examples && it.examples.length ? sec('examples', 'Worked examples', `<div class="exs">${it.examples.map(x => `<div class="ex"><div class="exs-set">${esc(x.setting)}</div><div class="exs-obs">${linkIds(x.observed)}</div><div class="exs-r">${linkIds(x.readings)}</div><div class="exs-c">${linkIds(x.caution)}</div></div>`).join('')}</div>`) : ''}
    ${A.v43 ? (() => { const x = FV.acrossHTML([code], 'fv-across'); return x ? sec('across', 'Across emotions in study data', `<p class="block-sub">How often AU${esc(code)} appeared in each emotion two studies coded.</p>${x}`) : ''; })() : ''}
    ${A.v43 ? (() => { const L = FV.auItems(code); return L.length ? sec('findings', 'Findings, played on the face', `<p class="block-sub">Every finding that measured AU${esc(code)}, alone or with other actions. Hover or select one: the face shows the movements it counted.</p>${FV.listHTML(L, 'fv-au')}`) : ''; })()
      : sec('findings', 'Verified findings', claimLedger(claims, ['spontaneous', 'posed', 'posed vs spontaneous', 'perception', 'function'], { n: 6 }) + (['theory', 'review', 'method'].some(s2 => byStream(s2).length) ? `<details class="more"><summary class="small soft">Theory, reviews and method (${byStream('theory').length + byStream('review').length + byStream('method').length})</summary><div style="margin-top:10px">${findingGrid(byStream('theory').concat(byStream('review'), byStream('method')), 30)}</div></details>` : ''))}
    ${A.v43 ? '' : sec('relspec', 'How often it appears with each state', RS.sectionAU(code))}
    ${secHTML ? sec('secondary', 'More from study data', secHTML + '<p class="tiny muted" style="margin-top:12px;max-width:90ch">Computed from AU codes the studies released; no video or images were analysed. Each dataset keeps its own terms; nothing is pooled.</p>') : ''}
    ${sec('behavior', 'Movement and appearance', `<div class="physgrid">${[['Movement', a.movement], ['Appearance', (a.appearance || []).join(' ')], ['Coordination', a.coordination], ['Easily confused with', a.confusions], ['Automated detection', a.detector], ['Intensity', A.kb.meta.intensity]].filter(x => x[1]).map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div><p class="tiny muted" style="margin-top:10px;max-width:90ch">${esc(A.kb.meta.physicalSource)}</p>`)}
    ${sec('evidence', 'Evidence base', `<div class="facts" style="margin-bottom:16px">${[[sp.states, 'states with evidence'], [sp.functions, 'uses beyond emotion'], [claims.length, 'verified findings'], [recs.length, 'coded records']].map(([n, l]) => `<div class="fact"><b>${n}</b><span>${l}</span></div>`).join('')}</div>
      <h3 style="margin-bottom:10px">Independent samples by state and type of study</h3>${evMatrix(a)}${compNote(a)}
      <details class="more"><summary class="small soft">How the evidence was established</summary><div class="grid2" style="align-items:start;margin-top:10px"><div>${chartBarH(['DE', 'SA', 'AR', 'RL', 'TH', 'IN'].map(t => ({ label: (A.kb.meta.evidenceTypes[t] || {}).label || t, v: types.get(t) || 0, tip: `${(A.kb.meta.evidenceTypes[t] || {}).label}: ${types.get(t) || 0} records` })), { dec: 0, title: 'Records by evidence type', w: 460, labelW: 170 })}</div>
        <p class="small soft">Of ${recs.length} coded records that mention AU${esc(code)}, ${[...coded.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v} ${esc({ 'full text': 'from the full text', 'abstract only': 'from the abstract only', 'secondary source': 'from secondary sources', 'translated abstract': 'from a translated abstract', 'publisher/author summary page': 'from a publisher or author summary' }[k] || 'from ' + k)}`).join(', ')}.</p></div></details>
      <details class="more"><summary class="small soft">Every coded record (${recs.length})</summary><div class="row" style="margin:10px 0 8px"><label class="field">Type of study <select id="stf"><option value="">All</option>${uniq(recs.map(x => x.stream)).map(s2 => `<option>${esc(s2)}</option>`).join('')}</select></label><button class="btn ghost small" id="dlrec" type="button">Download as CSV</button></div><div id="rectbl"></div></details>`)}
  </div>`;
  if (A.v43) { const box = $('#fv-au', main); if (box) A.mounts.push(FV.play(box, FV.auItems(code), { title: 'AU' + code }));
    const ac = FV.acrossPlay($('#fv-across', main), null); if (ac) A.mounts.push(ac); }
  const ro = $('#aureading', main); ro.innerHTML = readingHTML([code], { rows: 6 }); wireReading(ro, { onAdd: codes => go('combo-' + codes.join('-')) });
  let recAll = false;
  const drawRecs = () => { const f = $('#stf', main).value; const L = recs.filter(x => !f || x.stream === f); const n = recAll ? L.length : Math.min(10, L.length);
    $('#rectbl', main).innerHTML = recTable(L.slice(0, n)) + (L.length > n ? `<div class="row" style="margin-top:12px"><button class="btn ghost small" id="recmore" type="button">Show all ${L.length} records</button></div>` : '');
    const b = $('#recmore', main); if (b) b.onclick = () => { recAll = true; drawRecs(); }; };
  $('#stf', main).onchange = drawRecs; drawRecs();
  $('#dlrec', main).onclick = () => saveFile(`AU${code}_records.csv`, toCSV(['id', 'study', 'stream', 'type', 'state', 'measure', 'population', 'coded', 'links', 'behavior', 'finding'], recs.map(x => [x.id, (studyOf(x.study) || {}).cit || x.study, x.stream, x.type, x.state, x.measure, x.population, x.coded, JSON.stringify(x.links), x.behavior, x.finding])));
  const L = ['A', 'B', 'C', 'D', 'E'], K = [0.3, 0.6, 1, 1.25, 1.5];
  const names = {}; Object.keys(A.kb.aus).forEach(x => { names[x] = shortAU(x); });
  const face = A.face = FaceMesh.mount($('#auface', main), [], { callouts: true, names, title: 'AU' + code });
  const drawn = NOT_DRAWN.has(code) ? [] : [code];
  let kv = 2; const play = () => { face.loop(drawn, { k: { [code]: K[kv] }, ms: 950 }); $('#iplay', main).textContent = 'Playing'; $('#iplay', main).setAttribute('aria-pressed', 'true'); };
  play();
  $('#iplay', main).onclick = () => { if ($('#iplay', main).getAttribute('aria-pressed') === 'true') { face.stop(); face.set(drawn, { [code]: K[kv] }, 300); $('#iplay', main).textContent = 'Paused'; $('#iplay', main).setAttribute('aria-pressed', 'false'); } else play(); };
  $('#ints', main).oninput = e => { kv = +e.target.value; $('#intl', main).textContent = L[kv]; face.stop(); face.set(drawn, { [code]: K[kv] }, 220); $('#iplay', main).textContent = 'Paused'; $('#iplay', main).setAttribute('aria-pressed', 'false'); };
  $$('[data-jump]', main).forEach(x => x.onclick = e => { e.preventDefault(); const t = $('#' + x.dataset.jump, main); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const links = $$('.secnav [data-jump]', main);
  if ('IntersectionObserver' in window && links.length) { const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(l => l.classList.toggle('on', l.dataset.jump === en.target.id)); }), { rootMargin: '-35% 0px -60% 0px' });
    links.forEach(l => { const t = $('#' + l.dataset.jump, main); if (t) io.observe(t); }); }
};
/* the curated reading of one action: summary, then each reading as a card (the lead reading first), each with the ids it rests on */
function idChips(ids) { return (ids || []).map(id => `<a class="idchip" href="${/^[A-Z]\d+-\d+$/.test(id) ? '#rec-' : '#claim-'}${esc(id)}" title="${esc(idTitle(id))}">${esc(id)}</a>`).join(''); }
function idTitle(id) { const c = A.I.claimById.get(id); if (c) return (c.v4 && c.v4.head) || c.text; const r = A.I.recById.get(id); return r ? (r.behavior || r.finding || '') : ''; }
function interp4HTML(code) {
  const it = A.kb.aus[code].interp4; if (!it) return '';
  const best = it.best && it.best.state ? String(it.best.state).split(';')[0].trim().toLowerCase() : '';
  const lead = r => best && String(r.s).toLowerCase().startsWith(best.split(' ')[0]);
  return `<p class="synth" style="margin-bottom:16px">${linkIds(it.summary || '')}</p>
    <div class="rcards">${(it.readings || []).map(r => `<div class="rcard${lead(r) ? ' lead-r' : ''}"><div class="rs">${esc(r.s)}</div><div class="rt">${linkIds(r.t)}</div><div class="rc">${idChips(r.c)}</div></div>`).join('')}</div>
    ${it.context && it.context.length ? `<h3 style="margin:24px 0 10px">What changes the picture</h3><div class="tells">${it.context.map(c => `<div class="tell"><i aria-hidden="true">&#8635;</i><div><b>${esc(c.f)}.</b> ${linkIds(c.t)} ${idChips(c.c)}</div></div>`).join('')}</div>` : ''}`;
}
function tellHTML(it) {
  return `<div class="tells">${it.distinguish.map(d => `<div class="tell"><i aria-hidden="true">&#8800;</i><div>${linkIds(d.t || d)} ${idChips(d.c)}</div></div>`).join('')}</div>`;
}
function refLink(id) { return /^[A-Z]\d+-\d+$/.test(id) ? `<a href="#rec-${esc(id)}" class="mono small">${esc(id)}</a>` : `<a href="#claim-${esc(id)}" class="mono small">${esc(id)}</a>`; }
function claimRefs(ids) { return (ids || []).map(refLink).join(' '); }
/* escape a text and turn the ids of verified findings (S09) and records (S02-035) into links */
function linkIds(text) { return esc(text).replace(/\b([A-Z]\d{2,3}(?:-\d{3})?)\b/g, (m, id) => (A.I.claimById.has(id) || A.I.recById.has(id)) ? refLink(id) : m); }
function interpHTML(code) {
  const it = A.kb.aus[code].interp;
  if (!it) return `<div class="empty">No interpretation entry has been written for AU${esc(code)}. Use the associations above, the <a href="#combo-${code}">combination explorer</a> and the context of your data.</div>`;
  return `<div class="stack" style="gap:40px">
    <p class="synth">${linkIds(it.summary)}</p>
    ${it.context.length ? `<div><h3 style="margin-bottom:8px">What changes the picture</h3>${it.context.map(c => `<div class="ctx"><div><b>${esc(c.f)}</b></div><div class="small">${linkIds(c.t)} ${claimRefs(c.c)}</div></div>`).join('')}</div>` : ''}
    <div class="grid2"><div class="block"><h3>Readings to consider</h3><p class="block-sub">Each is a state or use with evidence for this action, in the authors' terms; none is implied by the action alone.</p><ul class="plain small">${it.alternatives.map(x => `<li>${esc(x.s)} ${claimRefs(x.c)}</li>`).join('')}</ul></div>
    <div class="block"><h3>What would distinguish them</h3><ul class="plain small">${it.distinguish.map(x => `<li>${linkIds(x)}</li>`).join('')}</ul></div></div>
    ${it.examples.length ? `<div><h3 style="margin-bottom:12px">Worked examples</h3><div class="grid2" style="gap:20px">${it.examples.map(x => `<div class="example"><dl><dt>Setting</dt><dd>${esc(x.setting)}</dd><dt>Observed</dt><dd>${linkIds(x.observed)}</dd><dt>Readings</dt><dd>${linkIds(x.readings)}</dd><dt>Caution</dt><dd>${linkIds(x.caution)}</dd></dl></div>`).join('')}</div></div>` : ''}
  </div>`;
}
function specHTML(code, S) {
  const pos = s => (S.byStream[s] || []).filter(x => x.present > 0 && !E.SKIP_STATES.has(x.state));
  const cols = ['posed', 'spontaneous', 'perception', 'function'];
  return `<div class="stack" style="gap:22px"><div class="facts">${cols.map(s => `<div class="fact"><b>${pos(s).length}</b><span>${esc(STREAM_SHORT[s])}: states or functions with a positive link</span></div>`).join('')}</div>
    <p class="small soft prose">Specificity is always relative to the states considered. An action that looks specific among six emotion categories may not be once pain, effort or conversation are included. The lists below are the reference class the evidence base offers for AU${esc(code)}.</p>
    <div class="grid3">${['spontaneous', 'perception'].map(s => `<div class="block"><h4 style="margin-bottom:8px">${esc(E.STREAM_LABEL[s])}</h4><p class="small">${pos(s).map(x => `${stateLink(x.state)}&nbsp;<span class="muted num-t">${x.present}</span>`).join(', ') || '<span class="muted">none</span>'}</p></div>`).join('')}
      <div class="block"><h4 style="margin-bottom:8px">Functions beyond emotion</h4><p class="small">${pos('function').map(x => `${stateLink(x.state)}&nbsp;<span class="muted num-t">${x.present}</span>`).join(', ') || '<span class="muted">none</span>'}</p></div></div></div>`;
}
VIEWS.claim = function (main, r) {
  const c = A.I.claimById.get(r.a);
  if (!c) { main.innerHTML = '<div class="wrap"><div class="empty">Unknown finding.</div></div>'; return; }
  const st = studyOf(c.study) || {}, t = c.v4 || {}, k = t.key || {};
  const same = A.kb.claims.filter(x => x.study === c.study && x.id !== c.id && x.named !== false);
  const drawn = c.aus.filter(a => !NOT_DRAWN.has(a) && A.kb.aus[a]);
  const facts = [['Design', st.design], ['Key numbers', st.numbers], ["Authors' conclusion", st.conclusion], ['Caveats', st.caveats], ["Authors' terms", (st.terms || []).join(', ')]].filter(x => x[1]);
  main.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb" style="margin-bottom:12px"><a href="#findings">Findings</a><span aria-hidden="true">/</span><span>${esc(c.cite)}</span></nav>
    ${c.named === false ? `<p class="unlisted"><b>Not listed here.</b> This finding ${esc(c.unnamed || 'names no facial movement')}, so it does not say what the face does. It is kept here because other entries cite it.</p>` : ''}
    <article class="fhero" style="--fc:${STREAM_COL[c.stream] || 'var(--s-other)'}">
      <div class="fh-main">${k.value ? `<div class="fh-key"><b>${esc(k.value)}</b><span>${esc(k.what || '')}</span></div>` : ''}
        <h1 class="fh-head">${esc(t.head || c.text)}</h1>
        ${t.detail ? `<p class="fh-detail">${esc(t.detail)}</p>` : ''}
        <div class="fh-meta">${streamTag(c.stream)}<span class="dirtag">${esc(DIR_LABEL[c.dir] || c.dir)}</span>${typeBadge(c.type)}<span class="soft">checked against the ${esc(c.basis === 'full text' ? 'full text' : 'abstract or summary')}</span></div>
        ${(t.num || c.num) ? `<p class="fh-num">${esc(t.num || c.num)}</p>` : ''}${(t.lim || c.lim) ? `<p class="fh-lim"><b>Limitation.</b> ${esc(t.lim || c.lim)}</p>` : ''}
        <div class="fh-src">${citeLink(c)}${st.doi ? ` <a href="https://doi.org/${esc(st.doi)}" target="_blank" rel="noopener" class="soft">doi:${esc(st.doi)}</a>` : ''}</div></div>
      <div class="fh-side">${drawn.length ? `<a class="fh-face" href="#combo-${c.aus.join('-')}" title="Read this face">${faceSVG(drawn, { crop: 'tight', title: 'AU ' + c.aus.join(' + ') })}<span>AU ${esc(c.aus.join(' + '))}</span></a>` : ''}
        <div class="fh-tags">${c.states.map(s2 => `<span class="pill">${stateLink(s2)}</span>`).join('')}</div>
        ${c.aus.length ? `<div class="fh-tags">${c.aus.map(x => auChip(x)).join('')}</div>` : ''}</div>
    </article>
    ${facts.length ? `<details class="more" style="margin-top:18px"><summary class="small soft">About the source</summary><dl class="kv small" style="margin-top:8px">${facts.map(([k2, v]) => `<dt>${esc(k2)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}
    ${same.length ? `<section class="layer"><div class="section-h"><h2>Other findings from this source</h2></div>${findingGrid(same, 8)}</section>` : ''}</div>`;
};

/* all verified findings: the balance of directions by type of study, drawn as bars that filter the cards below */
VIEWS.findings = function (main) {
  const ORDER = ['spontaneous', 'posed', 'posed vs spontaneous', 'perception', 'function', 'theory', 'review', 'method', 'automated', 'other'];
  const C = A.kb.claims.filter(c => c.named !== false).sort((a, b) => (ORDER.indexOf(a.stream) + 1 || 99) - (ORDER.indexOf(b.stream) + 1 || 99) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const ST = ORDER.filter(s => C.some(c => c.stream === s));
  const ctxs = uniq(C.flatMap(c => c.ctx)).sort();
  const nFull = C.filter(c => c.basis === 'full text').length;
  const DIRS = [['supports', 'Supports'], ['qualifies', 'Qualifies'], ['null', 'Null result'], ['contradicts', 'Contradicts']];
  const F = { s: '', d: '' };
  const maxN = Math.max(...ST.map(s => C.filter(c => c.stream === s).length));
  const label = s => E.STREAM_LABEL[s] || STREAM_SHORT[s] || s;
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Verified findings</h1>
    <p class="lead">${C.length} findings that name the movements, checked against their sources, ${nFull} against the full text. Select a bar to filter.</p>
    <p class="small soft">${A.kb.claims.length - C.length} findings that rate or label whole faces, or concern theory and method, are left out; <a href="#method">Method</a> lists them.</p></div>
    <div class="legend fb-key">${DIRS.map(([k, l]) => `<span><i class="fbk d-${k}"></i>${l}</span>`).join('')}</div></section>
    <div class="fbal" id="fbal"></div>
    <div class="row fb-filters"><input type="search" id="fq" placeholder="Search a word, state or author" aria-label="Search findings" style="width:260px"><label class="field">Action<input id="fa" placeholder="e.g. 12" style="width:84px" inputmode="numeric"></label>
      <details class="fb-more"><summary class="small soft">More filters</summary><div class="row" style="gap:10px 16px;margin-top:8px">
        <label class="field">Evidence type<select id="ft"><option value="">All</option>${Object.entries(A.kb.meta.evidenceTypes).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
        <label class="field">Checked against<select id="fb"><option value="">All</option><option value="full text">Full text</option><option value="abstract">Abstract or summary</option></select></label>
        <label class="field">Context<select id="fc"><option value="">All</option>${ctxs.map(c => `<option>${esc(c)}</option>`).join('')}</select></label></div></details>
      <button class="btn ghost small" id="fdl" type="button">Download as CSV</button></div>
    <div id="fsum" class="small soft"></div><div id="flist"></div></div>`;
  let L = C, fvStage = null;
  const drawBal = () => { $('#fbal', main).innerHTML = ST.map(s => { const M = C.filter(c => c.stream === s);
    return `<div class="fb-r${F.s === s ? ' on' : ''}"><button class="fb-l" type="button" data-s="${esc(s)}" aria-pressed="${F.s === s && !F.d}"><i class="sw ${swClass(s)}"></i><span>${esc(label(s))}</span><em>${M.length}</em></button>
      <div class="fb-bar" style="width:${(100 * M.length / maxN).toFixed(1)}%">${DIRS.map(([k, l]) => { const n = M.filter(c => c.dir === k).length;
        return n ? `<button class="fb-seg d-${k}" type="button" data-s="${esc(s)}" data-d="${k}" aria-pressed="${F.s === s && F.d === k}" style="flex:${n} 1 0" title="${esc(`${label(s)}: ${n} ${l.toLowerCase()}`)}">${n}</button>` : ''; }).join('')}</div></div>`; }).join('');
    $$('#fbal button', main).forEach(b => b.onclick = () => { const s = b.dataset.s, d = b.dataset.d || ''; if (F.s === s && F.d === d) { F.s = ''; F.d = ''; } else { F.s = s; F.d = d; } drawBal(); draw(); }); };
  const draw = () => {
    const ty = $('#ft', main).value, b = $('#fb', main).value, cx = $('#fc', main).value;
    const au = E.normAU($('#fa', main).value || ''), q = $('#fq', main).value.trim().toLowerCase();
    L = C.filter(c => (!F.s || c.stream === F.s) && (!F.d || c.dir === F.d) && (!ty || c.type === ty) && (!b || c.basis === b) && (!cx || c.ctx.includes(cx)) && (!au || c.aus.includes(au))
      && (!q || [c.text, c.num, c.cite, c.lim, c.states.join(' '), c.id, (c.v4 || {}).head].join(' ').toLowerCase().includes(q)));
    $('#fsum', main).innerHTML = L.length === C.length ? '' : `${L.length} of ${C.length} findings${F.s ? `, ${esc(label(F.s)).toLowerCase()}` : ''}${F.d ? `, ${esc((DIRS.find(x => x[0] === F.d) || [])[1] || '').toLowerCase()}` : ''}. <button class="linkbtn" type="button" id="fclr">Show all</button>`;
    const cl = $('#fclr', main); if (cl) cl.onclick = () => { F.s = ''; F.d = ''; ['#fq', '#fa', '#ft', '#fb', '#fc'].forEach(id => { $(id, main).value = ''; }); drawBal(); draw(); };
    if (A.v43) { if (fvStage) { try { fvStage.destroy(); } catch (e) { /* gone */ } fvStage = null; }
      const items = L.map(FV.itemClaim); $('#flist', main).innerHTML = items.length ? FV.listHTML(items, 'fv-find') : '<div class="empty">No finding matches these filters.</div>';
      const fb = $('#fv-find', main); if (fb) { fvStage = FV.play(fb, items, { title: 'Finding' }); A.mounts.push(fvStage); } }
    else $('#flist', main).innerHTML = L.length ? findingGrid(L, 24, 'More findings') : '<div class="empty">No finding matches these filters.</div>';
  };
  ['#ft', '#fb', '#fc'].forEach(id => $(id, main).onchange = draw);
  ['#fa', '#fq'].forEach(id => $(id, main).oninput = draw);
  $('#fdl', main).onclick = () => saveFile('verified_findings.csv', toCSV(['id', 'actions', 'states', 'type_of_study', 'direction', 'evidence_type', 'checked_against', 'finding', 'numbers', 'context', 'limitation', 'citation', 'doi'],
    L.map(c => { const st = studyOf(c.study) || {}, t = c.v4 || {}; return [c.id, c.aus.map(a => 'AU' + a).join('+'), c.states.join('; '), c.stream, c.dir, c.type, c.basis, t.head || c.text, t.num || c.num, c.ctx.join('; '), t.lim || c.lim, st.cit || c.cite, st.doi || '']; })));
  drawBal(); draw();
};

/* one coded record of the evidence base, with its source */
VIEWS.rec = function (main, r) {
  const x = A.I.recById.get(r.a);
  if (!x) { main.innerHTML = '<div class="wrap"><div class="empty">Unknown record.</div></div>'; return; }
  const st = studyOf(x.study) || {};
  const links = Object.entries(x.links || {}).map(([k, v]) => `${esc(k)}: ${v.map(a => a.replace('*', '')).map(a => auCode(a)).join(' ')}${v.some(a => a.endsWith('*')) ? ' <span class="tiny muted">(* interpretive AU basis)</span>' : ''}`).join('<br>');
  main.innerHTML = `<div class="wrap stack-l narrow"><div class="stack"><nav class="crumbs" aria-label="Breadcrumb"><a href="#findings">Evidence</a><span aria-hidden="true">/</span><span>Record ${esc(x.id)}</span></nav><h1>${esc(shortCite(st.cit || x.study))}</h1></div>
    <div class="stack"><div class="row" style="gap:8px 14px">${typeBadge(x.type)} ${streamTag(x.stream)} ${dirMark(x.dir)} <b>${stateLink(x.state)}</b></div>
      <dl class="kv small"><dt>Behavior</dt><dd>${esc(x.behavior || '–')}</dd><dt>Finding</dt><dd>${esc(x.finding || '–')}</dd>${x.effect ? `<dt>Effect</dt><dd>${esc(x.effect)}</dd>` : ''}
      <dt>Actions</dt><dd>${links || '–'}</dd>${x.config ? `<dt>Configuration</dt><dd>${x.config.split('+').map(a => auCode(a)).join(' ')}</dd>` : ''}
      <dt>Elicitation</dt><dd>${esc(x.elicitation || '–')}</dd><dt>Measure</dt><dd>${esc(x.measure || '–')}</dd><dt>Population</dt><dd>${esc(x.population || '–')}${x.n ? '; n = ' + esc(x.n) : ''}</dd>
      <dt>Coded from</dt><dd>${esc(x.coded || '–')}${x.verified ? `; re-checked against the ${esc(x.verified)}` : '; not re-checked'}</dd>${x.loc ? `<dt>Location</dt><dd>${esc(x.loc)}</dd>` : ''}${x.note ? `<dt>Note</dt><dd>${esc(x.note)}</dd>` : ''}</dl></div>
    <div class="block stack"><h3>Source</h3><p class="small">${esc(st.cit || x.study)} ${st.doi ? `<a href="https://doi.org/${esc(st.doi)}" target="_blank" rel="noopener">doi:${esc(st.doi)}</a>` : ''}</p>
      ${st.design ? `<p class="small soft"><b>Design.</b> ${esc(st.design)}</p>` : ''}${st.conclusion ? `<p class="small soft"><b>Authors' conclusion.</b> ${esc(st.conclusion)}</p>` : ''}</div>
    <p class="small"><a href="#findings">All verified findings</a></p></div>`;
};

/* ---- app/js/views_combo.js ---- */
/* Views: combination explorer, states, evidence map. */
'use strict';
function ladder(level, codes1) {
  const L = codes1 ? E.LEVELS_SINGLE : E.LEVELS; const d = L[level] || {};
  return `<span class="ladder" title="${esc(d.desc || '')}">${[0, 1, 2, 3].map(i => `<i class="${i <= level ? 'f' : ''}"></i>`).join('')}<em>${esc(d.label || '')}</em></span>`;
}
/* ---------- a combination: the composer, then its evidence drawn ----------
 * Same vocabulary as the reading: a filled square is one independent sample that reported the link (coloured by type of
 * study), a hollow square one that looked and did not find it, a ring a review or a theory that names it (not counted). */
const ST_ORDER = ['spontaneous', 'posed', 'perception', 'function', 'automated', 'theory', 'review', 'other'];
const ST_WORD = { spontaneous: 'felt', posed: 'posed', perception: 'seen by observers', function: 'social use', automated: 'automated coding', theory: 'theory', review: 'review', other: 'other' };
const stCol = s => RD.COL[s] || 'var(--ink-3)';
function cfgKey(L) { return L.slice().sort((a, b) => +a - +b).join('+'); }
/* one row per state: who reported exactly these actions together with it */
function stripHTML(cfgs, n) {
  const by = new Map();
  cfgs.forEach(c => { const g = by.get(c.state) || { state: c.state, n: 0, x: 0, o: 0, sq: [], src: [] };
    for (let i = 0; i < (c.units || 0); i++) g.sq.push(c.stream);
    g.n += c.units || 0; g.x += c.contra || 0; g.o += (c.reviews || 0) + (c.theory || 0) + (c.indirect || 0); by.set(c.state, g); });
  const rows = [...by.values()].sort((a, b) => b.n - a.n || b.o - a.o || b.x - a.x || a.state.localeCompare(b.state));
  rows.forEach(g => g.sq.sort((a, b) => ST_ORDER.indexOf(a) - ST_ORDER.indexOf(b)));
  const row = g => { const kinds = uniq(g.sq).map(s => `${g.sq.filter(x => x === s).length} ${ST_WORD[s]}`).join(', ');
    const tip = [g.n ? `${pl(g.n, 'sample')} reported it (${kinds})` : '', g.x ? `${g.x} looked and did not find it` : '', g.o ? `${g.o} review or theory names it, not counted` : ''].filter(Boolean).join('; ');
    return `<div class="strip-r"><span class="st">${stateLink(g.state, RD.label(g.state))}</span><span class="sq big" title="${esc(tip)}">${g.sq.map(s => `<b style="background:${stCol(s)}"></b>`).join('')}${'<b class="x"></b>'.repeat(Math.min(g.x, 10))}${'<b class="o"></b>'.repeat(Math.min(g.o, 8))}</span><span class="n">${g.n || ''}</span></div>`; };
  return `<div class="strip">${moreList(rows, n || 8, row, 'More states')}</div>`;
}
const STRIP_KEY = `<div class="eg-legend"><span><span class="sq"><b style="background:var(--s-spont)"></b><b style="background:var(--s-posed)"></b><b style="background:var(--s-perc)"></b><b style="background:var(--s-func)"></b></span>a sample that reported it: felt, posed, seen, social use</span><span><span class="sq"><b class="x"></b></span>looked and did not find it</span><span><span class="sq"><b class="o"></b></span>a review or theory names it (not counted)</span></div>`;
/* reported faces as thumbnails: the selected actions dark, the others the reported face adds */
function cfgFacesHTML(cfgs, sel, n) {
  const seen = new Map();
  cfgs.forEach(c => { const k = cfgKey(c.aus) + '|' + c.state; const g = seen.get(k) || { aus: c.aus.map(String), state: c.state, n: 0, o: 0, x: 0, streams: [] }; g.n += c.units || 0; g.o += (c.reviews || 0) + (c.theory || 0) + (c.indirect || 0); g.x += c.contra || 0; g.streams.push(c.stream); seen.set(k, g); });
  const L = [...seen.values()].sort((a, b) => b.n - a.n || b.o - a.o || a.aus.length - b.aus.length);
  if (!L.length) return '';
  const card = g => { const st = ST_ORDER.find(s => g.streams.includes(s)) || 'other';
    return `<button class="cface" type="button" data-codes="${esc(cfgKey(g.aus))}" title="${esc(`AU ${g.aus.join(' + ')} reported with ${g.state}`)}">${faceSVG(g.aus.filter(a => !NOT_DRAWN.has(a)), { crop: 'tight', title: 'AU ' + g.aus.join(' + ') })}
      <span class="cf-c"><span class="au">AU</span> ${g.aus.map(a => !sel || sel.includes(a) ? `<span>${esc(a)}</span>` : `<em>${esc(a)}</em>`).join('+<wbr>')}</span>
      <span class="cf-s"><i style="background:${stCol(st)}"></i><span>${esc(RD.label(g.state))}</span></span>
      <span class="cf-n">${g.n ? pl(g.n, 'sample') : g.o ? 'named, untested' : g.x ? 'not found' : ''}${g.x && g.n ? `, ${g.x} not found` : ''}</span></button>`; };
  return `<div class="cfaces">${L.slice(0, n || 10).map(card).join('')}</div>${L.length > (n || 10) ? `<details class="more"><summary class="small soft">${L.length - (n || 10)} more</summary><div class="cfaces" style="margin-top:10px">${L.slice(n || 10).map(card).join('')}</div></details>` : ''}`;
}
/* each selected action on its own: its face and the states with the most samples, one square per sample */
function aloneHTML(codes) {
  const T = ['spontaneous', 'posed', 'perception', 'function'];
  return `<div class="alone">${codes.map(a => { const S = E.single(A.I, a), by = new Map();
    T.forEach(s => (S.byStream[s] || []).forEach(x => { if (!(x.present > 0) || E.SKIP_STATES.has(x.state)) return; const g = by.get(x.state) || { state: x.state, n: 0, sq: [] }; g.n += x.present; for (let i = 0; i < x.present; i++) g.sq.push(s); by.set(x.state, g); }));
    const rows = [...by.values()].sort((p, q) => q.n - p.n).slice(0, 5);
    return `<div class="alone-c"><a class="ah" href="#au-${esc(a)}">${faceSVG(NOT_DRAWN.has(a) ? [] : [a], { k: { [a]: 1.25 }, crop: 'tight', title: 'AU' + a })}<span><b>AU${esc(a)}</b>${esc(auName(a))}</span></a>
      <div class="strip sm">${rows.length ? rows.map(g => `<div class="strip-r"><span class="st">${stateLink(g.state, RD.label(g.state))}</span><span class="sq" title="${esc(pl(g.n, 'sample'))}">${g.sq.slice(0, 16).map(s => `<b style="background:${stCol(s)}"></b>`).join('')}${g.n > 16 ? '<em>+</em>' : ''}</span><span class="n">${g.n}</span></div>`).join('') : '<p class="none">No state with a positive link.</p>'}</div></div>`; }).join('')}</div>`;
}
/* what would tell the readings apart: the distinguishing tells written for each selected action */
function tellsFor(codes, n) {
  const seen = new Set(), L = [];
  codes.forEach(a => (((A.kb.aus[a] || {}).interp4 || {}).distinguish || []).forEach(it => { const k = it.t.slice(0, 60); if (!seen.has(k)) { seen.add(k); L.push(it); } }));
  return L.slice(0, n || 6);
}
function comboDetails(codes) {
  const R = E.readings(A.I, codes, {}), J = R.joint, notes = E.pairNotes(codes);
  const exact = J.exact, bigger = J.superset.concat(J.embedded), parts = codes.length > 2 ? J.within : [];
  const often = A.v43 ? '' : RS.comboRows(codes), fvL = A.v43 ? FV.comboItems(codes) : [];
  const tells = tellsFor(codes, 6);
  const recs = uniq(exact.concat(bigger).flatMap(c => (c.recs || []).concat(c.contraRecs || []))).map(id => A.I.recById.get(id)).filter(Boolean);
  const sec = (id, h, sub, body) => body ? `<section class="cx" id="${id}"><div class="cx-h"><h2>${h}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${body}</section>` : '';
  return `${notes.length ? `<div class="cx-note">${notes.map(x => `<p>${esc(x[1])}</p>`).join('')}</div>` : ''}
    ${(() => { const data = codes.length > 1 && SEC.microSets().some(d => codes.every(a => d.auCols && d.auCols[a]));
      const tog = sec('cx-together', codes.length > 1 ? 'Reported together' : 'Reported with', codes.length > 1 ? `Studies that coded all ${codes.length} actions at once.` : 'Studies that linked this action to a state.', exact.length ? stripHTML(exact) + STRIP_KEY : `<p class="none">No study reports exactly ${codes.map(a => 'AU' + a).join(' + ')}${bigger.length || parts.length ? '; the faces below come closest' : ''}.</p>`);
      return data ? `<div class="cx-grid">${tog}${sec('cx-data', 'In data released by studies', 'Share of coded items that showed every selected action.', '<div id="secjoint"></div>')}</div>` : tog; })()}
    ${often ? sec('cx-often', 'How often it appears', 'Share of cases of the state that showed it, and of other states.', often) : ''}
    ${fvL.length ? sec('cx-often', 'Findings, played on the face', 'Estimates and findings for exactly these actions first, then findings about bigger faces that include them. Hover or select one: the face shows the movements it counted.', FV.listHTML(fvL, 'fv-combo')) : ''}
    ${bigger.length ? sec('cx-bigger', 'Reported faces that contain it', `The selected actions dark, the actions each face adds pale. Select one to read it.`, cfgFacesHTML(bigger, codes, 10)) : ''}
    ${parts.length ? sec('cx-parts', 'Parts reported on their own', 'Reported faces made of some of the selected actions.', cfgFacesHTML(parts, codes, 10)) : ''}
    ${codes.length > 1 ? sec('cx-alone', 'Each action alone', 'States with the most samples for each action by itself.', aloneHTML(codes)) : ''}
    ${tells.length ? sec('cx-tells', 'What would tell the readings apart', '', tellHTML({ distinguish: tells })) : ''}
    ${recs.length ? `<details class="more cx-recs"><summary class="small soft">The ${pl(recs.length, 'record')} behind these counts</summary>${recTable(recs)}</details>` : ''}`;
}
VIEWS.combo = function (main, r) {
  const sel0 = (r.a || []).filter(a => A.kb.aus[a]);
  main.innerHTML = `<div class="wrap"><h1 class="sr" id="ctitle">Combination</h1>${composerHTML()}<div id="res" class="cx-wrap"></div></div>`;
  let timer = 0, last = null;
  const draw = sel => {
    const h = sel.length ? 'combo-' + sel.join('-') : 'combo'; if (location.hash !== '#' + h) { try { history.replaceState(null, '', '#' + h); } catch (e) { /* the frame may refuse; the view still works */ } }
    $('#ctitle', main).textContent = sel.length ? 'AU ' + sel.join(' + ') : 'Combination';
    document.title = (sel.length ? 'AU ' + sel.join(' + ') + ', ' : '') + TITLE;
    const key = sel.join('+'); if (key === last) return; const first = last === null; last = key;
    clearTimeout(timer); timer = setTimeout(() => {
      const res = $('#res', main); if (!res) return;
      if (!sel.length) { res.innerHTML = '<p class="none cx-empty">Switch on actions, or pick a face from the literature on the Compose page.</p>'; return; }
      res.innerHTML = comboDetails(sel);
      const sj = $('#secjoint', res); if (sj) SEC.comboSection(sel, sj);
      if (A.v43) { (A.cmounts || []).forEach(m => { try { m.destroy(); } catch (e) { /* gone */ } }); A.cmounts = []; const fb = $('#fv-combo', res); if (fb) { const m = FV.play(fb, FV.comboItems(sel), { title: 'AU ' + sel.join(' + ') }); if (m) { A.cmounts.push(m); A.mounts.push(m); } } }
      $$('.cface', res).forEach(b => b.onclick = () => { C.desk.st.sel = b.dataset.codes.split('+').filter(a => A.kb.aus[a]); C.desk.sync(600); const t = $('.composer', main); if (t && t.getBoundingClientRect().top < 0) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
    }, first ? 0 : 160);
  };
  const C = mountComposer(main, sel0, draw, { ms: sel0.length ? 800 : 0 });
};

/* the meta-analytic share of people who showed the actions proposed for a state (Durán & Fernández-Dols, 2021) */
function dfdCell(k) {
  const g = ma => RS.dfd().find(e => e.ma === ma && e.role === 'main' && RS.norm(e.state) === RS.norm(k));
  const a = g('MA1'), b = g('MA2');
  if (!a && !b) return '';
  return `<a class="fact" href="#reliability-meta" style="text-decoration:none"><b>${b ? RS.pct(b.estimate) : RS.pct(a.estimate)}</b><span>of people feeling it showed the proposed actions${b ? ', whole or in part' : ''} (meta-analysis)${a && b ? `; ${RS.pct(a.estimate)} all of them` : ''}</span></a>`;
}
/* evidence counts by type of study as a three-bar glyph */
function streamBars(st, max) {
  return `<span class="sb" aria-hidden="true">${[['spontaneous', 'spont'], ['posed', 'posed'], ['perception', 'perc'], ['function', 'func']].map(([k, c]) => { const n = (st.streams || {})[k] || 0; return `<i style="height:${n ? Math.max(3, 16 * Math.sqrt(n / max)) : 2}px;background:${n ? `var(--s-${c})` : 'var(--sunk-2)'}"></i>`; }).join('')}</span>`;
}
function stateFace(label) {
  const sy = A.kb.states[label] && A.kb.states[label].syn;
  if (sy && sy.best && sy.best.aus && sy.best.aus.length) return sy.best.aus.map(String);
  const c = A.kb.configs.filter(x => x.state === label && ['spontaneous', 'posed', 'perception'].includes(x.stream) && x.units).sort((a, b) => b.units - a.units)[0];
  return c ? c.aus.map(String) : [];
}
VIEWS.states = function (main) {
  const S = Object.values(A.kb.states).filter(s => !E.SKIP_STATES.has(s.label) && E.isState(s.label)).sort((a, b) => b.n - a.n);
  const classes = uniq(S.map(s => s.cls || 'unclassified'));
  const syn = S.filter(s => s.syn);
  const max = Math.max(1, ...syn.flatMap(s => ['spontaneous', 'posed', 'perception', 'function'].map(k => (s.streams || {})[k] || 0)));
  const key = `<div class="legend sbkey"><span><i class="kb" style="background:var(--s-spont)"></i>Felt</span><span><i class="kb" style="background:var(--s-posed)"></i>Posed</span><span><i class="kb" style="background:var(--s-perc)"></i>Seen by observers</span><span><i class="kb" style="background:var(--s-func)"></i>Beyond emotion</span></div>`;
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>States</h1>
    <p class="lead">Each face is the configuration the evidence best supports for the state. Bars count independent samples by type of study.</p></div>${key}</section>
    <div class="stiles">${syn.map(st => { const f = stateFace(st.label), nm = stateLabel(st.label);
      return `<a class="stile" href="#state-${esc(A.I.stateSlug.get(st.label))}">${faceSVG(f.filter(a => !NOT_DRAWN.has(a)), { crop: 'tight', title: st.label })}<b${nm.length > 11 ? ' class="long"' : ''}>${esc(nm)}</b><span class="sc">${f.length ? 'AU ' + f.join(' + ') : 'no configuration'}</span>${streamBars(st, max)}</a>`; }).join('')}</div>
    <section class="stack"><div class="section-h"><h2>Every state, in the authors' terms</h2><p>${S.length} states. Happiness, amusement, joy and positive affect stay separate, because the studies measured different things.</p></div>
    <div class="row"><input type="search" id="sq" placeholder="Filter states" aria-label="Filter states" style="width:240px"><select id="sc" aria-label="Class"><option value="">All classes</option>${classes.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="tbl-wrap"><table class="tbl sttbl"><thead><tr><th>State</th><th>Class</th><th class="num">Records</th><th>Felt</th><th>Posed</th><th>Seen by observers</th><th>Beyond emotion</th></tr></thead><tbody id="stb"></tbody></table></div>
    <div class="row" id="stmore"></div></section></div>`;
  const mx = Math.max(...S.map(s => Math.max(...['posed', 'spontaneous', 'perception', 'function'].map(k => s.streams[k] || 0))));
  const bar = (n, k) => n ? `<span class="ev-cell"><i class="bar" style="width:${Math.max(3, 60 * n / mx)}px;background:var(--s-${k})"></i><span class="n">${n}</span></span>` : '';
  let all = false;
  const draw = () => { const q = $('#sq', main).value.toLowerCase(), c = $('#sc', main).value;
    const L = S.filter(s => (!q || s.label.toLowerCase().includes(q) || stateLabel(s.label).toLowerCase().includes(q)) && (!c || (s.cls || 'unclassified') === c));
    const N = all || q || c ? L.length : 30;
    $('#stb', main).innerHTML = L.slice(0, N).map(s => `<tr><td>${stateLink(s.label)}</td><td class="small muted">${esc(s.cls || '')}</td><td class="num">${s.n}</td><td>${bar(s.streams.spontaneous, 'spont')}</td><td>${bar(s.streams.posed, 'posed')}</td><td>${bar(s.streams.perception, 'perc')}</td><td>${bar(s.streams.function, 'func')}</td></tr>`).join('');
    $('#stmore', main).innerHTML = L.length > N ? `<button class="btn ghost small" type="button" id="stall">Show all ${L.length} states</button>` : '';
    const b = $('#stall', main); if (b) b.onclick = () => { all = true; draw(); }; };
  $('#sq', main).oninput = draw; $('#sc', main).onchange = draw; draw();
};
VIEWS.state = function (main, r) {
  const label = A.I.slugState.get(r.a);
  const st = label && A.kb.states[label];
  if (!st) { main.innerHTML = '<div class="wrap"><div class="empty">Unknown state. <a href="#states">All states</a></div></div>'; return; }
  const assoc = {}; Object.values(A.kb.aus).forEach(a => a.assoc.forEach(x => { if (x.state === label) (assoc[x.stream] = assoc[x.stream] || []).push(Object.assign({ au: a.code }, x)); }));
  Object.values(assoc).forEach(L => L.sort((a, b) => (b.present - a.present) || (+a.au - +b.au)));
  const cfgs = A.kb.configs.filter(c => c.state === label).sort((a, b) => b.units - a.units);
  const claims = A.kb.claims.filter(c => c.states.includes(label) && c.named !== false);
  const sy = st.syn, face = stateFace(label), disp = st.display || {};
  const lane = (k, l, txt) => txt ? `<div class="tell"><i aria-hidden="true" style="background:var(--s-${k}-wash, var(--sunk))"><span class="sw ${({ spont: 'spontaneous', posed: 'posed', perc: 'perception' })[k]}"></span></i><div><b>${l}.</b> ${linkIds(txt)}</div></div>` : '';
  const col = s => { const all = (assoc[s] || []), L = all.filter(x => x.present > 0 || x.unrelated + x.inverse > 0), listed = all.filter(x => !(x.present > 0 || x.unrelated + x.inverse > 0) && x.listed); const mxn = Math.max(1, ...L.map(x => x.present));
    return `<div class="stack"><div class="colhead"><i class="sw ${swClass(s)}"></i><h4>${esc({ spontaneous: 'Felt', posed: 'Posed', perception: 'Seen by observers', function: 'Beyond emotion' }[s])}</h4></div>${L.length ? `<div class="small">${L.slice(0, 14).map(x => `<div class="row" style="gap:8px;justify-content:space-between;border-top:1px solid var(--rule);padding:6px 0;flex-wrap:nowrap">${auCode(x.au)} <span class="soft" style="flex:1;min-width:0">${esc(auName(x.au))}</span><i class="bar" style="width:${Math.max(4, 44 * x.present / mxn)}px;background:var(--s-${({ spontaneous: 'spont', posed: 'posed', perception: 'perc', function: 'func' })[s]})"></i><span class="num-t">${x.present}${x.unrelated + x.inverse ? `, ${x.unrelated + x.inverse}○` : ''}</span></div>`).join('')}</div>` : '<div class="none small">No action with a positive or null link.</div>'}${listed.length ? `<p class="tiny muted" style="margin:6px 0 0">Measured without a clear link: ${listed.map(x => auCode(x.au)).join(', ')}.</p>` : ''}</div>`; };
  if (A.v43) return stateV43(main, label, st, { assoc, cfgs, claims, sy, face, disp, col });
  main.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb" style="margin-bottom:12px"><a href="#states">States</a><span aria-hidden="true">/</span><span>${esc(st.cls || 'unclassified')}</span></nav>
    <div class="st-hero"><section class="stage" aria-label="The configuration the evidence best supports"><div class="stage-top"><div class="formula${face.length ? '' : ' rest'}">${face.length ? formulaHTML(face) : 'No configuration'}</div><div class="names">${face.length ? esc(face.map(a => auName(a)).join(', ')) : ''}</div></div><div class="stage-face"><div id="stface"></div></div></section>
      <section class="panel st-side"><div class="st-name">${esc(stateLabel(label))}</div>${disp.gloss ? `<p class="st-def">${esc(disp.gloss)}</p>` : ''}
        ${sy ? `<p class="synth" style="font-size:17px">${linkIds(sy.summary)}</p>${sy.best && sy.best.why ? `<p class="small soft"><b>The face shown:</b> ${linkIds(sy.best.why)}</p>` : ''}` : `<p class="small soft">${pl(st.n, 'coded record')}. Production and perception are kept apart below.</p>`}
        <div class="facts">${dfdCell(label)}<div class="fact"><b>${st.n}</b><span>coded records</span></div><div class="fact"><b>${claims.length}</b><span>verified findings</span></div></div>
        ${face.length > 0 ? `<div class="row"><a class="btn small" href="#combo-${face.join('-')}">Read this face</a></div>` : ''}</section></div>
    ${sy ? `<section class="layer"><div class="section-h"><h2>Posed, felt and seen</h2>${sy.agreement ? `<p>${esc(sy.agreement)}</p>` : ''}</div><div class="tells">${lane('posed', 'Posed', sy.posed)}${lane('spont', 'Felt', sy.spontaneous)}${lane('perc', 'Seen by observers', sy.perception)}</div>${sy.c && sy.c.length ? `<div class="rc" style="margin-top:10px;display:flex;gap:4px;flex-wrap:wrap">${idChips(sy.c)}</div>` : ''}</section>` : ''}
    <section class="layer"><div class="section-h"><h2>Actions reported with ${esc(stateLabel(label))}</h2><p>Independent samples with a positive link; ○ marks samples that looked and did not find one.</p></div><div class="cols">${['spontaneous', 'posed', 'perception', 'function'].map(col).join('')}</div></section>
    ${A.v43 ? (() => { const L = FV.stateItems(label); return L.length ? `<section class="layer" id="relspec"><div class="section-h"><h2>Findings, played on the face</h2><p>Hover or select a finding: the face shows the movements it counted, and each crowd shows how many of 20 people would show them at that rate.</p></div>${FV.listHTML(L, 'fv-state')}</section>` : ''; })() : RS.sectionState(label)}
    <section class="layer"><div class="section-h"><h2>Faces reported with ${esc(stateLabel(label))}</h2><p>Each face is a configuration a study, review or theory reported for this state. Select one to read it.</p></div>${cfgs.length ? cfgFacesHTML(cfgs, null, 12) : '<div class="none">None reported.</div>'}</section>
    ${A.v43 ? '' : `<section class="layer"><div class="section-h"><h2>Verified findings</h2></div>${claims.length ? claimLedger(claims, ['spontaneous', 'posed', 'posed vs spontaneous', 'perception', 'function', 'theory', 'review', 'method'], { n: 6 }) : '<div class="empty">None for this exact term.</div>'}</section>`}</div>`;
  const names = {}; Object.keys(A.kb.aus).forEach(x => { names[x] = shortAU(x); });
  const fm = A.face = FaceMesh.mount($('#stface', main), [], { callouts: true, names, title: label, gap: 21 });
  fm.set(face.filter(a => !NOT_DRAWN.has(a)), null, 900);
  $$('.cface', main).forEach(b => b.onclick = () => go('combo-' + b.dataset.codes.split('+').join('-')));
  if (A.v43) { const box = $('#fv-state', main); if (box) A.mounts.push(FV.play(box, FV.stateItems(label), { title: label })); }
};

/* v4.3 draft: a state shown on the face. Four faces (proposed, posed, felt, seen), every finding played on a live face,
   one movement across the emotions studies coded, with the evidence base below. */
function stateV43(main, label, st, o) {
  const name = stateLabel(label), F = st.faces4, items = FV.stateItems(label);
  const picks = uniq([].concat(F ? [].concat(...FV.MODES.map(([k]) => (F[k] || {}).aus || [])) : o.face).filter(a => +a < 50)).sort((a, b) => +a - +b);
  const hyp = RS.sa().filter(c => c.hypothesized && RD.fam(RS.norm(c.state)) === RD.fam(RS.norm(label))).map(c => FV.protoKey(c.aus));
  const across = FV.acrossHTML(uniq(hyp.concat(picks)), 'fv-across');
  const sec = (id, h, p, body) => body ? `<section class="layer" id="${id}"><div class="section-h"><h2>${h}</h2>${p ? `<p>${p}</p>` : ''}</div>${body}</section>` : '';
  main.innerHTML = `<div class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb" style="margin-bottom:12px"><a href="#states">States</a><span aria-hidden="true">/</span><span>${esc(st.cls || 'unclassified')}</span></nav>
    <section class="st-head43"><div class="st-h-t"><h1 class="st-name">${esc(name)}</h1>${o.disp.gloss ? `<p class="st-def">${esc(o.disp.gloss)}</p>` : ''}
        ${o.sy ? `<p class="synth">${linkIds(o.sy.summary)}</p>` : `<p class="small soft">${pl(st.n, 'coded record')}.</p>`}</div>
      <div class="facts">${dfdCell(label)}<div class="fact"><b>${st.n}</b><span>coded records</span></div><div class="fact"><b>${items.length}</b><span>findings that name movements</span></div>${o.face.length ? `<a class="btn small" href="#combo-${o.face.join('-')}">Read the face AU ${esc(o.face.join(' + '))}</a>` : ''}</div></section>
    ${F ? sec('four', `Four faces of ${esc(name)}`, 'The textbook face researchers proposed, what posers did, what people feeling it showed, and what observers read as it. Hover a face to replay it; hover a bar to show that movement.', FV.fourHTML(label)) : ''}
    ${sec('relspec', 'Findings, played on the face', 'Hover or select a finding: the face shows the movements it counted, and each crowd shows how many of 20 people would show them at that rate.', items.length ? FV.listHTML(items, 'fv-state') : '')}
    ${sec('across', 'One movement across emotions', `How often each movement appeared in every emotion two studies coded. A movement specific to ${esc(name)} is long for it and short everywhere else.`, across)}
    <section class="layer"><div class="section-h"><h2>Actions reported with ${esc(name)}</h2><p>Independent samples with a positive link; ○ marks samples that looked and did not find one.</p></div><div class="cols">${['spontaneous', 'posed', 'perception', 'function'].map(o.col).join('')}</div></section>
    <section class="layer"><div class="section-h"><h2>Faces reported with ${esc(name)}</h2><p>Each face is a configuration a study, review or theory reported for this state. Select one to read it.</p></div>${o.cfgs.length ? cfgFacesHTML(o.cfgs, null, 12) : '<div class="none">None reported.</div>'}</section></div>`;
  if (F) A.mounts.push(...FV.fourPlay($('#four', main), label));
  const box = $('#fv-state', main); if (box) A.mounts.push(FV.play(box, items, { title: name }));
  const ac = FV.acrossPlay($('#fv-across', main), label); if (ac) A.mounts.push(ac);
  $$('.cface', main).forEach(b => b.onclick = () => go('combo-' + b.dataset.codes.split('+').join('-')));
}

VIEWS.map = function (main) {
  const streams = ['posed', 'spontaneous', 'perception', 'function'];
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Where the evidence is</h1>
    <p class="lead">Each cell counts independent samples that link an action to a state. Counts measure research attention and reporting, not how often faces do something, and coding from abstracts misses actions that were measured but not reported.</p></div></section>
    <div class="card row" style="gap:10px 16px">
      <label class="field">Type of study<select id="ms">${streams.map(s => `<option value="${s}">${esc(E.STREAM_LABEL[s])}</option>`).join('')}<option value="all">All four</option></select></label>
      <label class="field">Link<select id="ml"><option value="present">Positive links</option><option value="null">Null or inverse</option></select></label>
      <label class="field">Evidence type<select id="mt"><option value="">All</option>${Object.entries(A.kb.meta.evidenceTypes).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
      <label class="field">Measure<select id="mm"><option value="">All</option>${uniq(A.kb.records.map(r => r.measure)).filter(Boolean).map(m => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label class="field">Sample region<select id="mr"><option value="">All</option>${uniq(A.kb.records.map(r => r.region)).filter(Boolean).map(m => `<option>${esc(m)}</option>`).join('')}</select></label>
      <label class="field">States shown<select id="mn"><option>20</option><option selected>30</option><option>45</option></select></label></div>
    <div id="heat"></div><div id="cellrecs"></div>
    <section class="layer">${layerHead('m', 'Which actions occur together', 'Configurations reported in the literature and, where studies released their AU codes, co-occurrence in those data. The two answer different questions.')}
      <div class="row" style="margin-bottom:8px"><div class="seg" id="coseg"><button data-k="lit" aria-pressed="true">Reported configurations (literature)</button>${SEC.microSets().map(d => `<button data-k="${esc(d.id)}" aria-pressed="false">${esc(d.short || d.cite)}</button>`).join('')}</div></div><div id="co"></div></section></div>`;
  const draw = () => {
    const s = $('#ms', main).value, lk = $('#ml', main).value, t = $('#mt', main).value, me = $('#mm', main).value, rg = $('#mr', main).value, nS = +$('#mn', main).value;
    const recs = A.kb.records.filter(r => (s === 'all' ? streams.includes(r.stream) : r.stream === s) && (!t || r.type === t) && (!me || r.measure === me) && (!rg || r.region === rg) && !E.SKIP_STATES.has(r.state));
    const cell = new Map(); // au|state -> Set(units)
    recs.forEach(r => { const L = lk === 'present' ? (r.links.present || []) : (r.links.unrelated || []).concat(r.links.inverse || [], r.links.absent || []);
      L.forEach(x => { const a = x.replace('*', ''); const k = a + '|' + r.state; if (!cell.has(k)) cell.set(k, { u: new Set(), recs: [] }); cell.get(k).u.add(r.unit); cell.get(k).recs.push(r.id); }); });
    const stTot = new Map(), auTot = new Map();
    cell.forEach((v, k) => { const [a, st] = k.split('|'); stTot.set(st, (stTot.get(st) || 0) + v.u.size); auTot.set(a, (auTot.get(a) || 0) + v.u.size); });
    const states = [...stTot.entries()].sort((a, b) => b[1] - a[1]).slice(0, nS).map(x => x[0]);
    const aus = [...auTot.entries()].filter(([a]) => A.kb.aus[a]).sort((a, b) => +a[0] - +b[0]).map(x => x[0]).filter(a => states.some(st => cell.has(a + '|' + st)));
    if (!states.length) { $('#heat', main).innerHTML = '<div class="empty">No records under these filters.</div>'; return; }
    $('#heat', main).innerHTML = `<div class="tbl-wrap">${chartHeat(aus.map(a => 'AU' + a + ' ' + auName(a)), states, (i, j) => { const c = cell.get(aus[i] + '|' + states[j]); return c ? c.u.size : null; }, { labelW: 190, cellW: 26, cellH: 20, headH: 140, labels: v => v, dec: 0, onCell: true, title: 'Actions by states', tip: (i, j, v) => `<b>${v}</b> independent sample(s)<br>AU${aus[i]} × ${esc(states[j])}<br><span class="k">select to list the records</span>` })}</div>
      <p class="tiny muted">Darker cells hold more samples. Select a cell to list its records.</p>`;
    $('#heat svg', main).addEventListener('click', e => { const g = e.target.closest('[data-cell]'); if (!g) return; const [i, j] = g.dataset.cell.split(',').map(Number); const c = cell.get(aus[i] + '|' + states[j]); if (!c) return;
      $('#cellrecs', main).innerHTML = `<div class="stack" style="margin-top:12px"><h3>AU${esc(aus[i])} × ${esc(states[j])}: ${pl(c.recs.length, 'record')}</h3>${recTable(uniq(c.recs).map(id => A.I.recById.get(id)).filter(Boolean))}</div>`; $('#cellrecs', main).scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  };
  ['#ms', '#ml', '#mt', '#mm', '#mr', '#mn'].forEach(id => $(id, main).onchange = draw); draw();
  const drawCo = async k => {
    const el = $('#co', main);
    if (k === 'lit') {
      const pair = new Map(), deg = new Map();
      A.kb.configs.forEach(c => { if (c.aus.length > 6 || !c.units || !['posed', 'spontaneous', 'perception'].includes(c.stream)) return; for (let i = 0; i < c.aus.length; i++) for (let j = i + 1; j < c.aus.length; j++) { const key = c.aus[i] + '-' + c.aus[j]; pair.set(key, (pair.get(key) || 0) + c.units); } c.aus.forEach(a => deg.set(a, (deg.get(a) || 0) + c.units)); });
      const top = [...pair.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
      const nodesA = uniq(top.flatMap(([k]) => k.split('-'))).sort((a, b) => +a - +b);
      el.innerHTML = chartNetwork(nodesA.map(a => ({ id: a, label: 'AU' + a, href: 'au-' + a, tip: `AU${a} ${auName(a)}` })), top.map(([k, w]) => { const [a, b] = k.split('-'); return { a, b, w, tip: `AU${a} + AU${b}: in reported configurations of ${w} sample(s)` }; }), { w: 600, h: 460, title: 'Actions reported together' }) + '<p class="tiny muted">Pairs of actions that appear together in configurations of up to six actions that primary studies of human posed production, spontaneous production or perception reported as present, weighted by independent samples. Theory, reviews and non-human primates are excluded. This reflects which configurations researchers coded and reported.</p>';
    } else {
      const d = SEC.dataset(k); el.innerHTML = '<div class="muted small">Loading…</div>';
      try { const ds = await SEC.load(k); const codesA = Object.keys(d.auCols).sort((a, b) => +a - +b), cols = codesA.map(a => colOf(ds, d.auCols[a]).values), n = codesA.length, thr = d.activeAt || 0.5;
        const on = Array(n).fill(0), both = Array.from({ length: n }, () => new Float64Array(n));
        for (let r = 0; r < ds.n; r++) for (let i = 0; i < n; i++) if (cols[i][r] >= thr) { on[i]++; for (let j = i + 1; j < n; j++) if (cols[j][r] >= thr) both[i][j]++; }
        const lab = codesA.map(a => 'AU' + a);
        el.innerHTML = chartHeat(lab, lab, (i, j) => { if (i === j) return null; const a = Math.min(i, j), b = Math.max(i, j); const u = on[a] + on[b] - both[a][b]; return u ? both[a][b] / u : 0; }, { labelW: 50, cellW: 24, cellH: 20, headH: 46, title: 'Jaccard co-occurrence', tip: (i, j, v) => `${lab[i]} and ${lab[j]}: Jaccard ${fmt.r(v)}<br>P(${lab[j]} | ${lab[i]}) = ${fmt.r(both[Math.min(i, j)][Math.max(i, j)] / (on[i] || 1))}` }) + `<p class="tiny muted">${typeBadge('SA')} ${SEC.cite(d)}: share of ${fmt.n(ds.n)} ${esc(d.unit)}s in which both actions were coded, relative to those in which either was (Jaccard). AU codes as released by the study.</p>`;
      } catch (e) { el.innerHTML = '<div class="empty">The study-provided data could not be loaded.</div>'; }
    }
  };
  $$('#coseg button', main).forEach(b => b.onclick = () => { $$('#coseg button', main).forEach(x => x.setAttribute('aria-pressed', x === b)); drawCo(b.dataset.k); });
  drawCo('lit');
};

/* ---- app/js/relspec.js ---- */
/* Reliability and specificity (Barrett et al., 2019):
 *   reliability = how often an action appears when the state is present, P(action | state);
 *   specificity = whether it also appears without the state: the rate in the other states a study measured, and the share of the
 *                 action's occurrences that came from this state (which depends on how many instances of each state there were).
 * Sources, never pooled with each other:
 *   A.kb.relspec       estimates from meta-analyses, reviews and primary studies, each with its source, quote and location
 *                      (entries with show === false restate another entry and are kept only for tracing);
 *   A.kb.relspecTrace  widely repeated claims traced to the number they restate, plus the published exchange about them;
 *   A.sec.relspec      secondary analyses of AU data released by studies (secondary/relspec_analysis.py). */
'use strict';
const RS = {
  all() { return (A.kb && A.kb.relspec) || []; },
  /* listed estimates: not restatements, and only those that name the movements they measured (e.named === false: whole-face
   * ratings, emotion-category codes without their movements; kept in the downloads, left out of every list) */
  lit() { return RS.all().filter(e => e.show !== false && e.named !== false); },
  /* the actions an estimate measured, and how they were counted (build/face_named.py) */
  acts(e) { return e.acts && e.acts.length ? e.acts : (e.rel && e.rel.length ? e.rel : (e.aus || [])); },
  trace() { return (A.kb && A.kb.relspecTrace) || { claims: [], debate: [], cfg: {} }; },
  proto(emo) { return (RS.trace().cfg || {})[emo] || null; },
  sa() { return (A.sec && A.sec.relspec && A.sec.relspec.cells) || []; },
  saSets() { return (A.sec && A.sec.relspec && A.sec.relspec.datasets) || []; },
  saSet(id) { return RS.saSets().find(d => d.id === id) || { cite: id }; },
  norm: s => String(s || '').toLowerCase().trim(),
  stateHTML(s) { const k = RS.norm(s); const hit = Object.keys(A.kb.states).find(x => x.toLowerCase() === k); return hit ? stateLink(hit) : esc(k); },
  pct: (x, d) => x == null ? '–' : (100 * x).toFixed(d == null ? 0 : d) + '%',
  units(e) { const u = String(e.unit || '').toLowerCase();
    return u.startsWith('photograph') ? 'poses' : u.startsWith('person (infant') ? 'infants' : u.startsWith('person') ? 'people' : u.startsWith('trial') ? 'trials' : 'instances'; },
  /* which question an estimate answers */
  REL: new Set(['reliability', 'study_share', 'time_share', 'coherence_correlation', 'agreement']),
  SPEC: new Set(['other_state', 'ppv', 'rate']),
  /* the sentence that says what the number is */
  sentence(e) {
    const st = RS.stateHTML(e.state), ex = esc(e.expression || 'the expression');
    if (e.say) return e.say.replace('{state}', st).replace('{expr}', ex).replace('{k}', e.k != null ? fmt.n(e.k) : '');
    switch (e.measure) {
      case 'reliability': return `of ${st} ${RS.units(e)} showed ${ex}`;
      case 'other_state': return `of ${st} ${RS.units(e)} showed ${ex}${e.proposedFor ? `, an expression proposed for ${RS.stateHTML(e.proposedFor)}` : ''}`;
      case 'ppv': return `of the occurrences of ${ex} came from ${st}`;
      case 'rate': return `occurrences of ${ex} per 100 five-second segments of ${st}`;
      case 'time_share': return `of the time in ${st} showed ${ex} (mean across infants)`;
      case 'coherence_correlation': return `correlation between ${ex} and ${st}`;
      case 'agreement': return `of perceivers chose ${st} for ${ex}`;
      default: return `${ex}, ${st}`;
    }
  },
  value(e) {
    if (e.estimate == null) return '–';
    if (e.measure === 'rate') return fmt.n(100 * e.estimate, 0);
    if (e.measure === 'coherence_correlation') return '<i class="r">r</i>' + fmt.r(e.estimate, 2);
    return RS.pct(e.estimate, e.estimate > 0 && e.estimate < 0.095 ? 1 : 0);
  },
  count(e) {
    if (e.measure === 'study_share') return '';
    if (e.kLabel && e.k != null) return `k = ${fmt.n(e.k)} ${esc(e.kLabel)}`;
    if (e.k != null && e.n) return `${fmt.n(e.k)} of ${fmt.n(e.n)}`;
    if (e.n) return `n = ${fmt.n(e.n)}`;
    return '';
  },
  ciText(e) {
    if (!e.ci || e.measure === 'rate') return '';
    return e.measure === 'coherence_correlation' ? `${fmt.r(e.ci[0], 2)} to ${fmt.r(e.ci[1], 2)}` : `${RS.pct(e.ci[0])} to ${RS.pct(e.ci[1])}`;
  },
  link(e, label) {
    const t = esc(label || e.cite);
    return e.doi ? `<a href="https://doi.org/${esc(e.doi)}" target="_blank" rel="noopener">${t}</a>` : e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${t}</a>` : t;
  },
  /* the configuration proposed for an emotion, with one action marked */
  protoChip(emo, focus, L) {
    L = L && L.length ? L : RS.proto(emo); if (!L) return '';
    return `<span class="proto" title="${esc(emo ? 'Face proposed for ' + emo : 'Actions measured')}">${L.map(a => `<i${a === focus ? ' class="on"' : ''}>${esc(a)}</i>`).join('')}</span>`;
  },
  /* the sentence written for this estimate, without the trailing citation (the source is linked beside it) */
  plain(e) { const v = e.v4 || {}; return String(v.sentence || '').replace(/\s*\((?:[^()]|\([^()]*\))*\d{4}[a-z]?(?:[^()]*)\)\.?\s*$/, '.').replace(/\.\.$/, '.'); },
  meter(e) {
    if (e.estimate == null || !['reliability', 'other_state', 'ppv', 'time_share', 'agreement', 'study_share'].includes(e.measure)) return '';
    const w = (100 * Math.max(0, Math.min(1, e.estimate))).toFixed(1);
    return `<i class="rs-m" aria-hidden="true"><s style="width:${w}%"></s>${e.ci && e.measure !== 'rate' ? `<u style="left:${(100 * e.ci[0]).toFixed(1)}%;width:${(100 * (e.ci[1] - e.ci[0])).toFixed(1)}%"></u>` : ''}</i>`;
  },
  rowLit(e, opt) {
    opt = opt || {};
    const cnt = RS.count(e), ci = RS.ciText(e), v = e.v4 || {};
    const chip = opt.focus && RS.acts(e).length > 1 ? ' ' + RS.protoChip(e.cfg, opt.focus, RS.acts(e)) : '';
    const main = v.sentence ? `<div class="rs-l1">${esc(RS.plain(e))}${chip}</div>`
      : `<div>${RS.sentence(e)}${cnt ? ` <span class="muted num-t">(${cnt})</span>` : ''}${chip}</div>${e.subset ? `<div class="muted small">${esc(e.subset)}</div>` : ''}`;
    return `<div class="rs-lit rs-${esc(e.measure)}">
      <div class="rs-lit-n"><span>${RS.value(e)}</span>${RS.meter(e)}${ci ? `<small>${ci}</small>` : ''}</div>
      <div class="rs-lit-t">${main}
        ${e.quote ? `<details><summary class="small">What the source says</summary><blockquote>${esc(e.quote)}</blockquote>${e.location ? `<div class="tiny muted">${esc(e.location)}</div>` : ''}${e.notes ? `<div class="tiny muted" style="margin-top:4px">${esc(e.notes)}</div>` : ''}</details>` : ''}</div>
      <div class="rs-lit-s">${streamTag(e.stream === 'mixed' ? 'other' : e.stream)}${typeBadge(e.type || 'RL')}<div>${RS.link(e)}${e.via ? `<span class="via">cited in ${esc(e.via)}</span>` : ''}</div></div></div>`;
  },
  /* one state x action cell from study-provided data, drawn as paired bars on one 0-100% scale */
  rowSA(c, opt) {
    opt = opt || {};
    const d = RS.saSet(c.dataset), lab = c.aus.length > 1 ? 'AU ' + c.aus.join(' + ') : 'AU' + c.aus[0];
    const unit = d.unit || 'instance';
    const tipR = `${esc(lab)} in ${c.k} of ${c.n} ${esc(unit)}s of ${esc(c.state)}${c.lo != null ? ` (95% CI ${RS.pct(c.lo)} to ${RS.pct(c.hi)})` : ''}`;
    const tipF = `${esc(lab)} in ${c.farK} of ${c.farN} ${esc(unit)}s of the other states: ${esc(c.others.join(', '))}`;
    const ppv = c.ppv == null ? 'never occurred' : `${RS.pct(c.ppv)} of its occurrences were ${esc(RS.norm(c.state))}`;
    const what = opt.label || (opt.byState ? `<b>${esc(lab)}</b>` : `<b>${RS.stateHTML(c.state)}</b>`);
    return `<div class="rs-row${c.hypothesized ? ' hyp-row' : ''}">
      <div class="rs-what">${what}${c.hypothesized ? `<span class="hyp">face proposed for ${esc(RS.norm(c.state))}</span>` : ''}</div>
      <div class="rs-bars">
        <div class="rs-bar rel" data-tip="${tipR}" tabindex="0"><span>with the state</span><i><s style="width:${(100 * (c.rel || 0)).toFixed(1)}%"></s>${c.lo != null ? `<u style="left:${(100 * c.lo).toFixed(1)}%;width:${(100 * (c.hi - c.lo)).toFixed(1)}%"></u>` : ''}</i><b>${RS.pct(c.rel)}</b></div>
        <div class="rs-bar far" data-tip="${tipF}" tabindex="0"><span>in other states</span><i><s style="width:${(100 * (c.far || 0)).toFixed(1)}%"></s></i><b>${RS.pct(c.far)}</b></div>
      </div>
      <div class="rs-ppv">${ppv}<small>${c.base != null ? `${RS.pct(c.base)} expected if unrelated` : ''}</small></div></div>`;
  },
  /* study-provided cells as a dumbbell chart: the filled dot is the rate with the state, the hollow dot the rate in the
   * other states the study measured; the bar between them is the gap, dark when the action is commoner with the state */
  dumbbell(L, opt) {
    opt = opt || {};
    if (!L.length) return '';
    if (A.v43) return FV.rowsPlain(L.map(FV.itemCell), opt.n || 6);
    const pos = x => (100 * Math.max(0, Math.min(1, x || 0))).toFixed(1) + '%';
    const row = c => {
      const d = RS.saSet(c.dataset), unit = d.unit || 'instance', code = c.aus.length > 1 ? 'AU ' + c.aus.join(' + ') : 'AU' + c.aus[0];
      const lab = opt.label ? opt.label(c) : `<b>${esc(code)}</b>`;
      const tip = `<b>${esc(code)}</b> with ${esc(RS.norm(c.state))}: ${c.k} of ${c.n} ${esc(unit)}s (${RS.pct(c.rel)})${c.lo != null ? `, 95% interval ${RS.pct(c.lo)} to ${RS.pct(c.hi)}` : ''}<br>in the other states: ${c.farK} of ${c.farN} (${RS.pct(c.far)})${c.ppv != null ? `<br>${RS.pct(c.ppv)} of its occurrences were ${esc(RS.norm(c.state))}; ${RS.pct(c.base)} expected if unrelated` : ''}`;
      const lo = Math.min(c.rel || 0, c.far || 0), hi = Math.max(c.rel || 0, c.far || 0), up = (c.rel || 0) >= (c.far || 0);
      return `<div class="db-r${c.hypothesized ? ' is-hyp' : ''}" data-tip="${esc(tip)}" tabindex="0"><div class="db-l">${lab}${c.hypothesized ? `<span class="hyp">face proposed for ${esc(RS.norm(c.state))}</span>` : ''}</div>
        <div class="db-t"><i class="db-g${up ? ' up' : ''}" style="left:${pos(lo)};width:calc(${pos(hi)} - ${pos(lo)})"></i>${c.lo != null ? `<i class="db-ci" style="left:${pos(c.lo)};width:calc(${pos(c.hi)} - ${pos(c.lo)})"></i>` : ''}<i class="db-far" style="left:${pos(c.far)}"></i><i class="db-rel" style="left:${pos(c.rel)}"></i></div>
        <div class="db-v"><b>${RS.pct(c.rel)}</b><span>${RS.pct(c.far)}</span></div>
        <div class="db-p">${c.ppv == null ? '<span class="none">never</span>' : `<b>${RS.pct(c.ppv)}</b><small>vs ${RS.pct(c.base)}</small>`}</div></div>`;
    };
    const head = `<div class="db-r db-h" aria-hidden="true"><div class="db-l"></div><div class="db-t db-ax">${[0, 25, 50, 75, 100].map(v => `<span style="left:${v}%">${v}%</span>`).join('')}</div><div class="db-v"><b>with</b><span>other</span></div><div class="db-p"><small>share of its occurrences</small></div></div>`;
    return `<div class="db">${head}${moreList(L, opt.n || 6, row, opt.more || 'More')}</div>`;
  },
  dbKey() { return `<div class="rs-key db-key"><span><i class="kd rel"></i>with the state</span><span><i class="kd far"></i>in the other states the study measured</span><span><i class="k ci"></i>95% interval</span><span><b>vs</b> share expected if unrelated</span></div>`; },
  /* a dataset's header: who, what kind of study, and its design on demand */
  setHead(d) { return `<div class="rs-set-h">${streamTag(d.stream)}<b>${d.doi ? `<a href="https://doi.org/${esc(d.doi)}" target="_blank" rel="noopener">${esc(d.cite)}</a>` : esc(d.cite)}</b>${typeBadge('SA')}${d.design || d.caveat ? `<details class="rs-about"><summary>About the data</summary><p>${esc(d.design || '')}</p>${d.caveat ? `<p class="muted">${esc(d.caveat)}</p>` : ''}</details>` : ''}</div>`; },
  explainHTML() {
    return `<div class="rs-key"><span><i class="kp" style="background:var(--s-spont)"></i>felt</span><span><i class="kp" style="background:var(--s-posed)"></i>posed</span><span><i class="kp" style="background:var(--s-perc)"></i>seen by observers</span><span><i class="k ci2"></i>95% interval</span><span class="soft">Select a row for the source's words.</span>
      <details class="rs-def"><summary>Reliability and specificity</summary><p><b>Reliability</b> is how often the action appears when the state is present. <b>Specificity</b> is whether it also appears without the state: a specific action rarely shows up in other states, so most of its occurrences come from the one state.</p></details></div>`;
  },
  /* sort: what the number measures, then how far it summarizes (meta-analysis, systematic review, study, narrative review), then size */
  order: { reliability: 0, study_share: 0, time_share: 1, agreement: 1, coherence_correlation: 2, ppv: 0, other_state: 1, rate: 2, other: 6 },
  kindRank: { 'meta-analysis': 0, 'systematic review': 1, review: 3, study: 2 },
  rank: e => e.meta ? (RS.kindRank[e.kind] != null ? RS.kindRank[e.kind] : 2) : 2,
  sortLit: L => L.slice().sort((a, b) => (RS.order[a.measure] == null ? 9 : RS.order[a.measure]) - (RS.order[b.measure] == null ? 9 : RS.order[b.measure])
    || RS.rank(a) - RS.rank(b) || (a.role === 'main' || !a.role ? 0 : 1) - (b.role === 'main' || !b.role ? 0 : 1) || (b.estimate || 0) - (a.estimate || 0)),
  litBlock(L, n, opt) { return A.v43 ? FV.rowsPlain(FV.sortItems(L.map(FV.itemEstimate)), n || 6) : RS.forest(L, Object.assign({ n: n || 6 }, opt || {})); },
  /* estimates as a forest plot: one row per estimate on a shared axis (shares 0 to 100%, correlations -1 to 1, rates per
   * 100 segments); the dot is coloured by type of study, the line is the 95% interval; a row opens to its sentence and quote */
  AXIS: e => e.measure === 'coherence_correlation' ? 'r' : e.measure === 'rate' ? 'rate' : 'p',
  forest(L, opt) {
    opt = opt || {};
    return ['p', 'r', 'rate'].map(ax => [ax, L.filter(e => RS.AXIS(e) === ax)]).filter(g => g[1].length).map(([ax, M]) => {
      const sc = ax === 'r' ? (x => 50 + 50 * Math.max(-1, Math.min(1, x))) : (x => 100 * Math.max(0, Math.min(1, x)));
      const ticks = ax === 'r' ? [-1, -0.5, 0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
      const tl = v => ax === 'r' ? (v === 0 ? '0' : (v < 0 ? '\u2212' : '') + fmt.r(Math.abs(v), 1)) : ax === 'rate' ? String(Math.round(v * 100)) : Math.round(v * 100) + '%';
      const head = `<div class="fr-h" aria-hidden="true"><span>${ax === 'r' ? 'correlation' : ax === 'rate' ? 'per 100 five-second segments' : ''}</span><div class="fr-ax${ax === 'r' ? ' r' : ''}">${ticks.map(v => `<span style="left:${sc(v)}%">${tl(v)}</span>`).join('')}</div><span></span></div>`;
      const row = e => {
        const v = e.v4 || {}, x = sc(e.estimate || 0), ci = e.ci && ax !== 'rate' ? [sc(e.ci[0]), sc(e.ci[1])] : null, col = RD.COL[e.stream] || 'var(--ink-2)';
        const said = v.sentence ? RS.plain(e) : '';
        return `<details class="fr"><summary><span class="fr-l"><span class="t">${said ? esc(said) : esc(v.label || e.subset || e.state)}${opt.focus && RS.acts(e).length > 1 ? ' ' + RS.protoChip(e.cfg, opt.focus, RS.acts(e)) : ''}</span><span class="s"><i class="sw ${swClass(e.stream)}"></i>${esc(e.cite)}${e.via ? `, in ${esc(e.via)}` : ''}</span></span>
          <span class="fr-t${ax === 'r' ? ' r' : ''}">${ci ? `<i class="ci" style="left:${ci[0].toFixed(1)}%;width:${(ci[1] - ci[0]).toFixed(1)}%"></i>` : ''}<i class="pt" style="left:${x.toFixed(1)}%;background:${col}"></i></span>
          <span class="fr-v"><span>${RS.value(e)}</span>${ci ? `<small>${RS.ciText(e)}</small>` : ''}</span></summary>
          <div class="fr-more">${said ? '' : `<p class="fr-s">${RS.sentence(e)}</p>`}${e.quote ? `<blockquote>${esc(e.quote)}</blockquote>` : ''}
            <div class="fr-src">${streamTag(e.stream === 'mixed' ? 'other' : e.stream)}${typeBadge(e.type || 'RL')}<span>${RS.link(e)}${e.location ? `, ${esc(e.location)}` : ''}</span></div>${e.notes ? `<p class="tiny muted">${esc(String(e.notes).replace(/hypothesi[sz]ed/gi, 'proposed').replace(/\bprototype\b/gi, 'proposed configuration'))}</p>` : ''}</div></details>`;
      };
      return `<div class="forest">${head}${moreList(RS.sortLit(M), opt.n || 6, row, opt.more || 'More estimates')}</div>`;
    }).join('');
  },
  /* two questions side by side: with the state, and without it */
  twoCol(L, opt) {
    opt = opt || {};
    const rel = L.filter(e => RS.REL.has(e.measure)), spec = L.filter(e => RS.SPEC.has(e.measure));
    const col = (h, sub, M, empty) => `<div class="rs-col"><h3>${h}</h3><p class="block-sub">${sub}</p>${M.length ? RS.litBlock(M, opt.n || 4, opt) : `<div class="empty small">${empty}</div>`}</div>`;
    return `<div class="rs-two">${col('With the state', opt.relSub || 'How often the state came with the action.', rel, 'No estimate.')}${col('Without the state', opt.specSub || 'How often the action came without the state.', spec, 'No published estimate of how often it appears without the state.')}</div>`;
  },
  /* one-line summary for the composer readout: the most informative estimate for exactly these actions */
  quick(codes) {
    const key = codes.slice().sort((a, b) => +a - +b).join('+');
    const same = r => (r.aus || []).length && r.aus.slice().sort((a, b) => +a - +b).join('+') === key;
    const lit = RS.lit().filter(r => same(r) && r.estimate != null && r.role !== 'moderator' && r.role !== 'bias' && ['reliability', 'other_state'].includes(r.measure))
      .sort((a, b) => (RS.kindRank[a.kind] != null ? RS.kindRank[a.kind] : 5) - (RS.kindRank[b.kind] != null ? RS.kindRank[b.kind] : 5) || (a.stream === 'spontaneous' ? -1 : 0) - (b.stream === 'spontaneous' ? -1 : 0))[0];
    if (lit) return { big: RS.value(lit), text: RS.sentence(lit), src: esc(lit.cite) };
    const cells = RS.sa().filter(c => same(c) && c.rel != null && (codes.length > 1 ? c.hypothesized : true));
    const pick = cells.filter(c => c.dataset === 'scherer2019').sort((a, b) => b.rel - a.rel)[0] || cells.sort((a, b) => b.rel - a.rel)[0];
    if (!pick) return null;
    const d = RS.saSet(pick.dataset), u = d.unit === 'actor' ? 'enactments' : d.unit + 's';
    return { big: RS.pct(pick.rel), text: `of ${esc(RS.norm(pick.state))} ${esc(u)} showed ${codes.length > 1 ? 'the full configuration' : 'AU' + codes[0]}; ${RS.pct(pick.far)} of the other ${esc(u)} did`,
      src: `${esc(d.cite)}, posed${d.id === 'wsefep' ? ' photographs chosen for these actions' : ''}` };
  },

  /* ---------------- traced claims ---------------- */
  claimsFor(code, state) { return (RS.trace().claims || []).filter(c => (code && c.focus === code) || (state && RS.norm(c.state) === RS.norm(state))); },
  scale(c) {
    const pos = x => (100 * x).toFixed(1) + '%';
    return `<div class="tr-scale" role="img" aria-label="${esc(RS.pct(c.value))}, 95% interval ${esc(RS.pct(c.ci[0]))} to ${esc(RS.pct(c.ci[1]))}">
      <i class="tr-track"></i><i class="tr-ci" style="left:${pos(c.ci[0])};width:${pos(c.ci[1] - c.ci[0])}"></i><i class="tr-pt" style="left:${pos(c.value)}"></i>
      <span class="tr-t" style="left:0">0</span><span class="tr-t" style="left:${pos(c.ci[0])}">${RS.pct(c.ci[0])}</span><span class="tr-t" style="left:${pos(c.ci[1])}">${RS.pct(c.ci[1])}</span><span class="tr-t end" style="left:100%">100%</span></div>`;
  },
  waffle(p) {
    const tp = p.match - p.fp, cols = 40, cell = 9, gap = 3, rows = Math.ceil(p.match / cols);
    let s = '';
    for (let i = 0; i < p.match; i++) {
      const x = (i % cols) * (cell + gap), y = Math.floor(i / cols) * (cell + gap);
      s += i < tp ? `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="1.5" class="w-on"/>` : `<rect x="${x + 0.75}" y="${y + 0.75}" width="${cell - 1.5}" height="${cell - 1.5}" rx="1.5" class="w-off"/>`;
    }
    return `<svg class="waffle" viewBox="0 0 ${cols * (cell + gap) - gap} ${rows * (cell + gap) - gap}" role="img" aria-label="${p.match} poses matched the configuration: ${p.fp} came from scenarios rated low on anger and high on another emotion; the other ${tp} did not">${s}</svg>`;
  },
  chainHTML(c) {
    return `<ol class="tr-chain">${(c.chain || []).map(x => `<li class="${x.source ? 'is-src' : ''}">
      <span class="tr-yr">${esc(x.year)}</span>
      <div class="tr-node"><div class="tr-who">${x.doi ? `<a href="https://doi.org/${esc(x.doi)}" target="_blank" rel="noopener">${esc(x.who)}</a>` : x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.who)}</a>` : esc(x.who)}<span>${esc(x.where)}</span>${x.source ? '<em>Source of the number</em>' : ''}</div>
        <blockquote>${esc(x.quote)}</blockquote>${x.note ? `<p>${esc(x.note)}</p>` : ''}</div></li>`).join('')}</ol>`;
  },
  numHTML(c) {
    const src = (c.chain || []).find(x => x.source) || {};
    if (c.kind === 'specificity') {
      const p = c.poses.all, tp = p.match - p.fp;
      return `<div class="tr-num" data-claim="${esc(c.id)}">
        <div class="tr-big"><b data-v>${RS.pct(tp / p.match)}</b><span data-cap>of ${fmt.n(p.match)} poses matching the anger configuration did not come from scenarios rated low on anger and high on another emotion</span></div>
        <div class="tr-wf" data-wf>${RS.waffle(p)}</div>
        <div class="tr-key"><span><i class="w-on"></i><b data-tp>${fmt.n(tp)}</b> other matching poses</span><span><i class="w-off"></i><b data-fp>${fmt.n(p.fp)}</b> from scenarios rated low on anger and high on another emotion</span></div>
        <div class="seg" role="group" aria-label="Scenarios">${Object.entries(c.poses).map(([k, v], i) => `<button type="button" data-set="${esc(k)}" aria-pressed="${i === 0}">${esc(v.label)}</button>`).join('')}</div>
        <p class="tr-cite">${esc(src.who || '')}, ${esc(src.where || '')}</p></div>`;
    }
    return `<div class="tr-num"><div class="tr-big"><b>${RS.pct(c.value)}</b><span>average share of people who showed the face proposed for anger, whole or in part, when anger was elicited</span></div>
      ${c.ci ? RS.scale(c) : ''}<p class="tr-cite">95% interval, ${fmt.n(c.k)} ${esc(c.kLabel || 'effect sizes')}. ${esc(src.who || '')}, ${esc(src.where || '')}</p></div>`;
  },
  claimCard(c, opt) {
    opt = opt || {};
    const head = `<div class="tr-head"><span class="tr-kind tr-${esc(c.kind)}">${c.kind === 'specificity' ? 'Specificity' : 'Reliability'}</span><blockquote class="tr-claim">${esc(c.claim)}</blockquote></div>`;
    if (opt.compact) return `<article class="trace compact">${head}<div class="tr-body">${RS.numHTML(c)}<div class="tr-what"><h4>What the number counts</h4><p>${esc(c.counts)}</p>
      <p><a class="btn ghost small" href="#reliability-${esc(c.id)}">Trace the claim to its source</a></p></div></div></article>`;
    return `<article class="trace" id="rs-${esc(c.id)}">${head}<div class="tr-body">${RS.numHTML(c)}
      <div class="tr-what"><h4>What the number counts</h4><p>${esc(c.counts)}</p><h4>How the claim differs from the source</h4><ul>${c.differs.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <div class="tr-trail"><h4>How the number travelled</h4>${RS.chainHTML(c)}</div></article>`;
  },
  wireClaims(root) {
    $$('.tr-num[data-claim]', root).forEach(box => {
      const c = (RS.trace().claims || []).find(x => x.id === box.dataset.claim); if (!c || !c.poses) return;
      $$('.seg button', box).forEach(b => b.onclick = () => {
        const p = c.poses[b.dataset.set], tp = p.match - p.fp;
        $$('.seg button', box).forEach(x => x.setAttribute('aria-pressed', x === b));
        $('[data-wf]', box).innerHTML = RS.waffle(p);
        $('[data-v]', box).textContent = RS.pct(tp / p.match);
        $('[data-cap]', box).textContent = `of ${fmt.n(p.match)} poses matching the anger configuration did not come from scenarios rated low on anger and high on another emotion`;
        $('[data-tp]', box).textContent = fmt.n(tp); $('[data-fp]', box).textContent = fmt.n(p.fp);
      });
    });
  },
  debateHTML() {
    const D = RS.trace().debate || []; if (!D.length) return '';
    return `<div class="tr-debate"><div class="section-h"><h3>Is a 35% co-occurrence weak or strong?</h3><p>Reliability says how often the expression appears with the emotion. Whether that is weak depends on what it is compared with, and the meta-analysis drew a published exchange.</p></div>
      <div class="tr-sides">${D.map(d => `<figure><blockquote>${esc(d.quote)}</blockquote><figcaption><a href="https://doi.org/${esc(d.doi)}" target="_blank" rel="noopener">${esc(d.who)}</a>, ${esc(d.title)}. <span class="muted">${esc(d.location)}</span></figcaption></figure>`).join('')}</div></div>`;
  },

  /* ---------------- the meta-analysis of co-occurrence (Durán & Fernández-Dols, 2021) ---------------- */
  dfd() { return RS.lit().filter(e => e.ma); },
  dfdChart() {
    const L = RS.dfd(), main = L.filter(e => e.role === 'main');
    if (!main.length) return '';
    const get = (ma, st) => main.find(e => e.ma === ma && RS.norm(e.state) === st);
    const emos = ['happiness', 'surprise', 'disgust', 'sadness', 'anger', 'fear'].sort((a, b) => ((get('MA2', b) || {}).estimate || 0) - ((get('MA2', a) || {}).estimate || 0));
    const pos = x => (100 * Math.max(0, Math.min(1, x))).toFixed(1) + '%';
    const lane = (e, cls) => e ? `<div class="mx-lane ${cls}" data-tip="${esc(`${e.ma === 'MA1' ? 'Whole expression' : e.ma === 'AMU' ? 'Smile or laughter' : 'Whole or in part'}: ${RS.pct(e.estimate)} (95% interval ${RS.ciText(e)}), ${e.k != null ? e.k + ' effect sizes' : 'k not stated'}`)}" tabindex="0">
        ${e.ci ? `<i class="mx-ci" style="left:${pos(e.ci[0])};width:calc(${pos(e.ci[1])} - ${pos(e.ci[0])})"></i>` : ''}<i class="mx-pt" style="left:${pos(e.estimate)}"></i></div>`
      : `<div class="mx-lane ${cls} none"><span>no data</span></div>`;
    const row = (label, a, b, note) => `<div class="mx-row"><div class="mx-lab">${label}${note ? `<small>${note}</small>` : ''}</div>
      <div class="mx-plot">${lane(a, 'whole')}${lane(b, 'part')}</div>
      <div class="mx-val"><span class="whole">${a ? RS.pct(a.estimate) : '–'}</span><span class="part">${b ? RS.pct(b.estimate) : '–'}</span></div></div>`;
    const amu = main.find(e => e.ma === 'AMU' && e.measure === 'reliability');
    return `<div class="mx" role="group" aria-label="Share of people who showed the face proposed for each emotion">
      <div class="mx-key"><span><i class="k whole"></i>Whole expression (meta-analysis 1, FACS)</span><span><i class="k part"></i>Whole or in part (meta-analysis 2)</span><span><i class="k ci"></i>95% interval</span><span>k: effect sizes in each</span></div>
      <div class="mx-axis"><span></span><div>${[0, 25, 50, 75, 100].map(v => `<i style="left:${v}%"${v % 50 ? ' class="minor"' : ''}>${v}%</i>`).join('')}</div><span></span></div>
      ${emos.map(s => { const a = get('MA1', s), b = get('MA2', s), L = RS.acts(b || a || {});
        return row(RS.stateHTML(s), a, b, `${L.length ? `<b class="mx-au">AU ${L.map(esc).join(' + ')}</b>` : ''}k = ${[a, b].map(e => e && e.k != null ? e.k : '0').join(' and ')}`); }).join('')}
      ${row('<b>All six</b>', get('MA1', 'six emotions (pooled)'), get('MA2', 'six emotions (pooled)'), 'meta-analysis 1 had data for three')}
      ${amu ? `<div class="mx-row amu"><div class="mx-lab">${RS.stateHTML('amusement')}<small>smile or laughter, analysed separately</small></div><div class="mx-plot">${lane(null, 'whole skip')}${lane(amu, 'part')}</div><div class="mx-val"><span class="whole"></span><span class="part">${RS.pct(amu.estimate)}</span></div></div>` : ''}
    </div>`;
  },
  dfdCorr() {
    const L = RS.dfd().filter(e => e.ma === 'MA3' && e.role === 'main');
    if (!L.length) return '';
    const order = L.slice().sort((a, b) => (/pooled/.test(a.state) ? 1 : 0) - (/pooled/.test(b.state) ? 1 : 0) || b.estimate - a.estimate);
    const pos = r => (50 + 50 * Math.max(-1, Math.min(1, r))).toFixed(1) + '%';
    return `<div class="mx corr" role="group" aria-label="Correlation between reported emotion intensity and expression intensity">
      <div class="mx-axis"><span></span><div>${[-1, -0.5, 0, 0.5, 1].map(v => `<i style="left:${50 + 50 * v}%"${v % 1 ? ' class="minor"' : ''}>${v === 0 ? '0' : (v < 0 ? '\u2212' : '') + fmt.r(Math.abs(v), 1)}</i>`).join('')}</div><span></span></div>
      ${order.map(e => `<div class="mx-row"><div class="mx-lab">${/pooled/.test(e.state) ? '<b>All six</b>' : RS.stateHTML(e.state)}<small>${RS.acts(e).length ? `<b class="mx-au">AU ${RS.acts(e).map(esc).join(' + ')}</b>` : ''}k = ${e.k}</small></div>
        <div class="mx-plot"><i class="mx-zero"></i><div class="mx-lane part" data-tip="${esc(`r = ${fmt.r(e.estimate, 2)} (95% interval ${RS.ciText(e)}), ${e.k} effect sizes`)}" tabindex="0">${e.ci ? `<i class="mx-ci" style="left:${pos(e.ci[0])};width:calc(${pos(e.ci[1])} - ${pos(e.ci[0])})"></i>` : ''}<i class="mx-pt" style="left:${pos(e.estimate)}"></i></div></div>
        <div class="mx-val"><span class="part">${fmt.r(e.estimate, 2)}</span></div></div>`).join('')}</div>`;
  },
  dfdMods() {
    const L = RS.dfd().filter(e => e.role === 'moderator' || e.role === 'bias');
    const tbl = (ma, title) => { const M = L.filter(e => e.ma === ma); if (!M.length) return '';
      return `<div><h4>${title}</h4><table class="tbl"><thead><tr><th>Subgroup</th><th>Estimate</th><th>95% interval</th><th>k</th></tr></thead><tbody>${M.map(e => `<tr><td>${esc((e.mod || (e.role === 'bias' ? 'corrected for small-study bias (trim and fill)' : '')).replace(/^./, x => x.toUpperCase()))}</td><td class="num">${e.measure === 'coherence_correlation' ? fmt.r(e.estimate, 2) : RS.pct(e.estimate)}</td><td class="num">${RS.ciText(e)}</td><td class="num">${e.k != null ? e.k : '–'}</td></tr>`).join('')}</tbody></table></div>`; };
    return `<div class="grid2 mods">${tbl('MA2', 'Share showing the expression, whole or in part')}${tbl('MA3', 'Correlation of intensities')}${tbl('MA1', 'Share showing the whole expression (happiness, surprise and disgust)')}</div>`;
  },

  /* ---------------- sections on other pages ---------------- */
  sectionAU(code) {
    const lit = RS.lit().filter(r => RS.acts(r).includes(code) && r.role !== 'moderator' && r.role !== 'bias' && r.stream !== 'perception');
    const cells = RS.sa().filter(c => c.aus.length === 1 && c.aus[0] === code && (c.rel >= 0.1 || c.far >= 0.1));
    const claims = RS.claimsFor(code);
    const sets = uniq(cells.map(c => c.dataset));
    if (!lit.length && !cells.length && !claims.length) return `${RS.explainHTML()}<div class="empty">No reliability or specificity estimate for AU${esc(code)} yet. The <a href="#reliability">overview</a> lists estimates for configurations.</div>`;
    return `${claims.length ? `<div class="tr-pair">${claims.map(c => RS.claimCard(c, { compact: true })).join('')}</div>` : ''}${RS.explainHTML()}
      ${lit.length ? `<h3 class="rs-h">Estimates from the literature</h3><p class="block-sub">Estimates for AU${esc(code)} alone, and for proposed faces that include it (the action is marked in each face).</p>${RS.twoCol(lit, { focus: code })}` : ''}
      ${cells.length ? `<h3 class="rs-h">In AU data released by studies ${typeBadge('SA')}</h3><p class="block-sub">Computed here from the studies' own AU codes. Each study keeps its design; nothing is pooled.</p>
        ${RS.dbKey()}${sets.map(id => { const d = RS.saSet(id), L = cells.filter(c => c.dataset === id).sort((a, b) => b.rel - a.rel);
          return `<div class="rs-set">${RS.setHead(d)}${RS.dumbbell(L, { n: 6, more: 'More states', label: c => `<b>${RS.stateHTML(c.state)}</b>` })}</div>`; }).join('')}` : ''}`;
  },
  sectionState(label) {
    const k = RS.norm(label);
    const lit = RS.lit().filter(r => (RS.norm(r.state) === k || RS.norm(r.proposedFor) === k) && r.role !== 'moderator' && r.role !== 'bias');
    const cells = RS.sa().filter(c => RS.norm(c.state) === k && (c.rel >= 0.15 || c.hypothesized));
    const claims = RS.claimsFor(null, label);
    if (!lit.length && !cells.length && !claims.length) return '';
    const sets = uniq(cells.map(c => c.dataset));
    return `<section class="layer" id="relspec"><div class="section-h"><h2>How often</h2><p>How often each face appears with ${esc(k)}, and how often without it.</p></div>
      ${claims.length ? `<div class="tr-pair">${claims.map(c => RS.claimCard(c, { compact: true })).join('')}</div>` : ''}${RS.explainHTML()}
      ${lit.length ? `<h3 class="rs-h">Estimates from the literature</h3>${RS.twoCol(lit, { n: 5, relSub: `How often ${esc(k)} came with the expression.`, specSub: `How often the expression came without ${esc(k)}, or what share of it came from ${esc(k)}.` })}` : ''}
      ${sets.length ? `<h3 class="rs-h">In AU data released by studies</h3>${RS.dbKey()}` : ''}${sets.map(id => { const d = RS.saSet(id), L = cells.filter(c => c.dataset === id).sort((a, b) => (b.hypothesized ? 1 : 0) - (a.hypothesized ? 1 : 0) || b.rel - a.rel);
        return `<div class="rs-set">${RS.setHead(d)}${RS.dumbbell(L, { n: 6, more: 'More actions', label: c => `<b>${esc(c.aus.length > 1 ? 'AU ' + c.aus.join(' + ') : 'AU' + c.aus[0])}</b>${c.aus.length === 1 ? `<span class="soft">${esc(shortAU(c.aus[0]))}</span>` : ''}` })}</div>`; }).join('')}</section>`;
  },
  sectionCombo(codes) {
    const key = codes.slice().sort((a, b) => +a - +b).join('+');
    const lit = RS.lit().filter(r => (r.aus || []).length > 1 && r.aus.slice().sort((a, b) => +a - +b).join('+') === key && r.role !== 'moderator' && r.role !== 'bias');
    const cells = RS.sa().filter(c => c.aus.length > 1 && c.aus.slice().sort((a, b) => +a - +b).join('+') === key);
    if (!lit.length && !cells.length) return '';
    return `<section class="layer" id="relspec">${layerHead('a', 'Reliability and specificity', 'How often this configuration appeared with the state it was proposed for, and how often it appeared without it.')}${RS.explainHTML()}
      ${lit.length ? RS.litBlock(lit, 6) : ''}
      ${cells.map(c => { const d = RS.saSet(c.dataset); return `<div class="rs-set"><div class="rs-set-h">${streamTag(d.stream)}<b>${esc(d.cite)}</b>${typeBadge('SA')}</div>${RS.rowSA(c)}<p class="tiny muted">${esc(d.caveat || '')}</p></div>`; }).join('')}</section>`;
  },
  /* estimates for exactly these actions, for a combination's page (no heading) */
  comboRows(codes) {
    const key = codes.slice().sort((a, b) => +a - +b).join('+'), K = L => (L || []).slice().sort((a, b) => +a - +b).join('+');
    const lit = RS.lit().filter(r => K(RS.acts(r)) === key && r.role !== 'moderator' && r.role !== 'bias' && r.estimate != null && r.stream !== 'perception');
    const cells = RS.sa().filter(c => K(c.aus) === key && c.rel != null && (codes.length > 1 || c.rel >= 0.1)).sort((a, b) => (b.hypothesized ? 1 : 0) - (a.hypothesized ? 1 : 0) || b.rel - a.rel);
    if (!lit.length && !cells.length) return '';
    return `<div class="rs-compact">${lit.length ? RS.litBlock(lit, 4) : ''}${cells.length ? `<div class="rs-sa">${RS.dumbbell(cells, { n: lit.length ? 3 : 5, more: 'More states', label: c => `<b>${RS.stateHTML(c.state)}</b><span class="soft">${esc(RS.saSet(c.dataset).cite)}</span>` })}${RS.dbKey()}</div>` : ''}</div>`;
  },
  /* Le Mau et al. (2021): how often poses matched the configuration proposed for their category, and how many matching poses came from it */
  configChart(L) {
    const cats = uniq(L.map(e => e.state));
    const get = (c, m, sub) => L.find(e => e.state === c && e.measure === m && (!sub || (e.subset || '').startsWith(sub)));
    const rows = cats.map(c => ({ c, r: get(c, 'reliability', 'pose match'), p: get(c, 'ppv', 'all 604') })).filter(x => x.r).sort((a, b) => (b.r.estimate || 0) - (a.r.estimate || 0));
    return `<div class="rs-cfg">${rows.map(x => `<div class="rs-row">
      <div class="rs-what"><b>${RS.stateHTML(x.c)}</b><span class="muted small">${x.r.k} of ${x.r.n} poses</span></div>
      <div class="rs-bars">
        <div class="rs-bar rel" data-tip="${esc(x.r.k + ' of ' + x.r.n + ' ' + x.c + ' poses matched the proposed configuration')}" tabindex="0"><span>matched the proposal</span><i><s style="width:${(100 * (x.r.estimate || 0)).toFixed(1)}%"></s>${x.r.ci ? `<u style="left:${(100 * x.r.ci[0]).toFixed(1)}%;width:${(100 * (x.r.ci[1] - x.r.ci[0])).toFixed(1)}%"></u>` : ''}</i><b>${RS.pct(x.r.estimate)}</b></div>
        ${x.p ? `<div class="rs-bar ppv" data-tip="${esc(x.p.k + ' of ' + x.p.n + ' poses matching the configuration did not come from scenarios rated low on ' + x.c + ' and high on another emotion')}" tabindex="0"><span>not false positives</span><i><s style="width:${(100 * (x.p.estimate || 0)).toFixed(1)}%"></s></i><b>${RS.pct(x.p.estimate)}</b></div>` : ''}
      </div>
      <div class="rs-ppv">${x.p ? `${RS.pct(1 - x.p.estimate)} of the matching poses were false positives: scenarios rated low on ${esc(x.c)}, high on another emotion` : 'no specificity estimate'}<small>${esc(x.r.subset || '')}</small></div></div>`).join('')}</div>`;
  }
};

/* overview of reliability and specificity */
VIEWS.reliability = function (main, r) {
  const lit = RS.lit(), sa = RS.sa(), T = RS.trace();
  const lemau = lit.filter(e => e.src === 'lemau2021');
  const prim = lit.filter(e => !e.meta && e.src !== 'lemau2021' && e.stream === 'spontaneous');
  const groups = [
    ['surprise', 'Surprise', 'The surprise display (brow raising, eye widening, mouth opening) when people were surprised in experiments.', prim.filter(e => ['reisenzein2006', 'schutzwohl2012'].includes(e.src))],
    ['smiles', 'Smiles', 'Smiling with and without cheek raising in amusement, embarrassment, pain, frustration and after winning or losing.', prim.filter(e => ['keltner1995', 'kunz2013smile', 'hoque2012', 'mui2017'].includes(e.src))],
    ['infants', 'Infants', 'Smiling (AU12), cry-faces measured by lip stretching (AU20), and eye constriction (AU6) within each, in play with a parent, during a parent\'s still face, and after a vaccination.', prim.filter(e => ['bennett2002', 'mattson2013'].includes(e.src))]
  ].filter(g => g[3].length);
  const review = lit.filter(e => e.kind === 'review'), pain = lit.filter(e => e.kind === 'systematic review'), kunz13 = prim.filter(e => e.src === 'kunz2013');
  const field = lit.filter(e => e.meta && e.kind === 'study' && e.stream !== 'perception'), perc = lit.filter(e => e.stream === 'perception');
  const hypo = sa.filter(c => c.hypothesized);
  const sch = sa.filter(c => c.dataset === 'scherer2019');
  const schAU = uniq(sch.map(c => c.aus[0])).map(a => { const L = sch.filter(c => c.aus[0] === a), top = L.slice().sort((x, y) => y.rel - x.rel)[0]; return { a, top, tot: L.reduce((s, c) => s + c.k, 0) }; })
    .filter(x => x.tot >= 5).sort((x, y) => (y.top.ppv || 0) - (x.top.ppv || 0));
  const byState = L => { const S = uniq(L.map(e => RS.norm(e.state))); return S.map(s => `<div class="rs-group"><h3>${RS.stateHTML(s)}</h3>${RS.litBlock(L.filter(e => RS.norm(e.state) === s), 6)}</div>`).join(''); };
  const nav = [['meta', 'Meta-analysis'], ['reviews', 'Reviews'], ['pain', 'Pain'], ['posed', 'Posed portrayals'], ['studies', 'Single studies'], ['perception', 'Perception']];
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Reliability and specificity</h1>
    <p class="lead">Two questions decide whether a facial action can stand for an emotion: does it appear when the emotion is present (reliability), and does it stay away when the emotion is absent (specificity)? Barrett et al. (2019) set these criteria. Every estimate here keeps its source, its sentence and its scope.</p></div></section>
    </div>
    <nav class="secnav" aria-label="Sections"><div class="wrap">${nav.map(([id, l]) => `<a href="#reliability-${id}" data-jump="rs-${id}">${esc(l)}</a>`).join('')}</div></nav>
    <div class="wrap stack-l">
    ${RS.explainHTML()}

    ${RS.dfd().length ? `<section id="rs-meta"><div class="section-h"><h2>Does the proposed face appear with the emotion?</h2><p>Durán and Fernández-Dols (2021) pooled 69 studies that elicited an emotion: how many people showed the face proposed for it, and how closely its intensity tracked the reported feeling. Specificity was not assessed; the studies rarely reported movements outside the proposed face.</p></div>
      ${A.v43 ? FV.dfdHTML() : `<div class="grid2 mx-pair"><div><h3 class="mx-h">Share of people who showed it</h3>${RS.dfdChart()}</div><div><h3 class="mx-h">Correlation of intensities</h3>${RS.dfdCorr()}</div></div>`}
      <details class="more"><summary class="small">Subgroups and the correction for small-study bias</summary>${RS.dfdMods()}</details>
      <p class="tiny muted" style="margin-top:10px">Each effect size is the share of a study's participants who showed the expression, or the correlation in that study; the estimates are random-effects means. The proposed faces are those of Ekman and Friesen, as summarized by Barrett et al. (2019). Read from the accepted manuscript; <a href="https://doi.org/10.1037/emo0001015" target="_blank" rel="noopener">doi:10.1037/emo0001015</a>.</p>${RS.debateHTML()}</section>` : ''}
    ${review.length || field.length ? `<section id="rs-reviews"><div class="section-h"><h2>Reviews</h2><p>Single-study results as summarized by a narrative review (Reisenzein, Studtmann & Horstmann, 2013) and by Barrett et al. (2019). The original study is named under each estimate; its numbers were not inspected here.</p></div>${byState(review.concat(field))}</section>` : ''}
    ${pain.length || kunz13.length ? `<section id="rs-pain"><div class="section-h"><h2>Pain</h2><p>A systematic review of 37 FACS studies counted how many found each action increased during pain; it notes that none of the pain-related movements is exclusive to pain. One experiment coded the same actions in heat pain and in disgusting pictures in the same 60 adults.</p></div>
      ${RS.litBlock(pain, 8)}${kunz13.length ? `<div class="rs-group"><h3>The same actions in pain and disgust</h3>${RS.litBlock(kunz13, 4)}</div>` : ''}</section>` : ''}
    <section id="rs-posed"><div class="section-h"><h2>Posed portrayals</h2><p>Actors and trained displayers, whose poses show the configurations people expect rather than what they do when they feel the emotion.</p></div>
      ${lemau.length ? `<div class="rs-group"><h3>Proposed configurations in actors' portrayals</h3><p class="block-sub">604 photographs of professional actors portraying 13 categories (Le Mau et al., 2021): how often a pose matched the configuration proposed for its category, and how many poses from any scenario that matched it were not false positives (a false positive came from a scenario rated low on the category and high on another emotion).</p>${A.v43 ? FV.configHTML(lemau) : RS.configChart(lemau)}
        <details class="more"><summary class="small">All ${lemau.length} estimates from this study, including the strict and high-intensity versions</summary>${RS.litBlock(lemau, 60)}</details></div>` : ''}
      ${schAU.length ? `<div class="rs-group"><h3>Single actions across 13 enacted emotions ${typeBadge('SA')}</h3><p class="block-sub">Scherer et al. (2019), 20 actors per emotion: for each action, the emotion in which it was most common, how often, and how many of all its occurrences that emotion accounted for (7.7% expected if the action were unrelated to the emotion).</p>
        ${RS.dbKey()}${RS.dumbbell(schAU.map(x => x.top), { n: 30, label: c => `<b><a href="#au-${c.aus[0]}">AU${c.aus[0]}</a> in ${RS.stateHTML(c.state)}</b><span class="soft">${esc(shortAU(c.aus[0]))}</span>` })}</div>` : ''}
      ${hypo.length ? `<div class="rs-group"><h3>Proposed configurations in posed photographs ${typeBadge('SA')}</h3><p class="block-sub">How often the full configuration proposed for each emotion appeared in the WSEFEP photographs of that emotion, and in the others.</p>
        ${RS.dbKey()}${RS.dumbbell(hypo, { n: 12, label: c => `<b>${RS.stateHTML(c.state)}</b><span class="soft">AU ${esc(c.aus.join(' + '))}</span>` })}<p class="tiny muted" style="margin-top:10px">${esc((RS.saSets().find(d => d.id === 'wsefep') || {}).caveat || '')}</p></div>` : ''}</section>
    ${groups.length ? `<section id="rs-studies"><div class="section-h"><h2>Single studies</h2><p>Primary studies that report how often an expression occurred in each of several states, read from the full text.</p></div>${groups.map(([id, h, sub, L]) => `<div class="rs-group"><h3>${esc(h)}</h3><p class="block-sub">${esc(sub)}</p>${RS.litBlock(L, 8)}</div>`).join('')}</section>` : ''}
    ${perc.length ? `<section id="rs-perception"><div class="section-h"><h2>Perception</h2><p>How often perceivers chose the expected word for a posed face. This is agreement among perceivers, not how often the expression occurs.</p></div>${RS.litBlock(perc, 9)}</section>` : ''}
  </div>`;
  RS.wireClaims(main);
  const links = $$('.secnav a[data-jump]', main);
  links.forEach(a => a.onclick = ev => { const el = document.getElementById(a.dataset.jump); if (el) { ev.preventDefault(); el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } });
  if ('IntersectionObserver' in window && links.length) { const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(l => l.classList.toggle('on', l.dataset.jump === en.target.id)); }), { rootMargin: '-35% 0px -60% 0px' });
    links.forEach(l => { const t = document.getElementById(l.dataset.jump); if (t) io.observe(t); }); }
  if (r && r.a) setTimeout(() => { const el = document.getElementById('rs-' + r.a); if (el) el.scrollIntoView(); }, 0);
};

/* ---- app/js/faceviz.js ---- */
/* Findings shown on the face (v4.3 draft): every finding becomes a face plus a picture of its numbers.
 *   FV.item*      turn an estimate (kb.relspec), a verified finding (kb.claims with vis) or a study-provided cell (A.sec)
 *                 into one drawable item: { acts, say, kind, vis, src, sentence }
 *   FV.rowsHTML   the list of items, each with its face and its crowd, ratings, correlation or effect
 *   FV.play       wires a list to a live face: hovering or selecting an item shows its movements
 * vis types: share and compare (crowds of 20), corr (shared variance), ratings (bars on the stated scale), rate (per 100
 * segments), effect (a statistic with its words). */
'use strict';
const FV = {
  N: 20,
  FIG: '<svg class="pp" viewBox="0 0 20 24" aria-hidden="true"><circle cx="10" cy="6.6" r="4.6"/><path d="M1.6 23.4c0-6.2 3.8-9.6 8.4-9.6s8.4 3.4 8.4 9.6z"/></svg>',
  PLAIN: { 1: 'inner brows raised', 2: 'outer brows raised', 4: 'brows lowered', 5: 'upper lids raised', 6: 'cheeks raised', 7: 'lids tightened', 9: 'nose wrinkled',
    10: 'upper lip raised', 11: 'nasolabial furrow deepened', 12: 'lip corners pulled up', 13: 'cheeks puffed', 14: 'dimpler', 15: 'lip corners pulled down', 16: 'lower lip pulled down',
    17: 'chin raised', 18: 'lips puckered', 19: 'tongue out', 20: 'lips stretched', 22: 'lips funnelled', 23: 'lips tightened', 24: 'lips pressed', 25: 'lips parted', 26: 'jaw dropped',
    27: 'mouth stretched open', 28: 'lips sucked in', 41: 'lids drooping', 43: 'eyes closed', 45: 'blink', 51: 'head turned left', 52: 'head turned right', 53: 'head up', 54: 'head down',
    55: 'head tilted left', 56: 'head tilted right', 57: 'head forward', 58: 'head back', 61: 'eyes left', 62: 'eyes right', 63: 'eyes up', 64: 'eyes down' },
  word: a => FV.PLAIN[a] || (A.kb.aus[a] ? A.kb.aus[a].name.toLowerCase() : 'action ' + a),
  words(acts, join) { const W = acts.map(FV.word); if (W.length < 2) return W[0] || ''; const last = join === 'any' ? ' or ' : ' and '; return W.slice(0, -1).join(', ') + last + W[W.length - 1]; },
  cap: t => t ? t[0].toUpperCase() + t.slice(1) : t,
  kmap(acts, k) { const K = {}; acts.forEach(a => { K[a] = k || 1.25; }); return K; },
  drawn: acts => acts.filter(a => FaceMesh.DRAWN.has(String(a))),
  img(acts, size, k, crop) { const L = FV.drawn(acts); return faceSVG(L, { crop: crop || 'face', size: size || 30, k: FV.kmap(L, k), title: acts.length ? 'AU ' + acts.join(' + ') : 'No movement' }); },
  pct(p) { return p == null ? '–' : (100 * p < 9.5 && p > 0 ? (100 * p).toFixed(1).replace(/\.0$/, '') : Math.round(100 * p)) + '%'; },

  /* pictures of numbers */
  crowd(p, acts, opt) {
    opt = opt || {}; const N = opt.n || FV.N, on = Math.round(Math.max(0, Math.min(1, p)) * N);
    const nf = FV.img([], opt.size), xf = FV.img(acts, opt.size, opt.k);
    let s = '';
    for (let i = 0; i < N; i++) s += i < on ? `<span class="cr-c on" style="--i:${i}">${FV.FIG}${nf}<span class="x">${xf}</span></span>` : `<span class="cr-c">${FV.FIG}${nf}</span>`;
    return `<span class="crowd${N < FV.N ? ' few' : ''}" role="img" aria-label="${on} of ${N} showed it">${s}</span>`;
  },
  group(g, acts) { const small = g.n && g.n < FV.N && Number.isInteger(+g.n) && Math.abs(g.p * g.n - Math.round(g.p * g.n)) < 0.02;
    return `<div class="cg"><div class="cg-top"><b>${FV.pct(g.p)}${g.approx ? '<small>about</small>' : ''}</b><span>${esc(g.label || '')}${g.n ? `<em>${g.k != null ? `${fmt.n(g.k)} of ` : small ? `${Math.round(g.p * g.n)} of ` : 'n = '}${fmt.n(g.n)}</em>` : ''}</span></div>${FV.crowd(g.p, g.acts || acts, { k: g.kk, n: small ? +g.n : null })}</div>`; },
  shared(r) { const v = Math.max(0, r * r);
    return `<div class="sh"><div class="sh-bar" role="img" aria-label="${Math.round(v * 100)}% shared"><i style="width:${(100 * v).toFixed(1)}%"></i></div><div class="sh-lab"><b>r = ${fmt.r(r, 2)}</b><span>${r < 0 ? 'opposite directions; ' : ''}feeling and face share about ${Math.round(v * 100)}% of their variation</span></div></div>`; },
  ratings(R, scale, noCap) { const lo = scale ? Math.min(0, scale[0]) : 0, hi = scale ? scale[1] : Math.max(...R.map(x => x.v)) * 1.1;
    const pos = v => (100 * (v - Math.max(lo, 0)) / (hi - Math.max(lo, 0)));
    return `<div class="bars rate">${R.map(x => `<div class="bar-r" data-acts="${esc((x.acts || []).join('+'))}"><span class="bar-f">${FV.img(x.acts || [], 34)}</span><span class="bar-l">${esc(x.label || FV.words(x.acts || []))}</span><span class="bar-t"><i style="width:${Math.max(0, Math.min(100, pos(x.v))).toFixed(1)}%"></i></span><b>${esc(String(+(+x.v).toFixed(2)))}</b></div>`).join('')}</div>${scale && !noCap ? `<p class="cap">scale ${fmt.n(scale[0])} to ${fmt.n(scale[1])}${scale[0] < 0 ? '; bars start at 0' : ''}</p>` : ''}`; },
  rate(v) { return `<div class="sh"><div class="sh-bar" role="img" aria-label="${fmt.n(v)} per 100 segments"><i style="width:${Math.min(100, v).toFixed(1)}%"></i></div><div class="sh-lab"><b>${fmt.n(v)}</b><span>times per 100 five-second segments</span></div></div>`; },
  effect(e) {
    const dec = v => Math.abs(v) < 10 && v % 1 ? 2 : (v % 1 ? 1 : 0);
    const val = /^%/.test(e.stat) ? `${fmt.n(e.v, dec(e.v))}${e.stat}` : (e.v > 0 && e.v < 1 && /false positive|share|proportion/i.test(e.stat)) ? `${FV.pct(e.v)} ${e.stat}` : `${e.stat} ${fmt.n(e.v, dec(e.v))}`;
    return `<div class="fx"><b>${esc(val)}</b>${e.ci ? `<small>95% interval ${esc(fmt.n(e.ci[0], 2))} to ${esc(fmt.n(e.ci[1], 2))}</small>` : ''}<span>${esc(e.what || '')}</span></div>`; },
  items(L) { return `<div class="fvi">${L.map(x => `<div class="fvi-i" data-acts="${esc((x.acts || []).join('+'))}">${x.acts && x.acts.length ? FV.img(x.acts, 54, 1.25, 'tight') : ''}<span>${esc(x.label || FV.words(x.acts || []))}</span></div>`).join('')}</div>`; },
  visHTML(it) {
    const v = it.vis || {};
    if (v.type === 'share' || v.type === 'compare') return `<div class="pr-groups">${v.groups.map(g => FV.group(g, it.acts)).join('')}</div>`;
    if (v.type === 'corr') return FV.shared(v.r);
    if (v.type === 'ratings') return FV.ratings(v.ratings, v.scale);
    if (v.type === 'rate') return FV.rate(v.v);
    if (v.type === 'effect') return FV.effect(v.effect);
    if (v.type === 'count') return `<div class="fx"><b>${fmt.n(v.count.k)}</b><span>${esc(v.count.of || '')}</span></div>${v.count.items && v.count.items.some(x => x.acts && x.acts.length) ? FV.items(v.count.items) : ''}`;
    if (v.type === 'items') return FV.items(v.items);
    if (v.type === 'studies') { const k = Math.round(v.p * v.n);
      return `<div class="cg"><div class="cg-top"><b>${FV.pct(v.p)}</b><span>of ${fmt.n(v.n)} studies found it${v.label ? `<em>${esc(v.label.replace(/,? *\d+ FACS studies.*$/, ''))}</em>` : ''}</span></div><span class="stud" role="img" aria-label="${k} of ${v.n} studies">${Array.from({ length: v.n }, (_, i) => `<i class="${i < k ? 'on' : ''}"></i>`).join('')}</span></div>`; }
    if (v.type === 'time') return `<div class="sh"><div class="sh-bar tm" role="img" aria-label="${FV.pct(v.p)} of the time"><i style="width:${(100 * v.p).toFixed(1)}%"></i></div><div class="sh-lab"><b>${FV.pct(v.p)}</b><span>of the time${v.label ? ', ' + esc(v.label) : ''}</span></div></div>`;
    return '';
  },

  /* ---------- drawable items ---------- */
  KIND: { spontaneous: ['spont', 'Felt'], posed: ['posed', 'Posed'], perception: ['perc', 'Seen'], function: ['func', 'Social use'], 'posed vs spontaneous': ['posed', 'Posed and felt'], review: ['other', 'Review'], theory: ['other', 'Theory'], method: ['other', 'Method'], mixed: ['other', 'Pooled'], other: ['other', 'Other'] },
  /* an estimate from the literature */
  itemEstimate(e) {
    const acts = (RS.acts(e) || []).map(String), v4 = e.v4 || {}, st = RS.norm(e.state);
    const say = e.join === 'part' ? `All or part of: ${FV.words(acts)}` : e.join === 'any' ? FV.cap(FV.words(acts, 'any')) : e.join === 'muscle' ? `Muscle activity behind ${FV.words(acts)}`
      : e.join === 'index' ? `${FV.cap(FV.words(acts))}, summed` : (e.join === 'like' || e.join === 'words' || e.join === 'pooled' || !acts.length) ? FV.cap(String(v4.expr || e.expression || '').replace(/\s*\(([^()]*AU[^()]*)\)/g, '')) : FV.cap(FV.words(acts)) + (acts.length > 1 ? ', together' : '');
    const lab = v4.label || st; let vis, say2 = say;
    if (e.join === 'like') say2 = `Close to a face proposed for ${st} (overlap .40 or more, 0 to 1)`;
    if (e.measure === 'coherence_correlation') { vis = { type: 'corr', r: e.estimate }; say2 = `Stronger ${e.join === 'muscle' ? 'muscle activity' : 'movement'} with more ${st} reported${e.join === 'part' ? ', counting any part of the face' : ''}`; }
    else if (e.measure === 'rate') vis = { type: 'rate', v: 100 * e.estimate };
    else if (e.measure === 'ppv') vis = { type: 'share', groups: [{ p: e.estimate, label: e.src === 'lemau2021' ? `of matching photos did not come from scenarios rated as another emotion` : `of its occurrences came with ${st}`, n: e.n }] };
    else if (e.measure === 'agreement') vis = { type: 'share', groups: [{ p: e.estimate, label: `of observers chose ${st}`, n: e.n }] };
    /* a share of studies is drawn as studies, and a share of time as time, never as a crowd of people */
    else if (e.measure === 'study_share') vis = { type: 'studies', p: e.estimate, n: e.k, label: lab };
    else if (e.measure === 'time_share') vis = { type: 'time', p: e.estimate, label: lab };
    else vis = { type: 'share', groups: [{ p: e.estimate, label: lab, n: e.n, k: e.k != null && e.n ? e.k : null }] };
    return { id: e.id, acts, say: say2, kind: e.stream === 'mixed' ? 'mixed' : e.stream, vis, sentence: RS.plain(e) || '', src: `${RS.link(e)}${e.via ? `, in ${esc(e.via)}` : ''}`, est: e };
  },
  /* a verified finding with structured numbers (claims[].vis from v4/vis) */
  itemClaim(c) {
    const v = c.vis || {}, t = c.v4 || {}, acts = (v.acts && v.acts.length ? v.acts : c.aus).map(String);
    const vis = v.kind === 'share' || v.kind === 'compare' ? { type: v.kind, groups: v.groups.map(g => Object.assign({}, g, { approx: g.approx || g.more_than })) } : v.kind === 'corr' ? { type: 'corr', r: v.r } : v.kind === 'ratings' ? { type: 'ratings', ratings: v.ratings, scale: v.scale }
      : v.kind === 'effect' ? { type: 'effect', effect: v.effect } : v.kind === 'count' ? { type: 'count', count: Object.assign({}, v.count, { items: (v.count && v.count.items) || v.items }) } : v.items && v.items.some(x => x.acts && x.acts.length) ? { type: 'items', items: v.items } : null;
    return { id: c.id, acts, say: v.say ? FV.cap(v.say) : FV.cap(FV.words(acts)), kind: c.stream, vis, sentence: t.head || c.text, src: `${citeLink(c)} <a class="mono" href="#claim-${esc(c.id)}">${esc(c.id)}</a>`, claim: c };
  },
  /* a cell of study-provided AU data: the action with the state and in the other states */
  itemCell(c) {
    const d = RS.saSet(c.dataset), u = d.unit === 'actor' ? 'enactments' : (d.unit || 'item') + 's', st = RS.norm(c.state);
    return { id: c.dataset + ':' + c.aus.join('+') + ':' + st, acts: c.aus.map(String), say: FV.cap(FV.words(c.aus.map(String))) + (c.aus.length > 1 ? ', together' : ''), kind: d.stream || 'posed',
      vis: { type: 'compare', groups: [{ p: c.rel, label: `${st} ${u}`, n: c.n, k: c.k }, { p: c.far, label: `${u} of the other states`, n: c.farN, k: c.farK }] },
      sentence: '', src: `${esc(d.cite)}, computed from their AU codes ${typeBadge('SA')}` };
  },

  /* ---------- the list, played on a face ---------- */
  rowHTML(it, i) {
    const K = FV.KIND[it.kind] || FV.KIND.other;
    return `<div class="pr" tabindex="0" data-i="${i}">
      <div class="pr-face">${FV.img(it.acts, 66, 1.25, 'tight')}<span class="pr-au">${it.acts.length ? 'AU ' + esc(it.acts.join(' + ')) : 'not coded'}</span></div>
      <div class="pr-body"><div class="pr-say"><i class="kd" style="background:var(--s-${K[0]})"></i><span class="pr-kind">${esc(K[1])}</span>${esc(it.say)}</div>
        ${it.vis ? FV.visHTML(it) + (it.sentence ? `<details class="pr-more"><summary>In words</summary><p>${esc(it.sentence)}</p></details>` : '') : `<p class="pr-text">${esc(it.sentence)}</p>`}
        <p class="pr-src">${it.src}</p></div></div>`;
  },
  listHTML(items, id) {
    const rows = items.map((it, i) => FV.rowHTML(it, i)), N = 8;
    const list = rows.length <= N ? rows.join('') : rows.slice(0, N).join('') + `<details class="more pr-moreset"><summary class="small soft">${rows.length - N} more findings</summary>${rows.slice(N).join('')}</details>`;
    return `<div class="pl" id="${esc(id)}"><div class="pl-stage"><div class="pl-face"></div><div class="pl-cap" aria-live="polite"></div></div><div class="pl-rows">${list}</div></div>`;
  },
  play(root, items, opt) {
    opt = opt || {};
    const box = $('.pl-face', root), cap = $('.pl-cap', root); if (!box) return null;
    const names = {}; Object.keys(A.kb.aus).forEach(x => { names[x] = shortAU(x); });
    const first = items[0] ? FV.drawn(items[0].acts) : [];
    const stage = FaceMesh.mount(box, first, { callouts: true, names, title: opt.title || 'Finding', gap: 21, k: FV.kmap(first, 1.15) });
    const go = i => { const it = items[i]; if (!it) return; const L = FV.drawn(it.acts);
      $$('.pr', root).forEach(x => x.classList.toggle('on', +x.dataset.i === i));
      stage.set(L, FV.kmap(L, 1.15), 520);
      cap.innerHTML = `<b>${it.acts.length ? 'AU ' + esc(it.acts.join(' + ')) : 'Not coded as actions'}</b><span>${esc(it.acts.length ? FV.words(it.acts) : it.say)}</span>${L.length < it.acts.length ? `<em>${esc(it.acts.filter(a => !L.includes(a)).map(a => 'AU' + a).join(', '))} not drawn</em>` : ''}`;
      const row = $(`.pr[data-i="${i}"]`, root); if (row) $$('.crowd', row).forEach(c => { c.classList.remove('play'); void c.offsetWidth; c.classList.add('play'); }); };
    $$('.pr', root).forEach(x => { const i = +x.dataset.i; x.addEventListener('mouseenter', () => go(i)); x.addEventListener('focus', () => go(i)); x.addEventListener('click', () => go(i)); });
    if (items.length) go(0);
    FV.reveal(root);
    return stage;
  },
  /* crowds fill in as they scroll into view */
  reveal(root) {
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('play'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -10% 0px' }); $$('.crowd', root).forEach(c => io.observe(c)); }
    else $$('.crowd', root).forEach(c => c.classList.add('play'));
  }
};

/* ---------- which findings a page lists ---------- */
FV.ORDER = { spontaneous: 0, 'posed vs spontaneous': 1, posed: 2, perception: 3, function: 4, mixed: 5, review: 6, theory: 7, method: 8, other: 9 };
FV.sortItems = L => L.sort((a, b) => (FV.ORDER[a.kind] == null ? 9 : FV.ORDER[a.kind]) - (FV.ORDER[b.kind] == null ? 9 : FV.ORDER[b.kind])
  || ((b.est && b.est.meta ? 1 : 0) - (a.est && a.est.meta ? 1 : 0)) || ((b.est && (b.est.n || b.est.k)) || 0) - ((a.est && (a.est.n || a.est.k)) || 0));
FV.claimItems = filter => A.kb.claims.filter(c => c.named !== false && filter(c)).map(FV.itemClaim);
/* a state: estimates for it (or for the face proposed for it), study-provided cells, and verified findings with numbers */
FV.stateItems = label => {
  const k = RS.norm(label);
  const est = RS.lit().filter(e => (RS.norm(e.state) === k || RS.norm(e.proposedFor) === k) && e.role !== 'moderator' && e.role !== 'bias' && e.estimate != null && !/strict/i.test(e.subset || '') && !/≥ \.70/.test((e.v4 || {}).expr || ''));
  const cells = RS.sa().filter(c => RS.norm(c.state) === k && (c.hypothesized || (c.aus.length === 1 && c.rel >= 0.3)));
  const seen = new Set(est.map(e => e.id));
  return FV.sortItems(est.map(FV.itemEstimate).concat(cells.map(FV.itemCell), FV.claimItems(c => c.states.includes(label) && !seen.has(c.id))));
};
/* an action: estimates that measured it, study-provided cells, and verified findings about it */
FV.auItems = code => {
  const est = RS.lit().filter(e => RS.acts(e).includes(code) && e.role !== 'moderator' && e.role !== 'bias' && e.estimate != null && !/≥ \.70/.test((e.v4 || {}).expr || ''));
  const cells = RS.sa().filter(c => c.aus.length === 1 && c.aus[0] === code && c.rel >= 0.25);
  return FV.sortItems(est.map(FV.itemEstimate).concat(cells.map(FV.itemCell), FV.claimItems(c => c.aus.includes(code))));
};

/* ---------- four faces of a state: proposed, posed, felt, seen (kb.states[s].faces4) ---------- */
FV.MODES = [['proposed', 'Textbook', 'other'], ['posed', 'Posed', 'posed'], ['felt', 'Felt', 'spont'], ['seen', 'Seen', 'perc']];
FV.srcHTML = id => { const c = A.I.claimById.get(id); if (c) return citeLink(c);
  const e = (A.kb.relspec || []).find(x => x.id === id); if (e) return `${RS.link(e)}${e.via ? `, in ${esc(e.via)}` : ''}`;
  const r = A.I.recById.get(id); if (r) { const st = studyOf(r.study) || {}; return esc(shortCite(st.cit || r.study)); } return esc(id || ''); };
FV.fourVis = (m) => {
  const v = m.vis || {};
  if (v.kind === 'share' || v.kind === 'compare') return `<div class="cg-${v.groups.length > 1 ? 'two' : 'one'}">${v.groups.map(g => FV.group({ p: g.p, label: g.label, acts: g.acts, kk: m.k }, m.aus)).join('')}</div>`;
  if (v.kind === 'bars') return `<div class="bars">${v.bars.map(b => `<div class="bar-r" data-acts="${esc(b.acts.join('+'))}"><span class="bar-f">${FV.img(b.acts, 34)}</span><span class="bar-l">${esc(b.label || FV.words(b.acts))}</span><span class="bar-t"><i style="width:${(100 * b.v).toFixed(1)}%"></i></span><b>${FV.pct(b.v)}</b></div>`).join('')}</div>`;
  if (v.kind === 'ratings') return FV.ratings(v.ratings, v.scale, true);
  return '';
};
FV.fourHTML = label => {
  const F = (A.kb.states[label] || {}).faces4; if (!F) return '';
  return `<div class="ff4">${FV.MODES.filter(([k]) => F[k]).map(([k, h, col]) => { const m = F[k];
    return `<article class="ff" data-mode="${k}" tabindex="0" aria-label="${esc(h)}: ${m.aus.length ? 'AU ' + esc(m.aus.join(' + ')) : 'no facial action'}">
      <div class="ff-face" id="ff-${k}"></div>
      <div class="ff-h"><h3><i class="kd" style="background:var(--s-${col})"></i>${esc(h)}</h3><span class="ff-au">${m.aus.length ? 'AU ' + esc(m.aus.join(' + ')) : 'none'}</span></div>
      <p class="ff-what">${esc(m.say)}</p>${FV.fourVis(m)}${m.cap ? `<p class="cap">${esc(m.cap)}${m.vis && m.vis.kind === 'ratings' && m.vis.scale ? ` (scale ${esc(String(m.vis.scale[0]).replace('-', '\u2212'))} to ${esc(String(m.vis.scale[1]))})` : ''}</p>` : ''}<p class="ff-src">${FV.srcHTML(m.src)}</p></article>`; }).join('')}</div>`;
};
FV.fourPlay = (root, label) => {
  const F = (A.kb.states[label] || {}).faces4; if (!F) return [];
  return FV.MODES.filter(([k]) => F[k]).map(([k, h]) => { const m = F[k], el = $('#ff-' + k, root); if (!el) return null;
    const L = FV.drawn(m.aus), K = FV.kmap(L, m.k || 1.15), f = FaceMesh.mount(el, L, { crop: 'tight', k: K, title: h + ' ' + label });
    const card = el.closest('.ff'); let busy = 0;
    const replay = () => { if (busy) return; busy = 1; f.set([], null, 380); setTimeout(() => { f.set(L, K, 700); setTimeout(() => { busy = 0; }, 760); }, 460); };
    card.addEventListener('mouseenter', replay); card.addEventListener('focus', replay);
    $$('.bar-r', card).forEach(b => { const B = FV.drawn(b.dataset.acts.split('+')); b.addEventListener('mouseenter', () => f.set(B, FV.kmap(B, 1.3), 380)); b.addEventListener('mouseleave', () => f.set(L, K, 380)); });
    FV.reveal(card);
    return f; }).filter(Boolean);
};

/* ---------- one movement across emotions (study-provided AU data): which states it appears in ---------- */
FV.SETS = [['wsefep', 'Posed photographs', 'Olszanowski et al., 2015: about 30 photographs of each emotion, chosen for agreement'], ['scherer2019', 'Actors enacting 13 emotions', 'Scherer et al., 2019: 20 enactments of each emotion']];
FV.acrossCols = (key, hiState) => FV.SETS.map(([ds, h, sub]) => {
  const L = RS.sa().filter(c => c.dataset === ds && c.aus.slice().sort((a, b) => +a - +b).join('+') === key).sort((a, b) => b.rel - a.rel);
  const isHi = c => hiState && RD.fam(RS.norm(c.state)) === RD.fam(RS.norm(hiState));
  if (!L.length) return `<div class="sb"><h4>${esc(h)}</h4><p class="cap">${esc(sub)}</p><p class="none">Not coded in this study.</p></div>`;
  const hi = L.find(isHi);
  return `<div class="sb"><h4>${esc(h)}</h4><p class="cap">${esc(sub)}</p>${L.map(c => `<div class="sb-r${isHi(c) ? ' hi' : ''}" data-tip="${esc(`AU ${c.aus.join(' + ')} in ${c.k} of ${c.n} ${RS.norm(c.state)} items`)}"><span class="sb-l">${esc(RS.norm(c.state))}</span><span class="sb-t"><i style="width:${(100 * c.rel).toFixed(1)}%"></i></span><span class="sb-v">${c.k} of ${c.n}</span></div>`).join('')}
    ${hi && hi.ppv != null ? `<p class="sb-sum"><b>${FV.pct(hi.ppv)}</b> of all its occurrences came from ${esc(RS.norm(hi.state))}; ${FV.pct(hi.base)} would if it were unrelated.</p>` : ''}</div>`; }).join('');
FV.acrossHTML = (picks, id) => {
  const keys = picks.filter(k => RS.sa().some(c => c.aus.slice().sort((a, b) => +a - +b).join('+') === k)); if (!keys.length) return '';
  return `<div class="ac" id="${esc(id)}"><div class="ac-pick" role="group" aria-label="Movement">${keys.map((k, i) => `<button type="button" class="chipbtn" data-key="${esc(k)}" aria-pressed="${i === 0}">${FV.img(k.split('+'), 30)}<span>AU ${esc(k.split('+').join(' + '))}</span></button>`).join('')}</div>
    <div class="ac-main"><div class="ac-face"><div class="ac-live"></div><p class="ac-name"></p></div><div class="ac-cols"></div></div></div>`;
};
FV.acrossPlay = (root, hiState) => {
  if (!root) return null; const first = $('.ac-pick button', root); if (!first) return null;
  const k0 = first.dataset.key.split('+'), f = FaceMesh.mount($('.ac-live', root), FV.drawn(k0), { crop: 'tight', title: 'Movement', k: FV.kmap(FV.drawn(k0), 1.3) });
  const pick = key => { const L = key.split('+'); $$('.ac-pick button', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.key === key));
    f.set(FV.drawn(L), FV.kmap(FV.drawn(L), 1.3), 480); $('.ac-name', root).innerHTML = `<b>AU ${esc(L.join(' + '))}</b>${esc(FV.words(L))}`; $('.ac-cols', root).innerHTML = FV.acrossCols(key, hiState); };
  $$('.ac-pick button', root).forEach(b => b.onclick = () => pick(b.dataset.key)); pick(first.dataset.key);
  return f;
};

/* the key of a set of actions: the numbers in order, joined by '+' */
FV.protoKey = L => L.slice().sort((a, b) => +a - +b).join('+');

/* a combination: estimates of exactly these actions (all together, or the configuration whole or in part), study-provided cells
   for exactly these actions, and verified findings about all of them */
FV.comboItems = codes => {
  const key = FV.protoKey(codes);
  const est = RS.lit().filter(e => FV.protoKey(RS.acts(e)) === key && e.role !== 'moderator' && e.role !== 'bias' && e.estimate != null && !/≥ \.70/.test((e.v4 || {}).expr || ''));
  const cells = RS.sa().filter(c => FV.protoKey(c.aus) === key && c.rel != null && (codes.length > 1 || c.rel >= 0.25));
  /* verified findings whose drawn movements include every selected action (not merely findings that mention them); exact sets first */
  const cl = codes.length > 1 ? FV.claimItems(c => codes.every(a => c.aus.includes(a))).filter(it => codes.every(a => it.acts.includes(a))) : [];
  const L = FV.sortItems(est.map(FV.itemEstimate).concat(cells.map(FV.itemCell), cl));
  return L.filter(it => FV.protoKey(it.acts) === key).concat(L.filter(it => FV.protoKey(it.acts) !== key));
};

/* a list without a live face (long overview pages): each finding keeps its own face */
FV.rowsPlain = (items, n) => {
  const rows = items.map((it, i) => FV.rowHTML(it, i)), N = n || 6;
  return `<div class="pl-rows plain">${rows.length <= N ? rows.join('') : rows.slice(0, N).join('') + `<details class="more pr-moreset"><summary class="small soft">${rows.length - N} more</summary>${rows.slice(N).join('')}</details>`}</div>`;
};
/* posed portrayals (Le Mau et al., 2021): for each category, the proposed face, the share of poses that matched it, and the share
   of matching poses that were not false positives, as faces and crowds */
FV.configHTML = L => {
  const cats = uniq(L.map(e => e.state)), get = (c, m, sub) => L.find(e => e.state === c && e.measure === m && (!sub || (e.subset || '').startsWith(sub)));
  const rows = cats.map(c => ({ c, r: get(c, 'reliability', 'pose match'), p: get(c, 'ppv', 'all 604') })).filter(x => x.r).sort((a, b) => (b.r.estimate || 0) - (a.r.estimate || 0));
  return `<div class="dfd cfg4">${rows.map(x => { const acts = (RS.acts(x.r) || []).map(String);
    return `<div class="dfd-r"><div class="dfd-f">${FV.img(acts, 92, 1.2, 'tight')}<b>${RS.stateHTML(x.c)}</b><span>AU ${esc(acts.join(' + '))}</span></div>
      <div class="dfd-c">${FV.group({ p: x.r.estimate, label: 'of its poses matched the proposed face', n: x.r.n, k: x.r.k }, acts)}${x.p ? FV.group({ p: x.p.estimate, label: 'of matching poses did not come from scenarios rated as another emotion', n: x.p.n, k: x.p.k }, acts) : '<div class="cg"><div class="cg-top"><b>–</b><span>no estimate of false positives</span></div></div>'}</div></div>`; }).join('')}</div>`;
};
/* the meta-analysis of emotion and expression (Durán & Fernández-Dols, 2021), as faces and crowds */
FV.dfdHTML = () => {
  const main = RS.dfd().filter(e => e.role === 'main'); if (!main.length) return '';
  const get = (ma, st) => main.find(e => e.ma === ma && RS.norm(e.state) === st);
  const emos = ['happiness', 'surprise', 'disgust', 'sadness', 'anger', 'fear'].sort((a, b) => ((get('MA2', b) || {}).estimate || 0) - ((get('MA2', a) || {}).estimate || 0));
  const row = st => { const a = get('MA1', st), b = get('MA2', st), c = get('MA3', st), L = RS.acts(b || a || {});
    return `<div class="dfd-r"><div class="dfd-f">${FV.img(L, 92, 1.2, 'tight')}<b>${RS.stateHTML(st)}</b><span>AU ${esc(L.join(' + '))}</span></div>
      <div class="dfd-c">${a ? FV.group({ p: a.estimate, label: 'the whole face', n: null }, L) : '<div class="cg"><div class="cg-top"><b>–</b><span>whole face: no FACS data</span></div></div>'}${b ? FV.group({ p: b.estimate, label: 'all or part of it' }, L) : ''}</div>
      <div class="dfd-k">${c ? FV.shared(c.estimate) : ''}<p class="cap">k = ${[a, b].map(e => e && e.k != null ? e.k : 0).join(' and ')} effect sizes${c ? `; ${c.k} for the correlation` : ''}</p></div></div>`; };
  return `<div class="dfd">${emos.map(row).join('')}</div>`;
};

/* ---- app/js/lab.js ---- */
/* Statistics lab: AU data released by studies (built in, when available) or AU data you load; analyses run in the browser with AUStats. */
'use strict';
const ST = window.AUStats;
const LAB = { ds: null, ds2: null, last: null, busy: false };
const tick = () => new Promise(r => setTimeout(r, 0));
/* ---------- data ---------- */
const AU_RE = /^AU\s*0*(\d+)(?:[_\s-]*(r|c|int|intensity|prob|probability|evidence|value|amp|amplitude|present|mean|max|prop|events|peakpos|slope|onset))?$/i;
const ID_RE = /^(id|.+_id|id_.+|subject|participant|person|actor|speaker|rater|perceiver|video|clip|file|filename|input|session|trial|stimulus|item)$/i;
const TIME_RE = /^(frame|frame_number|time|time_s|timestamp|seconds|sec)$/i;
const LAB_UPPER = new Set(['1', '2', '4', '5', '6', '7', '41', '42', '43', '44', '45', '46']);
function auOf(name) { const m = String(name).match(AU_RE); return m ? String(+m[1]) : null; }
function colOf(ds, name) { return ds.cols.find(c => c.name === name); }
function numCols(ds) { return ds.cols.filter(c => c.type === 'num'); }
function catCols(ds) { return ds.cols.filter(c => c.type === 'cat'); }
function levelsOf(col) { const m = countBy(col.values.filter(v => v != null && v !== ''), v => v); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]); }
/* reference levels sort by code point, as R (radix) and Python (sorted) do, so exported code picks the same reference level */
function alphaLevels(col) { return levelsOf(col).map(String).sort(); }
/* the base AU columns: one per action (AU12, AU12_r or AU12_mean), not derived features such as _max or _events */
function auCols(ds) {
  const by = new Map();
  numCols(ds).forEach(c => { const m = c.name.match(AU_RE); if (!m) return; const suf = (m[2] || '').toLowerCase();
    if (['max', 'prop', 'events', 'peakpos', 'slope', 'onset'].includes(suf)) return;
    const rank = { '': 0, mean: 0, r: 1, int: 1, intensity: 1, prob: 1, probability: 1, evidence: 2, value: 2, amp: 1, amplitude: 1, present: 3, c: 4 }[suf] ?? 5;
    const a = String(+m[1]); if (!by.has(a) || rank < by.get(a).rank) by.set(a, { name: c.name, rank }); });
  return [...by.entries()].sort((a, b) => +a[0] - +b[0]).map(x => x[1].name);
}
function idLike(c) { return ID_RE.test(c.name) || TIME_RE.test(c.name); }
function guess(ds) {
  const A = auCols(ds), C = catCols(ds).filter(c => c.name !== ds.group && !idLike(c));
  const pref = c => /emotion|state|condition|label|category|response|class|portray|target|answer|choice/i.test(c.name) ? 0 : 1;
  const okC = C.filter(c => { const k = levelsOf(c).length; return k >= 2 && k <= 20; }).sort((a, b) => pref(a) - pref(b));
  const outcome = (ds.defaults || (ds.meta && ds.meta.defaults) || {}).outcome || (okC[0] || C[0] || {}).name || null;
  const covar = numCols(ds).filter(c => !auOf(c.name) && !idLike(c) && c.name !== ds.group).map(c => c.name);
  return { outcome, aus: A, preds2: A.slice(0, 2), covar, split: (okC.find(c => c.name !== outcome) || {}).name || null };
}
function datasetFromRows(rows, name) {
  const head = rows[0].map((h, j) => (h || 'col' + (j + 1)).trim());
  const body = rows.slice(1);
  const cols = head.map((h, j) => {
    const raw = body.map(r => r[j] == null ? '' : String(r[j]).trim());
    const nonEmpty = raw.filter(v => v !== '' && !/^(na|nan|null)$/i.test(v));
    const nums = nonEmpty.filter(v => isFinite(+v));
    const allNum = nonEmpty.length && nums.length / nonEmpty.length >= 0.95;
    const distinct = new Set(nonEmpty).size;
    /* numeric unless it identifies people, stimuli or files (then categorical, usable for grouping); 0/1 columns stay numeric */
    const isNum = allNum && (distinct > 2 || nonEmpty.every(v => +v === 0 || +v === 1)) && !(ID_RE.test(h) && !auOf(h));
    return { name: h, type: isNum ? 'num' : 'cat', values: raw.map(v => v === '' || /^(na|nan|null)$/i.test(v) ? null : (isNum ? (isFinite(+v) ? +v : null) : v)) };
  });
  const ds = { name, n: body.length, cols, group: null, file: name };
  const g = cols.find(c => c.type === 'cat' && /^(subject|participant|person|actor|speaker|rater|perceiver)(_?id)?$|^(subject|participant|person)_?id$|^id$/i.test(c.name) && levelsOf(c).length > 1 && levelsOf(c).length < ds.n);
  if (g) ds.group = g.name;
  return ds;
}
/* rows are frames: aggregate to one row per video, clip or trial, with temporal features for each action */
function aggregateFrames(ds, by, thr) {
  thr = thr == null ? 0.5 : thr;
  const g = colOf(ds, by), keys = uniq(g.values.filter(v => v != null)), idx = new Map(keys.map(k => [k, []]));
  g.values.forEach((v, i) => { if (v != null) idx.get(v).push(i); });
  const tc = ds.cols.find(c => c.type === 'num' && /^(time|time_s|timestamp|seconds|sec)$/i.test(c.name)) || ds.cols.find(c => c.type === 'num' && /^(frame|frame_number)$/i.test(c.name));
  const order = k => { const L = idx.get(k).slice(); if (tc) L.sort((a, b) => tc.values[a] - tc.values[b]); return L; };
  const cols = [{ name: by, type: 'cat', values: keys }];
  const AUS = new Set(auCols(ds));
  ds.cols.forEach(c => {
    if (c.name === by || TIME_RE.test(c.name)) return;
    if (c.type === 'num') {
      const add = (suf, f) => cols.push({ name: c.name + suf, type: 'num', values: keys.map(k => { const L = order(k), v = L.map(i => c.values[i]).filter(x => x != null && isFinite(x)); return v.length ? f(v, L) : null; }) });
      add(AUS.has(c.name) ? '_mean' : '', v => ST.mean(v));
      if (AUS.has(c.name)) {
        add('_max', v => Math.max(...v));
        add('_prop', v => v.filter(x => x >= thr).length / v.length);
        add('_events', v => { let n = 0; v.forEach((x, i) => { if (x >= thr && (i === 0 || v[i - 1] < thr)) n++; }); return n; });
        add('_peakpos', v => { let p = 0; v.forEach((x, i) => { if (x > v[p]) p = i; }); return v.length > 1 ? p / (v.length - 1) : 0; });
        add('_slope', v => { if (v.length < 3) return 0; const n = v.length, xs = v.map((_, i) => i / (n - 1)), mx = ST.mean(xs), my = ST.mean(v); let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (v[i] - my); sxx += (x - mx) ** 2; }); return sxx ? sxy / sxx : 0; });
        add('_onset', (v, L) => { const i = v.findIndex(x => x >= thr); if (i < 0) return null; if (!tc) return i; const T = L.map(j => tc.values[j]); return T[i] - T[0]; });
      }
    } else cols.push({ name: c.name, type: 'cat', values: keys.map(k => { const v = idx.get(k).map(i => c.values[i]).filter(x => x != null); if (!v.length) return null; const m = countBy(v, x => x); return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]; }) });
  });
  const out = { name: ds.name + ' (one row per ' + by + ')', n: keys.length, cols, group: null, file: (ds.file || 'lab_data.csv').replace(/\.\w+$/, '') + '_by_' + by + '.csv',
    note: `Aggregated from ${fmt.n(ds.n)} rows${tc ? ` in ${tc.name} order` : ''}: for each action the mean, maximum, share of rows at or above ${thr}, number of activity events, relative position of the peak, linear slope, and time of the first activity.` };
  const gcol = ds.group && ds.group !== by ? colOf(ds, ds.group) : null;
  if (gcol) { out.cols.push({ name: ds.group, type: 'cat', values: keys.map(k => gcol.values[idx.get(k)[0]]) }); out.group = ds.group; }
  return out;
}
/* ---------- design matrices ---------- */
/* Design matrix on the analysed rows only: rows with any missing predictor (or failing opt.valid, e.g. a missing outcome or group)
   are dropped first; factor levels, z-scores and interaction terms (products of the possibly standardized predictors) are then
   computed on the rows that remain. This is the rule the R and Python exports follow (see S.code in stats.js). */
function design(ds, preds, opt) {
  opt = opt || {};
  const n = ds.n, cols = preds.map(p => colOf(ds, p)).filter(Boolean);
  const ok = (c, v) => v != null && v !== '' && (c.type !== 'num' || isFinite(v));
  const keep = [];
  for (let i = 0; i < n; i++) { if (opt.valid && !opt.valid(i)) continue; if (cols.every(c => ok(c, c.values[i]))) keep.push(i); }
  const names = [], X1 = [], isNum = [];
  cols.forEach(c => {
    if (c.type === 'num') {
      let v = keep.map(i => +c.values[i]);
      if (opt.standardize) { const m = ST.mean(v), sd = ST.sd(v) || 1; v = v.map(x => (x - m) / sd); }
      names.push(c.name); X1.push(v); isNum.push(true);
    } else {
      const lv = uniq(keep.map(i => String(c.values[i]))).sort();
      lv.slice(1).forEach(l => { names.push(c.name + '[' + l + ']'); X1.push(keep.map(i => String(c.values[i]) === l ? 1 : 0)); isNum.push(false); });
    }
  });
  const inter = [];
  if (opt.interactions) {
    const numIdx = isNum.map((f, j) => f ? j : -1).filter(j => j >= 0);
    for (let a = 0; a < numIdx.length; a++) for (let b = a + 1; b < numIdx.length; b++) { const ja = numIdx[a], jb = numIdx[b]; inter.push([names[ja], names[jb]]); names.push(names[ja] + ':' + names[jb]); X1.push(X1[ja].map((x, k) => x * X1[jb][k])); }
  }
  const X = keep.map((_, k) => Float64Array.from(X1.map(col => col[k])));
  return { names, X, keep, inter };
}
/* ---------- view ---------- */
const ANALYSES = [
  ['describe', 'Describe by group'], ['compare', 'Compare groups (rank tests, FDR)'], ['correlate', 'Correlations (FDR)'], ['cooccur', 'Co-occurrence of actions'],
  ['logit', 'Logistic regression'], ['mlogit', 'Multinomial regression'], ['lmm', 'Linear mixed model'], ['glmm', 'Logistic mixed model'],
  ['cv', 'Predictive validation (grouped CV)'], ['transfer', 'Transfer to held-out data']
];
VIEWS.lab = function (main) {
  const B = SEC.microSets();
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Statistics lab</h1>
    <p class="lead">Analyses run in your browser on AU data you load${B.length ? ' or on AU data released by studies' : ''}. Every model reports a design check, and every analysis exports R and Python code. Predictive accuracy is not psychological validity.</p></div></section>
    <div class="lab-steps"><div class="card lab-form" id="lform"></div><div class="stack minw0" id="lres"></div></div>
    <section class="layer" id="lrefsec" hidden>${layerHead('s', 'Reference results', 'Computed in Python (statsmodels, scikit-learn) on the same study-provided data; the lab should reproduce them closely.')}<div id="lref"></div></section></div>`;
  const form = $('#lform', main), res = $('#lres', main);
  const showRef = () => { const ds = LAB.ds, ref = ds && ds.meta && A.sec && A.sec.reference && A.sec.reference[ds.meta.id]; $('#lrefsec', main).hidden = !ref; if (ref) $('#lref', main).innerHTML = refHTML(ds.meta, ref); };
  function drawForm() {
    const ds = LAB.ds;
    form.innerHTML = `<div class="stack"><h3 class="step"><span>1</span>Data</h3>
      <div class="small"><b>${esc(ds ? ds.name : 'No data loaded')}</b>${ds ? `<br><span class="soft">${fmt.n(ds.n)} rows, ${ds.cols.length} variables</span>` : ''}</div>${ds && ds.note ? `<div class="tiny muted">${esc(ds.note)}</div>` : ''}
      ${!ds ? '<p class="small soft">Load a CSV with one row per observation (or per frame, then aggregate), AU columns such as AU12 or AU12_r, a state or condition column, and a person or video identifier.</p>' : ''}
      <div class="row"><label class="btn ${ds ? 'ghost ' : ''}small" style="cursor:pointer">Load CSV<input type="file" id="lfile" accept=".csv,.tsv,.txt" hidden></label>
        ${B.length ? `<select id="lbuilt" aria-label="Study-provided data"><option value="">Study-provided data…</option>${B.map(d => `<option value="${esc(d.id)}">${esc(d.short || d.cite)} (${fmt.n(d.n)} ${esc(d.unit)}s)</option>`).join('')}</select>` : ''}
        ${ds ? '<button class="btn ghost small" id="lexp">Download data</button>' : ''}</div>
      ${ds && !ds.builtin ? `<label class="field">Rows are frames? Aggregate by<select id="lagg"><option value="">No, one row per observation</option>${catCols(ds).map(c => `<option>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      ${ds ? `<label class="field">Grouping variable (person, video or session; used for clustering and grouped folds)<select id="lgroup"><option value="">None</option>${catCols(ds).map(c => `<option${c.name === ds.group ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      </div>
      ${ds ? `<div class="stack"><h3 class="step"><span>2</span>Analysis</h3><label class="field">Analysis<select id="lan">${ANALYSES.map(([k, v]) => `<option value="${k}"${LAB.an === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label><div id="lopts" class="stack"></div>
      <div class="row"><button class="btn" id="lrun">Run</button><span class="small muted" id="lprog"></span></div></div>` : ''}`;
    const fi = $('#lfile', form); if (fi) fi.onchange = async e => { const f = e.target.files[0]; if (!f) return; const rows = AUAdapters.parseCSV(await f.text()); if (rows.length < 3) { toast('The file has too few rows.'); return; } LAB.ds = datasetFromRows(rows, f.name); drawForm(); showRef(); toast(`Loaded ${fmt.n(LAB.ds.n)} rows${LAB.ds.group ? `; grouping by ${LAB.ds.group}` : ''}.`); };
    const lb = $('#lbuilt', form); if (lb) lb.onchange = async () => { if (!lb.value) return; try { LAB.ds = await SEC.load(lb.value); drawForm(); showRef(); } catch (e) { toast('The study-provided data could not be loaded.'); } };
    const la = $('#lagg', form); if (la) la.onchange = () => { if (la.value) { LAB.ds = aggregateFrames(LAB.ds, la.value); drawForm(); } };
    const lg = $('#lgroup', form); if (lg) lg.onchange = () => { LAB.ds.group = lg.value || null; drawOpts(); };
    const lx = $('#lexp', form); if (lx) lx.onclick = () => { const d = LAB.ds; saveFile(d.file || 'lab_data.csv', toCSV(d.cols.map(c => c.name), Array.from({ length: d.n }, (_, i) => d.cols.map(c => c.values[i] == null ? '' : (typeof c.values[i] === 'number' ? +c.values[i].toFixed(5) : c.values[i]))))); };
    if (!ds) return;
    const an = $('#lan', form); an.onchange = () => { LAB.an = an.value; drawOpts(); }; LAB.an = an.value; drawOpts();
    $('#lrun', form).onclick = run;
  }
  function sel(id, label, opts, val, multiple) {
    return `<label class="field">${esc(label)}${multiple ? `<div class="chk" id="${id}">${opts.map(o => `<label><input type="checkbox" value="${esc(o)}"${(val || []).includes(o) ? ' checked' : ''}>${esc(o)}</label>`).join('')}</div>` : `<select id="${id}">${opts.map(o => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`}</label>`;
  }
  function drawOpts() {
    const ds = LAB.ds, k = LAB.an, o = $('#lopts', form);
    const G = guess(ds), N = numCols(ds).map(c => c.name), C = catCols(ds).map(c => c.name).filter(c => c !== ds.group), AU = G.aus.length ? G.aus : N;
    let h = '';
    if (k === 'describe') h = sel('o_var', 'Variable', N, AU[0]) + sel('o_by', 'By', C, G.outcome);
    if (k === 'compare') h = sel('o_vars', 'Variables', N, AU.slice(0, 8), true) + sel('o_by', 'Groups', C, G.outcome);
    if (k === 'correlate') h = sel('o_vars', 'Variables', N, AU.slice(0, 6), true) + sel('o_meth', 'Method', ['Spearman', 'Pearson'], 'Spearman');
    if (k === 'cooccur') h = sel('o_vars', 'Actions (numeric, thresholded)', N, AU.slice(0, 7), true) + `<label class="field">Active when ≥<input type="number" id="o_thr" value="0.5" step="0.05"></label>`;
    if (k === 'logit' || k === 'glmm') h = sel('o_y', 'Outcome', C.concat(N), G.outcome) + `<label class="field">Positive class (for a categorical outcome)<select id="o_pos"></select></label>` + sel('o_x', 'Predictors', N.concat(C), G.preds2, true) +
      `<label class="small"><input type="checkbox" id="o_int"> add pairwise interactions of numeric predictors</label><label class="small"><input type="checkbox" id="o_std" checked> standardize numeric predictors</label>` +
      (k === 'logit' ? `<label class="field">Estimation<select id="o_pen"><option value="">Maximum likelihood</option><option value="firth">Firth (bias reduction; separation)</option><option value="ridge">Ridge (λ = 1)</option></select></label>` : '');
    if (k === 'mlogit') h = sel('o_y', 'Outcome (categorical)', C, G.outcome) + sel('o_x', 'Predictors', N.concat(C), G.preds2, true) + `<label class="small"><input type="checkbox" id="o_std" checked> standardize numeric predictors</label>`;
    if (k === 'lmm') h = sel('o_y', 'Outcome (numeric)', N, AU[0]) + sel('o_x', 'Fixed effects', C.concat(N), [G.outcome].filter(Boolean), true);
    if (k === 'cv' || k === 'transfer') {
      const names = featureSetNames(ds);
      h = sel('o_y', 'Outcome (categorical)', C, G.outcome) + sel('o_sets', 'Feature sets to compare', names, names.filter(n => /^(Single action|All actions$|All actions \+ pairwise|All actions \+ temporal|Upper face|Lower face)/.test(n)).concat(G.aus.length ? [] : ['All numeric variables']), true) +
        sel('o_single', 'Single action for the single-action set', AU, AU[0]) + `<label class="field">Model<select id="o_model"><option value="mlogit">Multinomial logistic (ridge 1e-4)</option><option value="majority">Majority class (baseline)</option></select></label>`;
      if (k === 'cv') h += `<label class="field">Folds<input type="number" id="o_k" value="5" min="2" max="10"></label><label class="small"><input type="checkbox" id="o_bal" checked> balanced class weights</label><label class="field">Permutation test of the first set (B; 0 = off)<input type="number" id="o_B" value="0" min="0" max="500" step="10"></label>`;
      else h += `<label class="field">Hold out<select id="o_mode"><option value="split">Part of this file (choose a variable)</option><option value="file">A second file with the same columns</option></select></label>
        <div id="o_splitw">${sel('o_split', 'Split variable', C, G.split || C[0])}<label class="field">Train on level<select id="o_lev"></select></label></div>
        <div id="o_filew" hidden><label class="btn ghost small" style="cursor:pointer">Load the second file<input type="file" id="o_file2" accept=".csv,.tsv,.txt" hidden></label> <span class="small muted" id="o_f2">${LAB.ds2 ? esc(LAB.ds2.name) + ' · ' + fmt.n(LAB.ds2.n) + ' rows' : 'none loaded'}</span></div>`;
    }
    o.innerHTML = h;
    const fillPos = () => { const y = $('#o_y', form), p = $('#o_pos', form); if (!y || !p) return; const c = colOf(ds, y.value); const L = c && c.type === 'cat' ? alphaLevels(c) : []; p.innerHTML = L.map(l => `<option>${esc(l)}</option>`).join('') || '<option value="">(numeric 0/1 outcome)</option>'; };
    const fillLev = () => { const s = $('#o_split', form), l = $('#o_lev', form); if (!s || !l) return; const c = colOf(ds, s.value); l.innerHTML = c ? alphaLevels(c).map(x => `<option>${esc(x)}</option>`).join('') : ''; };
    const y = $('#o_y', form); if (y) y.onchange = fillPos; fillPos();
    const s = $('#o_split', form); if (s) s.onchange = fillLev; fillLev();
    const m = $('#o_mode', form); if (m) m.onchange = () => { $('#o_splitw', form).hidden = m.value !== 'split'; $('#o_filew', form).hidden = m.value !== 'file'; };
    const f2 = $('#o_file2', form); if (f2) f2.onchange = async e => { const f = e.target.files[0]; if (!f) return; const rows = AUAdapters.parseCSV(await f.text()); LAB.ds2 = datasetFromRows(rows, f.name); $('#o_f2', form).textContent = `${f.name} · ${fmt.n(LAB.ds2.n)} rows`; };
  }
  async function run() {
    if (LAB.busy) return; LAB.busy = true; const prog = $('#lprog', form); prog.textContent = 'Running…'; res.innerHTML = '<div class="loading">Running…</div>'; await tick();
    try { const out = await RUN[LAB.an](LAB.ds, form, prog); res.innerHTML = out; wireResults(res); }
    catch (e) { console.error(e); res.innerHTML = `<div class="empty">The analysis stopped: ${esc(e.message)}</div>`; }
    LAB.busy = false; prog.textContent = '';
  }
  drawForm(); showRef();
};
function featureSetNames(ds) {
  const A = auCols(ds), names = ['Single action (chosen below)'];
  if (A.length) {
    names.push('All actions');
    if (A.length > 2) names.push(`All actions + pairwise interactions of the ${Math.min(8, A.length)} most variable`);
    if (A.some(a => LAB_UPPER.has(auOf(a)))) names.push('Upper face actions');
    if (A.some(a => !LAB_UPPER.has(auOf(a)))) names.push('Lower face actions');
  }
  if (ds.cols.some(c => /^AU\s*0*\d+_(events|peakpos|slope|onset)$/i.test(c.name))) names.push('All actions + temporal features');
  if (A.length && numCols(ds).some(c => !auOf(c.name) && !idLike(c) && c.name !== ds.group)) names.push('All actions + other numeric variables');
  names.push('All numeric variables');
  return names;
}
function featureSet(ds, name, single) {
  const A = auCols(ds), N = numCols(ds).filter(c => c.name !== ds.group && !idLike(c)).map(c => c.name);
  if (name.startsWith('Single action')) return { preds: [single] };
  if (name === 'All actions') return { preds: A };
  if (name.startsWith('All actions + pairwise')) {
    const sd = a => { const v = colOf(ds, a).values.filter(x => x != null && isFinite(x)); return v.length ? ST.sd(v) : 0; };
    return { preds: A, inter: A.slice().sort((a, b) => sd(b) - sd(a)).slice(0, 8) };
  }
  if (name === 'Upper face actions') return { preds: A.filter(a => LAB_UPPER.has(auOf(a))) };
  if (name === 'Lower face actions') return { preds: A.filter(a => !LAB_UPPER.has(auOf(a))) };
  if (name === 'All actions + temporal features') return { preds: A.concat(N.filter(x => /^AU\s*0*\d+_(events|peakpos|slope|onset)$/i.test(x))) };
  if (name === 'All actions + other numeric variables') return { preds: A.concat(N.filter(x => !auOf(x))) };
  return { preds: N };
}
function buildXY(ds, yName, preds, opt) {
  opt = opt || {};
  const yc = colOf(ds, yName); if (!yc) throw new Error('Unknown outcome');
  const gc = ds.group && !opt.noGroup ? colOf(ds, ds.group) : null;
  const yOk = i => { const v = yc.values[i]; return v != null && v !== '' && (yc.type === 'cat' || isFinite(v)); };
  const valid = i => yOk(i) && (!gc || (gc.values[i] != null && gc.values[i] !== '')) && (!opt.extraValid || opt.extraValid(i));
  const D = design(ds, preds, Object.assign({}, opt, { valid }));
  // interactions restricted to a named subset
  if (opt.interSubset) {
    const colsIdx = opt.interSubset.filter(x => D.names.includes(x)).map(x => D.names.indexOf(x));
    for (let a = 0; a < colsIdx.length; a++) for (let b = a + 1; b < colsIdx.length; b++) { const ja = colsIdx[a], jb = colsIdx[b]; D.names.push(D.names[ja] + ':' + D.names[jb]); D.X = D.X.map(r => { const o = new Float64Array(r.length + 1); o.set(r); o[r.length] = r[ja] * r[jb]; return o; }); }
  }
  const keep = D.keep;
  let cls = null, y;
  if (opt.binaryPos != null && yc.type === 'cat') y = keep.map(i => yc.values[i] === opt.binaryPos ? 1 : 0);
  else if (yc.type === 'cat') { cls = uniq(keep.map(i => yc.values[i])).sort(); y = keep.map(i => cls.indexOf(yc.values[i])); }
  else y = keep.map(i => +yc.values[i]);
  const g = keep.map(i => gc ? gc.values[i] : i);
  return { X: D.X, y, g, names: D.names, keep, cls, inter: D.inter, grouped: !!gc };
}
function auditHTML(items) {
  return `<div class="audit">${items.map(x => `<div class="${x.level === 'error' ? 'er' : x.level === 'warning' ? 'wn' : 'ok'}">${esc(x.text)}</div>`).join('')}</div>`;
}
function codeHTML(spec) {
  let R, P;
  try { R = ST.code.R(spec); P = ST.code.python(spec); }
  catch (e) { console.error(e); return '<p class="tiny muted">Code export is not available for this analysis.</p>'; }
  return `<details class="card"><summary><b>Code to reproduce</b> <span class="small muted">R and Python</span></summary><div class="stack" style="margin-top:10px"><div class="row"><span class="label">R</span><button class="btn ghost small" data-copy="r">Copy</button></div><pre class="code" data-code="r">${esc(R)}</pre>
    <div class="row"><span class="label">Python</span><button class="btn ghost small" data-copy="py">Copy</button></div><pre class="code" data-code="py">${esc(P)}</pre></div></details>`;
}
function wireResults(el) {
  $$('[data-copy]', el).forEach(b => b.onclick = async () => { const pre = $(`[data-code="${b.dataset.copy}"]`, el); try { await navigator.clipboard.writeText(pre.textContent); toast('Copied.'); } catch (e) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected; press Ctrl+C or ⌘C to copy.'); } });
  $$('[data-dl]', el).forEach(b => b.onclick = () => { const d = LAB.lastTable; if (d) saveFile(d.file, toCSV(d.cols, d.rows)); });
}
function coefTable(tab, opt) {
  opt = opt || {};
  LAB.lastTable = { file: 'lab_coefficients.csv', cols: ['term', 'estimate', opt.or ? 'odds_ratio' : 'exp', 'se', 'lo', 'hi', 'p'], rows: tab.map(t => [t.term, t.est, Math.exp(t.est), t.se, t.lo, t.hi, t.p]) };
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Term</th><th class="num">Estimate</th>${opt.or ? `<th class="num">${esc(opt.or)}</th><th class="num">95% CI</th>` : '<th class="num">95% CI</th>'}<th class="num">SE</th><th class="num">p</th></tr></thead><tbody>
    ${tab.map(t => `<tr><td class="mono small">${esc(t.term)}</td><td class="num">${fmt.r(t.est, 3)}</td>${opt.or ? `<td class="num">${fmt.r(Math.exp(t.est), 2)}</td><td class="num">${fmt.r(Math.exp(t.lo), 2)} to ${fmt.r(Math.exp(t.hi), 2)}</td>` : `<td class="num">${fmt.r(t.lo, 3)} to ${fmt.r(t.hi, 3)}</td>`}<td class="num">${fmt.r(t.se, 3)}</td><td class="num">${fmt.p(t.p)}</td></tr>`).join('')}</tbody></table></div>
    <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div>`;
}
const RUN = {
  async describe(ds, form) {
    const v = colOf(ds, $('#o_var', form).value), by = colOf(ds, $('#o_by', form).value), gc = ds.group ? colOf(ds, ds.group) : null;
    const L = levelsOf(by).sort();
    const rows = L.map(l => {
      const ids = []; v.values.forEach((x, i) => { if (by.values[i] === l && x != null && isFinite(x) && (!gc || (gc.values[i] != null && gc.values[i] !== ''))) ids.push(i); });
      const vals = ids.map(i => v.values[i]), d = ST.describe(vals);
      let lo = NaN, hi = NaN;
      if (gc && ids.length > 2) { const bs = ST.clusterBootstrap(ids.map(i => gc.values[i]), idx => ST.mean(idx.map(j => vals[j])), 400, 3); lo = bs.lo; hi = bs.hi; }
      else if (ids.length > 2) { const se = d.sd / Math.sqrt(d.n); lo = d.mean - 1.96 * se; hi = d.mean + 1.96 * se; }
      return { l, d, lo, hi };
    });
    LAB.lastTable = { file: 'lab_describe.csv', cols: [by.name, 'n', 'mean', 'sd', 'median', 'lo95', 'hi95'], rows: rows.map(r => [r.l, r.d.n, r.d.mean, r.d.sd, r.d.median, r.lo, r.hi]) };
    return `<div class="card stack"><h3>${esc(v.name)} by ${esc(by.name)}</h3>
      ${chartDotCI(rows.map(r => ({ label: r.l, v: r.d.mean, lo: r.lo, hi: r.hi, tip: `<b>${fmt.r(r.d.mean, 3)}</b> mean (n = ${r.d.n})<br>95% CI ${fmt.r(r.lo, 3)} to ${fmt.r(r.hi, 3)}${gc ? ' (cluster bootstrap by ' + esc(gc.name) + ')' : ''}`, color: 'var(--ink-2)' })), { dec: 2, w: 520, title: v.name + ' by ' + by.name })}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>${esc(by.name)}</th><th class="num">n</th><th class="num">Mean</th><th class="num">SD</th><th class="num">Median</th><th class="num">95% CI</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.l)}</td><td class="num">${r.d.n}</td><td class="num">${fmt.r(r.d.mean, 3)}</td><td class="num">${fmt.r(r.d.sd, 3)}</td><td class="num">${fmt.r(r.d.median, 3)}</td><td class="num">${fmt.r(r.lo, 3)} to ${fmt.r(r.hi, 3)}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div>
      <p class="tiny muted">${gc ? `Intervals are percentile intervals from 400 bootstrap resamples of ${esc(gc.name)} (whole groups resampled), which respects repeated observations per group.` : 'Normal-approximation intervals that treat rows as independent; set a grouping variable if rows are nested.'}</p></div>${codeHTML({ analysis: 'describe', file: (ds.file || 'lab_data.csv'), variable: v.name, by: by.name, group: ds.group })}`;
  },
  async compare(ds, form) {
    const vars = $$('#o_vars input:checked', form).map(x => x.value), by = colOf(ds, $('#o_by', form).value);
    const L = levelsOf(by);
    const res = vars.map(vn => { const c = colOf(ds, vn); const groups = L.map(l => c.values.filter((x, i) => by.values[i] === l && x != null && isFinite(x))).filter(g => g.length); const k = ST.kruskal(groups); return { vn, H: k.H, df: k.df, p: k.p, eps: k.epsilon2, means: L.map(l => ST.mean(c.values.filter((x, i) => by.values[i] === l && x != null))) }; });
    const q = ST.padjust(res.map(r => r.p), 'BH'); res.forEach((r, i) => r.q = q[i]);
    LAB.lastTable = { file: 'lab_compare.csv', cols: ['variable', 'H', 'df', 'p', 'q_BH', 'epsilon2'].concat(L.map(l => 'mean_' + l)), rows: res.map(r => [r.vn, r.H, r.df, r.p, r.q, r.eps].concat(r.means)) };
    return `<div class="card stack"><h3>Kruskal–Wallis tests across ${esc(by.name)}</h3>
      ${chartHeat(res.map(r => r.vn), L, (i, j) => res[i].means[j], { labelW: 120, cellW: 56, cellH: 22, headH: 70, labels: v => fmt.r(v, 2), title: 'Means by group', tip: (i, j, v) => `${esc(res[i].vn)}, ${esc(L[j])}: mean ${fmt.r(v, 3)}` })}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Variable</th><th class="num">H</th><th class="num">df</th><th class="num">p</th><th class="num">q (BH)</th><th class="num">ε²</th></tr></thead><tbody>${res.map(r => `<tr><td class="mono small">${esc(r.vn)}</td><td class="num">${fmt.r(r.H, 1)}</td><td class="num">${r.df}</td><td class="num">${fmt.p(r.p)}</td><td class="num">${fmt.p(r.q)}</td><td class="num">${fmt.r(r.eps, 3)}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div>
      <p class="tiny muted">Rank tests treat rows as independent. With several rows per ${esc(ds.group || 'person')}, p values are too small; use the linear mixed model for inference and read these as descriptive. q values control the false discovery rate across the ${res.length} variables.</p></div>${codeHTML({ analysis: 'compare', file: (ds.file || 'lab_data.csv'), variables: vars, by: by.name, group: ds.group })}`;
  },
  async correlate(ds, form) {
    const vars = $$('#o_vars input:checked', form).map(x => x.value), sp = $('#o_meth', form).value === 'Spearman';
    if (vars.length < 2) throw new Error('Choose at least two variables.');
    const cols = vars.map(v => colOf(ds, v).values), pairs = [];
    const R = vars.map(() => vars.map(() => null));
    for (let a = 0; a < vars.length; a++) for (let b = a + 1; b < vars.length; b++) { const x = [], y = []; cols[a].forEach((v, i) => { const w = cols[b][i]; if (v != null && w != null && isFinite(v) && isFinite(w)) { x.push(v); y.push(w); } }); const r = sp ? ST.spearman(x, y) : ST.pearson(x, y); pairs.push({ a: vars[a], b: vars[b], r: r.r, lo: r.lo, hi: r.hi, p: r.p, n: r.n }); R[a][b] = R[b][a] = r.r; }
    const q = ST.padjust(pairs.map(p => p.p), 'BH'); pairs.forEach((p, i) => p.q = q[i]);
    LAB.lastTable = { file: 'lab_correlations.csv', cols: ['a', 'b', 'r', 'lo', 'hi', 'p', 'q_BH', 'n'], rows: pairs.map(p => [p.a, p.b, p.r, p.lo, p.hi, p.p, p.q, p.n]) };
    return `<div class="card stack"><h3>${sp ? 'Spearman' : 'Pearson'} correlations</h3>
      ${chartHeat(vars, vars, (i, j) => i === j ? null : R[i][j], { diverging: true, max: 1, labelW: 120, cellW: 46, cellH: 26, headH: 90, labels: v => fmt.r(v, 2), title: 'Correlation matrix', tip: (i, j, v) => `${esc(vars[i])} × ${esc(vars[j])}: r = ${fmt.r(v, 3)}` })}
      <div class="legend"><span><i class="sw" style="background:var(--div-neg)"></i>negative</span><span><i class="sw" style="background:var(--div-mid)"></i>near zero</span><span><i class="sw" style="background:var(--div-pos)"></i>positive</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pair</th><th class="num">r</th><th class="num">95% CI</th><th class="num">p</th><th class="num">q (BH)</th><th class="num">n</th></tr></thead><tbody>${pairs.map(p => `<tr><td class="mono small">${esc(p.a)} × ${esc(p.b)}</td><td class="num">${fmt.r(p.r, 3)}</td><td class="num">${fmt.r(p.lo, 2)} to ${fmt.r(p.hi, 2)}</td><td class="num">${fmt.p(p.p)}</td><td class="num">${fmt.p(p.q)}</td><td class="num">${p.n}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div><p class="tiny muted">${sp ? 'Spearman intervals use the Fisher transformation as an approximation.' : ''} Rows are treated as independent; nested data make p values too small.</p></div>${codeHTML({ analysis: 'correlate', file: (ds.file || 'lab_data.csv'), variables: vars, corMethod: sp ? 'spearman' : 'pearson', group: ds.group })}`;
  },
  async cooccur(ds, form) {
    const vars = $$('#o_vars input:checked', form).map(x => x.value), thr = +$('#o_thr', form).value;
    if (vars.length < 2) throw new Error('Choose at least two variables.');
    const ok = Array.from({ length: ds.n }, (_, i) => vars.every(v => { const x = colOf(ds, v).values[i]; return x != null && isFinite(x); }));
    const cols = vars.map(v => colOf(ds, v).values.filter((_, i) => ok[i]).map(x => x >= thr ? 1 : 0));
    const P = ST.cooccurrence(cols, vars);
    LAB.lastTable = { file: 'lab_cooccurrence.csv', cols: ['a', 'b', 'n11', 'jaccard', 'phi', 'P(B|A)', 'P(A|B)', 'odds_ratio', 'p', 'q_BH'], rows: P.map(p => [p.a, p.b, p.n11, p.jaccard, p.phi, p.pBgivenA, p.pAgivenB, p.or, p.p, p.q]) };
    const M = (i, j) => { if (i === j) return null; const p = P.find(x => (x.a === vars[i] && x.b === vars[j]) || (x.a === vars[j] && x.b === vars[i])); return p ? p.phi : null; };
    return `<div class="card stack"><h3>Co-occurrence (active when ≥ ${thr})</h3>${chartHeat(vars, vars, M, { diverging: true, max: 1, labelW: 120, cellW: 44, cellH: 24, headH: 90, labels: v => fmt.r(v, 2), title: 'Phi coefficients', tip: (i, j, v) => `${esc(vars[i])} × ${esc(vars[j])}: phi ${fmt.r(v, 3)}` })}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Pair</th><th class="num">Both</th><th class="num">Jaccard</th><th class="num">phi</th><th class="num">P(B|A)</th><th class="num">OR</th><th class="num">q (BH)</th></tr></thead><tbody>${P.sort((a, b) => b.phi - a.phi).map(p => `<tr><td class="mono small">${esc(p.a)} · ${esc(p.b)}</td><td class="num">${p.n11}</td><td class="num">${fmt.r(p.jaccard)}</td><td class="num">${fmt.r(p.phi)}</td><td class="num">${fmt.r(p.pBgivenA)}</td><td class="num">${fmt.r(p.or, 2)}</td><td class="num">${fmt.p(p.q)}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div><p class="tiny muted">Fisher exact tests treat rows as independent; co-occurrence within the same people is not separated from between-person differences.</p></div>${codeHTML({ analysis: 'cooccur', file: (ds.file || 'lab_data.csv'), variables: vars, threshold: thr, group: ds.group })}`;
  },
  async logit(ds, form) { return modelLogit(ds, form, false); },
  async glmm(ds, form) { return modelLogit(ds, form, true); },
  async mlogit(ds, form) {
    const yName = $('#o_y', form).value, preds = $$('#o_x input:checked', form).map(x => x.value);
    if (!preds.length) throw new Error('Choose at least one predictor.');
    const D = buildXY(ds, yName, preds, { standardize: $('#o_std', form).checked });
    const K = D.cls.length; if (K < 3) throw new Error('Use logistic regression for two classes.');
    const X = ST.addIntercept(D.X), names = ['(Intercept)'].concat(D.names);
    const fit = ST.mlogit(X, D.y, K, { names, classNames: D.cls, cluster: D.grouped ? D.g : null });
    const audit = ST.auditDesign({ y: D.y, K, groups: D.grouped ? D.g : null, folds: null, nFeatures: D.names.length, classNames: D.cls }).filter(x => !/folds are not grouped/.test(x.text));
    const spec = { analysis: 'multinomial', file: (ds.file || 'lab_data.csv'), outcome: yName, outcomeType: 'multinomial', predictors: preds, categorical: preds.filter(x => (colOf(ds, x) || {}).type === 'cat'), standardize: $('#o_std', form).checked, group: ds.group };
    const blocks = ((fit.robust && fit.robust.tables) || fit.tables || []).map(t => `<h4 class="small" style="margin-top:10px">${esc(t.cls)} vs ${esc(D.cls[0])}</h4>${coefTable(t.table, { or: 'RRR' })}`).join('');
    return `<div class="card stack"><h3>Multinomial logistic regression of ${esc(yName)}</h3><p class="small soft">Reference class: ${esc(D.cls[0])}. n = ${D.y.length}. ${D.grouped ? `Standard errors clustered by ${esc(ds.group)} (CR1).` : 'Model-based standard errors.'} ${fit.converged === false ? '<b>Did not converge.</b>' : ''}</p>${auditHTML(audit)}${blocks || `<pre class="code">${esc(JSON.stringify(fit, null, 1).slice(0, 3000))}</pre>`}</div>${codeHTML(spec)}`;
  },
  async lmm(ds, form) {
    const yName = $('#o_y', form).value, preds = $$('#o_x input:checked', form).map(x => x.value);
    if (!ds.group) throw new Error('Choose a grouping variable for the random intercept.');
    const D = buildXY(ds, yName, preds, {});
    const X = ST.addIntercept(D.X), names = ['(Intercept)'].concat(D.names);
    const fit = ST.lmm(X, D.y, D.g, { names });
    const icc = ST.icc1(D.y, D.g);
    const spec = { analysis: 'lmm', file: (ds.file || 'lab_data.csv'), outcome: yName, outcomeType: 'continuous', predictors: preds, categorical: preds.filter(x => (colOf(ds, x) || {}).type === 'cat'), standardize: false, group: ds.group };
    const nG = new Set(D.g).size, per = D.y.length / nG, audit = [];
    audit.push({ level: nG < 10 ? 'warning' : 'info', text: `${nG} groups in ${ds.group}, ${fmt.r(per, 1)} rows per group on average.${nG < 10 ? ' With fewer than about 10 groups the random-intercept variance is poorly estimated.' : ''}` });
    if (icc.icc > 0.05) audit.push({ level: 'info', text: `ICC ${fmt.r(icc.icc, 2)}: rows within a ${ds.group} are correlated (design effect ${fmt.r(icc.designEffect, 1)}); tests that ignore ${ds.group} would overstate precision.` });
    preds.forEach(p => { const c = colOf(ds, p); if (c && c.type === 'cat') { const within = new Map(); D.keep.forEach((i, j) => { const g = D.g[j]; if (!within.has(g)) within.set(g, new Set()); within.get(g).add(c.values[i]); }); const wv = [...within.values()].filter(s => s.size > 1).length; audit.push({ level: 'info', text: `${p} varies within ${wv} of ${nG} groups (${wv ? 'within- and between-group comparisons' : 'between-group comparison only'}).` }); } });
    return `<div class="card stack"><h3>Linear mixed model: ${esc(yName)}</h3>${auditHTML(audit)}<p class="small soft">${esc(fit.method)}; random intercept for ${esc(ds.group)} (${new Set(D.g).size} groups); n = ${D.y.length}. Random-intercept variance ${fmt.r(fit.tau2, 4)}, residual variance ${fmt.r(fit.sigma2, 4)}. Unconditional ICC ${fmt.r(icc.icc, 3)}; design effect ${fmt.r(icc.designEffect, 2)}.</p>
      ${coefTable(fit.table)}<p class="tiny muted">Fixed-effect tests use t statistics with df = N − p, a liberal approximation; the R code uses Satterthwaite degrees of freedom.</p></div>${codeHTML(spec)}`;
  },
  async cv(ds, form, prog) {
    const yName = $('#o_y', form).value, sets = $$('#o_sets input:checked', form).map(x => x.value), single = $('#o_single', form).value, model = $('#o_model', form).value;
    const K0 = +$('#o_k', form).value || 5, bal = $('#o_bal', form).checked, B = +$('#o_B', form).value || 0;
    if (!sets.length) throw new Error('Choose at least one feature set.');
    const out = [];
    let firstSpec = null, base = null, groupsUsed = null, cls = null;
    for (const s of sets) {
      prog.textContent = 'Cross-validating: ' + s; await tick();
      const fs = featureSet(ds, s, single);
      const D = buildXY(ds, yName, fs.preds, { interSubset: fs.inter });
      cls = D.cls; const K = cls.length;
      const folds = D.grouped ? ST.groupKFold(D.g, K0) : ST.stratifiedKFold(D.y, K0, 1);
      const spec = { X: D.X, y: D.y, K, folds, model, classWeight: bal ? 'balanced' : null, ridge: 1e-4 };
      const r = ST.crossValidate(spec);
      if (!base) { base = ST.crossValidate(Object.assign({}, spec, { model: 'majority', classWeight: null })); groupsUsed = D.grouped ? new Set(D.g).size : null; }
      out.push({ s, nf: D.names.length, r, D, spec });
      if (!firstSpec) firstSpec = { spec, D };
    }
    let perm = null;
    if (B > 0) { prog.textContent = `Permutation test (${B} permutations)…`; await tick(); perm = ST.permutationTest(firstSpec.spec, B, 13); }
    const best = out.slice().sort((a, b) => b.r.pooled.balancedAccuracy - a.r.pooled.balancedAccuracy)[0];
    const audit = ST.auditDesign({ y: firstSpec.D.y, K: cls.length, groups: firstSpec.D.grouped ? firstSpec.D.g : null, folds: firstSpec.spec.folds, nFeatures: Math.max(...out.map(o => o.nf)), classNames: cls });
    LAB.lastTable = { file: 'lab_cv.csv', cols: ['feature_set', 'n_features', 'balanced_accuracy', 'fold_sd', 'macro_f1', 'auc', 'log_loss'], rows: out.map(o => [o.s, o.nf, o.r.pooled.balancedAccuracy, o.r.foldMean.balancedAccuracySD, o.r.pooled.macroF1, o.r.pooled.auc, o.r.pooled.logLoss]) };
    const chance = 1 / cls.length;
    const conf = best.r.pooled.confusion;
    return `<div class="card stack"><h3>Grouped cross-validation: predicting ${esc(yName)}</h3>${auditHTML(audit)}
      ${chartBarH(out.map(o => ({ label: o.s, v: o.r.pooled.balancedAccuracy, tip: `<b>${fmt.r(o.r.pooled.balancedAccuracy, 3)}</b> balanced accuracy<br>fold SD ${fmt.r(o.r.foldMean.balancedAccuracySD, 3)} · macro-F1 ${fmt.r(o.r.pooled.macroF1, 3)} · AUC ${fmt.r(o.r.pooled.auc, 3)}<br>${o.nf} features`, color: 'var(--ink-2)' })), { min: 0, max: 1, ref: chance, refLabel: 'chance ' + fmt.r(chance, 2), dec: 2, w: 600, labelW: 230, title: 'Balanced accuracy by feature set' })}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Feature set</th><th class="num">Features</th><th class="num">Balanced accuracy</th><th class="num">Fold SD</th><th class="num">Macro-F1</th><th class="num">AUC (macro OvR)</th><th class="num">Log loss</th></tr></thead><tbody>
      ${out.map(o => `<tr><td>${esc(o.s)}</td><td class="num">${o.nf}</td><td class="num">${fmt.r(o.r.pooled.balancedAccuracy, 3)}</td><td class="num">${fmt.r(o.r.foldMean.balancedAccuracySD, 3)}</td><td class="num">${fmt.r(o.r.pooled.macroF1, 3)}</td><td class="num">${fmt.r(o.r.pooled.auc, 3)}</td><td class="num">${fmt.r(o.r.pooled.logLoss, 3)}</td></tr>`).join('')}
      <tr><td class="muted">Majority class (baseline)</td><td class="num">0</td><td class="num">${fmt.r(base.pooled.balancedAccuracy, 3)}</td><td></td><td class="num">${fmt.r(base.pooled.macroF1, 3)}</td><td></td><td></td></tr></tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div>
      ${perm ? `<p class="small">Permutation test for “${esc(sets[0])}”: observed balanced accuracy ${fmt.r(perm.observed, 3)}, permutation mean ${fmt.r(ST.mean(perm.distribution), 3)}, 95th percentile ${fmt.r(ST.quantile(perm.distribution, .95), 3)}, p = ${fmt.r(perm.p, 3)} (B = ${perm.B}). Labels were permuted across rows.</p>` : ''}
      <h4 class="small">Confusion matrix for “${esc(best.s)}” (rows: true, columns: predicted)</h4>
      ${chartHeat(cls, cls, (i, j) => conf[i][j] / Math.max(1, conf[i].reduce((s, v) => s + v, 0)), { max: 1, labelW: 90, cellW: 54, cellH: 26, headH: 66, labels: v => fmt.pct(v, 0), title: 'Confusion matrix', tip: (i, j, v) => `true ${esc(cls[i])}, predicted ${esc(cls[j])}: ${conf[i][j]} (${fmt.pct(v, 1)} of row)` })}
      <p class="small soft">Per-class recall: ${best.r.pooled.perClass.map((p, k) => `${esc(cls[k])} ${fmt.r(p.recall, 2)}`).join(', ')}.</p>
      ${best.r.warnings.length ? `<div class="audit">${best.r.warnings.map(w => `<div class="wn">${esc(w)}</div>`).join('')}</div>` : ''}
      <div class="note warn small">Predictive accuracy is not psychological validity. A model that predicts these labels recovers whatever distinguishes them in these data (instructions, situations, a coder's or detector's conventions, who took part), not necessarily what anyone felt.</div></div>
      ${codeHTML({ analysis: 'cv', file: (ds.file || 'lab_data.csv'), outcome: yName, outcomeType: 'multinomial', featureSets: sets.map(s => { const fs = featureSet(ds, s, single); return { name: s, predictors: fs.preds, interactions: fs.inter ? pairsOf(fs.inter) : [] }; }), group: ds.group, folds: K0, classWeight: bal ? 'balanced' : null, model, permutations: B, seed: 1 })}`;
  },
  async transfer(ds, form, prog) {
    const yName = $('#o_y', form).value, sets = $$('#o_sets input:checked', form).map(x => x.value), single = $('#o_single', form).value, model = $('#o_model', form).value;
    const mode = $('#o_mode', form).value;
    if (!sets.length) throw new Error('Choose at least one feature set.');
    let A0, B0, labA, labB, audit = [];
    if (mode === 'file') {
      const d2 = LAB.ds2; if (!d2) throw new Error('Load the second file first.');
      const need = uniq([yName].concat(...sets.map(s => featureSet(ds, s, single).preds)));
      const miss = need.filter(c => !colOf(d2, c)); if (miss.length) throw new Error('The second file lacks: ' + miss.slice(0, 6).join(', ') + (miss.length > 6 ? '…' : ''));
      const both = { name: ds.name + ' + ' + d2.name, n: ds.n + d2.n, group: ds.group && colOf(d2, ds.group) ? ds.group : null,
        cols: need.concat(ds.group && colOf(d2, ds.group) ? [ds.group] : []).map(c => { const a = colOf(ds, c), b = colOf(d2, c); return { name: c, type: a.type === 'cat' || b.type === 'cat' ? 'cat' : 'num', values: a.values.concat(b.values).map(v => v == null ? null : (a.type === 'cat' || b.type === 'cat' ? String(v) : v)) }; }) };
      both.cols.push({ name: '__part', type: 'cat', values: Array(ds.n).fill('A').concat(Array(d2.n).fill('B')) });
      A0 = both; labA = ds.name; labB = d2.name;
      const cy = colOf(both, yName), la = new Set(cy.values.slice(0, ds.n).filter(v => v != null)), lb = new Set(cy.values.slice(ds.n).filter(v => v != null));
      const onlyA = [...la].filter(x => !lb.has(x)), onlyB = [...lb].filter(x => !la.has(x));
      if (onlyA.length || onlyB.length) audit.push({ level: 'warning', text: `Outcome levels differ between files (only in the first: ${onlyA.join(', ') || 'none'}; only in the second: ${onlyB.join(', ') || 'none'}). A model cannot predict a class it never saw.` });
      if (both.group) { const g = colOf(both, both.group).values, ga = new Set(g.slice(0, ds.n)), gb = new Set(g.slice(ds.n)), ov = [...ga].filter(x => gb.has(x)).length; audit.push({ level: ov ? 'warning' : 'info', text: ov ? `${ov} value(s) of ${both.group} appear in both files: these people (or videos) are on both sides.` : `No ${both.group} appears in both files.` }); }
      B0 = '__part';
    } else {
      const sv = colOf(ds, $('#o_split', form).value), lev = $('#o_lev', form).value; if (!sv) throw new Error('Choose a split variable.');
      A0 = ds; B0 = sv.name; labA = `${sv.name} = ${lev}`; labB = `other ${sv.name}`;
      if (ds.group) { const g = colOf(ds, ds.group).values, ga = new Set(), gb = new Set(); sv.values.forEach((v, i) => (v === lev ? ga : gb).add(g[i])); const ov = [...ga].filter(x => gb.has(x)).length;
        audit.push({ level: ov ? 'warning' : 'info', text: ov ? `${ov} of ${new Set(g).size} ${ds.group} values appear on both sides of the split: this tests transfer across ${sv.name}, not to new ${ds.group}s.` : `No ${ds.group} appears on both sides of the split.` }); }
      A0._lev = lev;
    }
    const out = [];
    for (const s of sets) {
      prog.textContent = 'Fitting: ' + s; await tick();
      const part = colOf(A0, B0).values;
      const fs = featureSet(ds, s, single), D = buildXY(A0, yName, fs.preds, { interSubset: fs.inter, noGroup: true, extraValid: i => part[i] != null && part[i] !== '' });
      const K = D.cls.length;
      const sideA = i => mode === 'file' ? part[i] === 'A' : part[i] === A0._lev;
      const a = Int32Array.from(D.keep.map(i => sideA(i) ? 0 : 1)); a.k = 2;   // fold 0 = side A, fold 1 = side B
      const r = ST.crossValidate({ X: D.X, y: D.y, K, folds: a, model, classWeight: 'balanced', ridge: 1e-4 });
      const f1 = r.perFold.find(p => p.fold === 1), f2 = r.perFold.find(p => p.fold === 2); // fold 1 tested = side A held out (trained on B)
      out.push({ s, aToB: f2 && f2.balancedAccuracy, bToA: f1 && f1.balancedAccuracy, nA: a.filter(x => x === 0).length, nB: a.filter(x => x === 1).length });
    }
    LAB.lastTable = { file: 'lab_transfer.csv', cols: ['feature_set', 'train_' + labA + '_test_' + labB, 'train_' + labB + '_test_' + labA], rows: out.map(o => [o.s, o.aToB, o.bToA]) };
    const k = levelsOf(colOf(A0, yName)).length || 1;
    return `<div class="card stack"><h3>Transfer: ${esc(labA)} ↔ ${esc(labB)}</h3>${auditHTML(audit)}<p class="small soft">Each model is trained on one part and tested on the other, in both directions (${fmt.n(out[0].nA)} and ${fmt.n(out[0].nB)} rows). A large drop compared with cross-validation within the data means the patterns do not transfer.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Feature set</th><th class="num">Train ${esc(labA)} → test ${esc(labB)}</th><th class="num">Train ${esc(labB)} → test ${esc(labA)}</th></tr></thead><tbody>${out.map(o => `<tr><td>${esc(o.s)}</td><td class="num">${fmt.r(o.aToB, 3)}</td><td class="num">${fmt.r(o.bToA, 3)}</td></tr>`).join('')}</tbody></table></div>
      <div class="row"><button class="btn ghost small" data-dl="1">Download table</button></div><p class="tiny muted">Balanced accuracy; chance is ${fmt.r(1 / k, 2)}.</p></div>
      ${mode === 'file' ? '' : codeHTML({ analysis: 'transfer', file: ds.file || 'lab_data.csv', outcome: yName, outcomeType: 'multinomial', featureSets: sets.map(s => { const fs = featureSet(ds, s, single); return { name: s, predictors: fs.preds, interactions: fs.inter ? pairsOf(fs.inter) : [] }; }), split: B0, trainLevel: A0._lev, classWeight: 'balanced', model })}`;
  }
};
async function modelLogit(ds, form, mixed) {
  const yName = $('#o_y', form).value, pos = $('#o_pos', form).value, preds = $$('#o_x input:checked', form).map(x => x.value);
  if (!preds.length) throw new Error('Choose at least one predictor.');
  const yc = colOf(ds, yName);
  const D = buildXY(ds, yName, preds, { binaryPos: yc.type === 'cat' ? pos : null, interactions: $('#o_int', form).checked, standardize: $('#o_std', form).checked });
  if (yc.type !== 'cat' && D.y.some(v => v !== 0 && v !== 1)) throw new Error('A numeric outcome must be coded 0/1.');
  const X = ST.addIntercept(D.X), names = ['(Intercept)'].concat(D.names);
  const events = D.y.filter(v => v === 1).length, nonev = D.y.length - events;
  const audit = [];
  const epv = Math.min(events, nonev) / Math.max(1, D.names.length);
  if (epv < 10) audit.push({ level: 'warning', text: `Events per variable ${epv.toFixed(1)} (${Math.min(events, nonev)} in the smaller outcome group, ${D.names.length} predictors). Below about 10, estimates are unstable; use fewer predictors or Firth estimation.` });
  if (D.grouped) audit.push({ level: 'info', text: `${new Set(D.g).size} groups in ${esc(ds.group)}; ${mixed ? 'random intercept per group' : 'cluster-robust (CR1) standard errors'}.` });
  else audit.push({ level: 'warning', text: 'No grouping variable: if rows are nested in people or videos, standard errors are too small.' });
  let fit, method;
  if (mixed) {
    if (!D.grouped) throw new Error('Choose a grouping variable for the random intercept.');
    fit = ST.glmmLogit(X, D.y, D.g, { names, nAGQ: 7 }); method = fit.method;
  } else {
    const pen = $('#o_pen', form).value;
    fit = ST.logit(X, D.y, { names, cluster: D.grouped ? D.g : null, firth: pen === 'firth', ridge: pen === 'ridge' ? 1 : 0 });
    method = 'Logistic regression' + (pen === 'firth' ? ' (Firth)' : pen === 'ridge' ? ' (ridge, λ = 1)' : '') + (D.grouped ? `, standard errors clustered by ${ds.group}` : '');
    if (fit.separation) audit.push({ level: 'warning', text: fit.separation });
    if (fit.converged === false) audit.push({ level: 'error', text: 'The model did not converge.' });
  }
  const tab = (fit.robust && fit.robust.table) || fit.table;
  const spec = { analysis: mixed ? 'glmm' : 'binary', file: (ds.file || 'lab_data.csv'), outcome: yName, outcomeType: 'binary', positive: yc.type === 'cat' ? pos : null, predictors: preds, categorical: preds.filter(x => (colOf(ds, x) || {}).type === 'cat'), standardize: $('#o_std', form).checked, interactions: D.inter, method: mixed ? 'ml' : ($('#o_pen', form).value || 'ml'), group: ds.group };
  return `<div class="card stack"><h3>${mixed ? 'Logistic mixed model' : 'Logistic regression'}: ${esc(yName)}${yc.type === 'cat' ? ' = ' + esc(pos) : ''}</h3>
    <p class="small soft">${esc(method)}. n = ${D.y.length}; ${events} events. ${mixed && fit.sigma != null ? `Random-intercept SD ${fmt.r(fit.sigma, 3)}.` : ''} ${fit.aic != null ? 'AIC ' + fmt.r(fit.aic, 1) + '.' : ''}</p>${auditHTML(audit)}
    ${chartForest(tab.filter(t => t.term !== '(Intercept)').map(t => ({ label: t.term, est: Math.exp(t.est), lo: Math.exp(t.lo), hi: Math.exp(t.hi), tip: `${esc(t.term)}: OR ${fmt.r(Math.exp(t.est), 2)} (${fmt.r(Math.exp(t.lo), 2)} to ${fmt.r(Math.exp(t.hi), 2)}), p ${fmt.p(t.p)}` })), { w: 600, labelW: 170 })}
    ${coefTable(tab, { or: 'OR' })}
    <p class="tiny muted">${$('#o_std', form).checked ? 'Numeric predictors were standardized: odds ratios are per standard deviation. ' : ''}An odds ratio describes association in these data; it does not show that the action signals the state.</p></div>${codeHTML(spec)}`;
}
function pairsOf(L) { const P = []; for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) P.push([L[a], L[b]]); return P; }
/* reference results computed in Python for a study-provided dataset (secondary.json → reference[id]) */
function refHTML(d, ref) {
  const sets = Object.entries(ref.sets || {}).map(([k, v]) => ({ label: k, v: v.bacc, tip: `<b>${fmt.r(v.bacc, 3)}</b> balanced accuracy · macro-F1 ${fmt.r(v.f1, 3)}`, color: 'var(--ink-2)' }));
  return `<div class="stack"><p class="small soft">${typeBadge('SA')} ${SEC.cite(d)}. ${esc(ref.design || '')}</p>
    ${sets.length ? chartBarH(sets, { min: 0, max: 1, ref: ref.chance, refLabel: 'chance', dec: 2, w: 560, labelW: 260, title: 'Reference balanced accuracy' }) : ''}
    ${ref.permutation ? `<p class="small soft">Permutation test (${esc(ref.permutation.set)}): observed ${fmt.r(ref.permutation.observed, 3)}, permutation 95th percentile ${fmt.r(ref.permutation.null95, 3)}, p = ${fmt.r(ref.permutation.p, 3)} (B = ${ref.permutation.B}).</p>` : ''}
    ${(ref.notes || []).map(n => `<p class="tiny muted">${esc(n)}</p>`).join('')}</div>`;
}

/* ---- app/js/timeline.js ---- */
/* Timeline: detector output as separate measurement tracks, other modalities on their own tracks, and an evidence panel per moment. */
'use strict';
const TL = { src: null, thr: 0.5, smooth: 1, cur: 0, selAU: null, onlyActive: false, text: null, file: null, mods: [] };
const fmtT = v => (v == null || !isFinite(v)) ? '–' : (+v).toFixed(2);
/* A synthetic series for trying the interface. It is generated here, is not data from any person or study, and carries no evidence. */
function syntheticSource() {
  const fps = 30, n = 12 * fps, t = Array.from({ length: n }, (_, i) => i / fps);
  const bump = (x, a, b, h) => x < a || x > b ? 0 : h * Math.sin(Math.PI * (x - a) / (b - a)) ** 2;
  const wob = (x, k) => 0.04 * Math.sin(2.3 * x + k) + 0.03 * Math.sin(7.1 * x + 2 * k);
  const clip = v => Math.max(0, Math.min(1, v));
  const aus = {
    '12': t.map(x => clip(bump(x, 1.5, 6.5, 0.85) + wob(x, 1))), '6': t.map(x => clip(bump(x, 2.2, 5.6, 0.65) + wob(x, 2))),
    '25': t.map(x => clip((x > 7 && x < 11 ? 0.45 + 0.35 * Math.abs(Math.sin(9 * x)) : 0.05) + wob(x, 3))),
    '4': t.map(x => clip(bump(x, 8.4, 10.2, 0.7) + wob(x, 4))), '1': t.map(x => clip(bump(x, 7.6, 8.8, 0.55) + wob(x, 5))),
    '2': t.map(x => clip(bump(x, 7.7, 8.7, 0.5) + wob(x, 6))), '17': t.map(x => clip(bump(x, 9.5, 11.2, 0.5) + wob(x, 7)))
  };
  const vt = Array.from({ length: 120 }, (_, i) => (i + 0.5) / 10);
  return { kind: 'synthetic', name: 'Synthetic example', label: 'Generated in your browser to try the interface; not data from any person or study', t, aus, active: {}, approximate: false,
    notes: ['Every value here is synthetic. Use it to see how the tracks, the moment panel and the evidence work; the evidence shown comes from the evidence base, not from these values.'],
    other: { 'Voice level (synthetic, dBFS)': { t: vt, v: vt.map(x => x > 7 && x < 11 ? -28 - 6 * Math.abs(Math.sin(5 * x)) : -55), unit: 'dBFS' } }, fps };
}
function fileSource(text, name, group) {
  const P = AUAdapters.parse(text, { fps: TL.fps || 30, group });
  const other = Object.fromEntries(Object.entries(P.other).map(([k, v]) => [k, { t: P.t, v, unit: '' }]));
  return { kind: 'file', name, label: P.label, t: P.t, aus: P.aus, active: P.active, approximate: P.approximate, notes: P.notes, other, fps: P.fps, groups: P.groups, binary: P.binary };
}
function readModality(text, name) {
  const rows = AUAdapters.parseCSV(text), head = rows[0].map(h => String(h).trim());
  const ti = head.findIndex(h => /^(time|time_s|timestamp|t|seconds|sec|time \(s\))$/i.test(h));
  if (ti < 0) throw new Error('No time column (time, time_s, timestamp, seconds) in ' + name + '.');
  let tt = rows.slice(1).map(r => +r[ti]);
  if (/timestamp/i.test(head[ti]) && Math.max(...tt.filter(isFinite)) > 3600) tt = tt.map(v => v / 1000);
  const out = {};
  head.forEach((h, j) => { if (j === ti) return; const v = rows.slice(1).map(r => r[j] === '' || r[j] == null ? NaN : +r[j]); if (v.filter(isFinite).length > 1) out[h + ' (' + name + ')'] = { t: tt, v, unit: '' }; });
  if (!Object.keys(out).length) throw new Error('No numeric columns besides time in ' + name + '.');
  return out;
}
VIEWS.timeline = function (main) {
  main.innerHTML = `<div class="wrap stack-l"><section class="view-head"><div class="stack"><h1>Timeline</h1>
    <p class="lead">Each track is a measurement, and face, voice and any other modality stay on separate tracks. Select a moment to see the best guess for the active actions and the evidence behind it.</p></div></section>
    <div class="card stack" style="gap:16px">
      <div class="row" style="gap:10px"><label class="btn" style="cursor:pointer">Load detector CSV<input type="file" id="tfile" accept=".csv,.tsv,.txt" hidden></label>
      <label class="btn ghost" style="cursor:pointer">Add another modality<input type="file" id="tmod" accept=".csv,.tsv,.txt" hidden></label>
      <button class="btn ghost" id="tsyn">Try a synthetic example</button><span class="small muted">Another modality is any CSV with a time column, such as voice or physiology.</span></div>
      <div class="toolbar">
      <label class="field" id="tgrpw" hidden>Face, person or video<select id="tgrp"></select></label>
      <label class="field">Frame rate if there is no time column<input type="number" id="tfps" value="30" min="1" max="240" style="width:96px"></label>
      <label class="field"><span>Active at or above <output id="tthrv" class="num-t">0.50</output></span><input type="range" id="tthr" min="0.05" max="0.95" step="0.05" value="0.5" style="width:180px"></label>
      <label class="field">Smoothing<select id="tsm"><option value="1">None</option><option value="3">Median of 3</option><option value="5">Median of 5</option><option value="9">Median of 9</option></select></label>
      <label class="check"><input type="checkbox" id="tonly"> Only actions that become active</label></div></div>
    <div id="tsrc" class="small soft"></div>
    <div class="split"><div class="stack minw0"><div id="tlanes"></div><div id="tevents"></div></div><aside class="panel"><div class="tl-facecard"><div id="tlface"></div><p class="facecap" id="tlfcap">The face replays the detector's action values at the selected moment.</p></div><div id="tpanel"></div></aside></div></div>`;
  A.face = FaceMesh.mount($('#tlface', main), [], { vectors: false, title: 'Detector values at the selected moment' });
  const draw = () => drawTimeline(main);
  const setGroups = () => { const S = TL.src, w = $('#tgrpw', main), s = $('#tgrp', main);
    if (S && S.groups && S.groups.values.length > 1) { w.hidden = false; s.innerHTML = S.groups.values.map(v => `<option value="${esc(v.key)}"${v.key === S.groups.selected ? ' selected' : ''}>${esc(S.groups.column)} ${esc(v.key)} (${v.n} rows)</option>`).join(''); }
    else w.hidden = true; };
  const withMods = S => { (TL.mods || []).forEach(m => Object.assign(S.other, m)); return S; };
  $('#tthr', main).oninput = e => { TL.thr = +e.target.value; $('#tthrv', main).textContent = TL.thr.toFixed(2); draw(); };
  $('#tsm', main).onchange = e => { TL.smooth = +e.target.value; draw(); };
  $('#tonly', main).onchange = e => { TL.onlyActive = e.target.checked; draw(); };
  $('#tfps', main).onchange = e => { TL.fps = +e.target.value || 30; };
  $('#tsyn', main).onclick = () => { TL.src = withMods(syntheticSource()); TL.text = null; TL.cur = 4; TL.selAU = null; setGroups(); draw(); };
  $('#tfile', main).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const text = await f.text(); TL.text = text; TL.file = f.name; TL.src = withMods(fileSource(text, f.name));
      TL.cur = TL.src.t[0] || 0; TL.selAU = null; setGroups(); draw(); toast(`Read ${TL.src.t.length} frames and ${Object.keys(TL.src.aus).length} actions.`);
    } catch (err) { toast(err.message, 6000); }
  };
  $('#tgrp', main).onchange = e => { if (!TL.text) return; TL.src = withMods(fileSource(TL.text, TL.file, e.target.value)); TL.cur = TL.src.t[0] || 0; setGroups(); draw(); };
  $('#tmod', main).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const m = readModality(await f.text(), f.name); TL.mods.push(m); if (TL.src) { Object.assign(TL.src.other, m); draw(); } toast(`Added ${pl(Object.keys(m).length, 'track')} from ${f.name}.`); }
    catch (err) { toast(err.message, 6000); }
  };
  if (TL.src) { setGroups(); draw(); }
  else $('#tlanes', main).innerHTML = `<div class="empty">Load a detector's CSV (OpenFace, Py-Feat, FaceReader, AFFDEX, MediaPipe, or any file with columns such as AU12), or open the synthetic example to try the interface. Files stay in your browser.</div>`;
};
function seriesFor(code) { const v = TL.src.aus[code]; return TL.smooth > 1 ? AUAdapters.smooth(v, TL.smooth) : v; }
function activeAt(code, i) { const pres = TL.src.active[code]; if (pres) return pres[i] === 1; const v = seriesFor(code); return v[i] >= TL.thr; }
function nearestIndex(t) { const T = TL.src.t; let b = 0; for (let i = 1; i < T.length; i++) if (Math.abs(T[i] - t) < Math.abs(T[b] - t)) b = i; return b; }
function drawTimeline(main) {
  const S = TL.src; if (!S) return;
  const T = S.t, t0 = Math.min(T[0] || 0, ...Object.values(S.other || {}).map(o => o.t[0]).filter(isFinite)), t1 = Math.max(T[T.length - 1] || 1, t0 + 1e-6, ...Object.values(S.other || {}).map(o => o.t[o.t.length - 1]).filter(isFinite));
  const X = t => 1000 * (t - t0) / (t1 - t0);
  $('#tsrc', main).innerHTML = `${S.kind === 'synthetic' ? '<span class="hyp">synthetic</span> ' : ''}<b>${esc(S.name)}</b>: ${esc(String(S.label).replace(/\.$/, ''))}; ${T.length} frames${S.approximate ? '; <b>approximate AU mapping</b>' : ''}.${S.notes && S.notes.length ? ' ' + S.notes.map(esc).join(' ') : ''}`;
  let codes = Object.keys(S.aus).sort((a, b) => +a - +b);
  if (TL.onlyActive) codes = codes.filter(c => T.some((_, i) => activeAt(c, i)));
  const lane = (name, sub, inner, attrs, btn) => `<div class="tl-lane"${attrs || ''}><div class="tl-name"${btn ? ` role="button" tabindex="0" aria-label="${esc(btn)}"` : ''}>${name}${sub ? `<span>${sub}</span>` : ''}</div><div class="tl-plot">${inner}</div></div>`;
  const auLane = c => {
    const v = seriesFor(c); let area = `M${X(T[0])} 40`, line = '';
    v.forEach((y, i) => { const yy = isFinite(y) ? 40 - 36 * y : 40; area += ` L${X(T[i]).toFixed(1)} ${yy.toFixed(1)}`; line += `${i ? 'L' : 'M'}${X(T[i]).toFixed(1)} ${yy.toFixed(1)} `; });
    area += ` L${X(T[T.length - 1])} 40 Z`;
    let act = ''; let s0 = null;
    for (let i = 0; i <= T.length; i++) { const on = i < T.length && activeAt(c, i); if (on && s0 == null) s0 = i; if (!on && s0 != null) { const xa = X(T[s0]), xb = i < T.length ? X(T[i]) : 1000; act += `<rect x="${xa}" y="0" width="${Math.max(2, xb - xa)}" height="40" fill="var(--ink)" fill-opacity=".10"/>`; s0 = null; } }
    const thrY = 40 - 36 * TL.thr;
    const svg = `<svg viewBox="0 0 1000 40" preserveAspectRatio="none" height="40" data-au="${c}" tabindex="0" role="slider" aria-label="AU${c} over time; arrow keys move the selected moment" aria-valuemin="${fmtT(t0)}" aria-valuemax="${fmtT(t1)}" aria-valuenow="${fmtT(TL.cur)}">${act}<path d="${area}" fill="var(--ink)" fill-opacity=".10"/><path d="${line}" fill="none" stroke="var(--ink-2)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${S.active[c] ? '' : `<line x1="0" x2="1000" y1="${thrY}" y2="${thrY}" stroke="var(--rule-2)" stroke-width="1" vector-effect="non-scaling-stroke"/>`}<line class="cur" x1="${X(TL.cur)}" x2="${X(TL.cur)}" y1="0" y2="40" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
    return lane(`<b>AU${c}</b>`, esc(auName(c)), svg, ` data-lane="${c}"${TL.selAU === c ? ' style="background:var(--sunk)"' : ''}`, `Select AU${c} ${auName(c)}`);
  };
  const otherLane = (name, o) => {
    const v = o.v.filter(isFinite); if (!v.length) return '';
    const mn = Math.min(...v), mx = Math.max(...v), y = val => isFinite(val) ? 38 - 34 * (val - mn) / ((mx - mn) || 1) : 38;
    let line = ''; o.t.forEach((tt, i) => { line += `${i ? 'L' : 'M'}${X(tt).toFixed(1)} ${y(o.v[i]).toFixed(1)} `; });
    return lane(`<b>${esc(name)}</b>`, `${fmt.r(mn, 1)} to ${fmt.r(mx, 1)}${o.unit ? ' ' + esc(o.unit) : ''}`, `<svg viewBox="0 0 1000 40" preserveAspectRatio="none" height="40" data-other="${esc(name)}" tabindex="0" role="slider" aria-label="${esc(name)} over time; arrow keys move the selected moment" aria-valuenow="${fmtT(TL.cur)}"><path d="${line}" fill="none" stroke="var(--s-other)" stroke-width="1.5" vector-effect="non-scaling-stroke"/><line class="cur" x1="${X(TL.cur)}" x2="${X(TL.cur)}" y1="0" y2="40" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`);
  };
  let html = `<div class="tl"><div class="tl-group">Face: detector measurements for ${codes.length} ${codes.length === 1 ? 'action' : 'actions'}</div>${codes.map(auLane).join('') || '<div class="empty" style="margin:8px">No action becomes active at this threshold.</div>'}`;
  const oth = Object.entries(S.other || {});
  if (oth.length) html += `<div class="tl-group">Other modalities and signals: measurements, not interpreted here</div>${oth.map(([k, o]) => otherLane(k, o)).join('')}`;
  html += `<div style="display:grid;grid-template-columns:170px 1fr;font-size:13px;font-variant-numeric:tabular-nums;color:var(--ink-3)"><div></div><div style="display:flex;justify-content:space-between;padding:4px 6px"><span>${fmtT(t0)} s</span><span>${fmtT((t0 + t1) / 2)} s</span><span>${fmtT(t1)} s</span></div></div></div>`;
  $('#tlanes', main).innerHTML = html;
  $$('.tl-plot svg', main).forEach(svg => {
    const tAt = ev => { const r = svg.getBoundingClientRect(); return t0 + (t1 - t0) * Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    svg.addEventListener('pointermove', ev => { const t = tAt(ev), i = nearestIndex(t); const a = svg.dataset.au, o = svg.dataset.other;
      if (a) tipShow(ev, `<b>${fmt.r(seriesFor(a)[i], 2)}</b> AU${a} at ${fmtT(S.t[i])} s<br><span class="k">select to inspect this moment</span>`);
      else if (o) { const oo = S.other[o]; let j = 0; oo.t.forEach((x, k) => { if (Math.abs(x - t) < Math.abs(oo.t[j] - t)) j = k; }); tipShow(ev, `<b>${fmt.r(oo.v[j], 1)}</b> ${esc(o)} at ${fmtT(oo.t[j])} s`); } });
    svg.addEventListener('click', ev => { TL.cur = S.t[nearestIndex(tAt(ev))]; if (svg.dataset.au) TL.selAU = svg.dataset.au; drawTimeline(main); });
    svg.addEventListener('keydown', ev => {
      const i = nearestIndex(TL.cur), step = ev.shiftKey ? 10 : 1;
      let j = null; if (ev.key === 'ArrowRight') j = Math.min(S.t.length - 1, i + step); else if (ev.key === 'ArrowLeft') j = Math.max(0, i - step); else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = S.t.length - 1;
      else if ((ev.key === 'Enter' || ev.key === ' ') && svg.dataset.au) { TL.selAU = svg.dataset.au; }
      else return;
      ev.preventDefault(); if (j != null) TL.cur = S.t[j]; const focusAU = svg.dataset.au, focusO = svg.dataset.other; drawTimeline(main);
      const again = focusAU ? $(`.tl-plot svg[data-au="${focusAU}"]`, main) : focusO ? $(`.tl-plot svg[data-other="${CSS.escape(focusO)}"]`, main) : null; if (again) again.focus();
    });
  });
  $$('.tl-name', main).forEach(n => { const go = () => { const l = n.parentElement.dataset.lane; if (l) { TL.selAU = l; drawTimeline(main); const b = $(`.tl-lane[data-lane="${l}"] .tl-name`, main); if (b) b.focus(); } };
    n.onclick = go; n.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } }; });
  drawPanel(main, codes);
  drawEvents(main, codes);
}
function drawPanel(main, codes) {
  const S = TL.src, i = nearestIndex(TL.cur), t = S.t[i];
  const vals = codes.map(c => ({ c, v: seriesFor(c)[i], on: activeAt(c, i) })).sort((a, b) => (b.v || 0) - (a.v || 0));
  const act = vals.filter(x => x.on).map(x => x.c).sort((a, b) => +a - +b);
  const known = act.filter(c => A.kb.aus[c]);
  const R = known.length ? E.readings(A.I, known, { limit: 4 }) : null;
  const sel = TL.selAU && A.kb.aus[TL.selAU];
  const oth = Object.entries(S.other || {}).map(([k, o]) => { let j = 0; o.t.forEach((x, q) => { if (Math.abs(x - t) < Math.abs(o.t[j] - t)) j = q; }); return `${esc(k)}: ${fmt.r(o.v[j], 1)}`; });
  const rd = (L, codes1) => L && L.length ? L.map(x => { const r = x.spont !== undefined ? (x.spont || x.posed) : x; const tag = x.spont !== undefined ? (x.spont ? '' : ' <span class="tiny muted">posed only</span>') : '';
    return `<div class="row" style="justify-content:space-between;gap:6px;padding:3px 0;border-bottom:1px solid var(--rule)"><span class="small">${stateLink(x.state)}${tag} ${r.hypothesis ? '<span class="hyp">untested</span>' : ''}${r.contested ? ' <span class="hyp">contested</span>' : ''}${r.within && !r.jointUnits ? `<br><span class="tiny muted">${r.within.aus.map(a => 'AU' + a).join('+')} reported together: ${r.within.units} sample(s)</span>` : ''}</span>${ladder(r.level, codes1)}</div>`; }).join('') : '<div class="small muted">No evidence in this stream.</div>';
  if (A.face) { const km = {}; codes.forEach(c => { const v = seriesFor(c), x = v[i]; if (x == null || !isFinite(x)) return; let mx = 0; for (let j = 0; j < v.length; j += Math.max(1, Math.floor(v.length / 400))) if (v[j] > mx) mx = v[j];
      const k = Math.max(0, Math.min(1, x / Math.max(1, mx > 1.5 ? 5 : 1))) * 1.5; if (k > 0.06 && A.kb.aus[c]) km[c] = k; }); A.face.set(Object.keys(km), km, 140); }
  $('#tpanel', main).innerHTML = `<div class="card stack">
    <div class="row" style="justify-content:space-between"><h3>At ${fmtT(t)} s</h3><div class="row"><button class="btn ghost small" id="tprev" aria-label="Previous frame">◀</button><button class="btn ghost small" id="tnext" aria-label="Next frame">▶</button></div></div>
    <div><span class="layer-tag l-m">Measurement</span><p class="small" style="margin-top:6px">${act.length ? `Active (≥ ${TL.src.active && Object.keys(TL.src.active).length ? 'presence code' : TL.thr.toFixed(2)}): ${act.map(c => auCode(c)).join(' ')}` : 'No action is active at this moment.'}</p>
      <div class="small soft num-t" style="margin-top:4px">${vals.slice(0, 6).map(x => `AU${x.c} ${fmt.r(x.v, 2)}`).join(', ')}</div>${oth.length ? `<div class="small soft" style="margin-top:4px">Other tracks: ${oth.join(', ')}</div>` : ''}</div>
    ${sel ? `<div><span class="layer-tag l-m">Selected action</span><p class="small" style="margin-top:6px"><a href="#au-${TL.selAU}"><b>AU${TL.selAU} ${esc(sel.name)}</b></a>: ${esc(sel.movement || '')}</p><p class="tiny muted">${esc(sel.detector || '')}</p></div>` : ''}
    <div class="tl-rd">${known.length ? readingHTML(known, { rows: 4, reason: false }) : '<p class="small muted">Select a moment where an action is active.</p>'}</div>
    ${known.length ? `<div class="row"><a class="btn small" href="#combo-${known.join('-')}">All the evidence for this face</a></div>` : ''}
    <p class="tiny muted">A reading of the evidence for the active actions, not a measurement of what the person felt${S.approximate ? '; the AU mapping of this detector is approximate' : ''}. Compare it with the other tracks and the situation.</p>
    <div class="row"><button class="btn ghost small" id="tdlm">Download this moment (JSON)</button></div></div>`;
  const rdEl = $('.tl-rd', main); if (rdEl) wireReading(rdEl);
  $('#tprev', main).onclick = () => { TL.cur = S.t[Math.max(0, i - 1)]; drawTimeline(main); };
  $('#tnext', main).onclick = () => { TL.cur = S.t[Math.min(S.t.length - 1, i + 1)]; drawTimeline(main); };
  $('#tdlm', main).onclick = () => saveFile(`moment_${String(S.name).replace(/\W+/g, '_')}_${fmtT(t)}s.json`, JSON.stringify({
    source: S.name, detector: S.label, time_s: t, threshold: TL.thr, measurement: vals.map(x => ({ au: 'AU' + x.c, value: x.v, active: x.on })),
    bestGuess: known.length ? (G => ({ verdict: (G.verdict || {}).kind, state: G.state, family: (G.verdict || {}).familyLabel, confidence: (G.verdict || {}).confidence, tested: G.tested, observers: G.observers && G.observers.state, beyondEmotion: (G.functions || []).map(f => f.state) }))(E.bestGuess4(A.I, known)) : null,
    association: R ? { actions: known, jointConfigurations: R.joint.exact.length + R.joint.superset.length, production: R.production.map(x => ({ state: x.state, spontaneous: x.spont ? { level: x.spont.levelLabel, untestedCombination: x.spont.hypothesis, contested: x.spont.contested } : null, posed: x.posed ? { level: x.posed.levelLabel, untestedCombination: x.posed.hypothesis, contested: x.posed.contested } : null })), perception: R.perception.map(r => ({ state: r.state, level: r.levelLabel, untestedCombination: r.hypothesis, contested: r.contested })) } : null,
    note: 'The best guess is a reading of the evidence for the active actions, not a measurement of what the person felt. Evidence base version ' + A.kb.meta.version }, null, 1));
}
function drawEvents(main, codes) {
  const S = TL.src, rows = [];
  codes.forEach(c => { const v = seriesFor(c); const ev = S.active[c] ? ST.events(S.active[c], S.t, { threshold: 0.5 }) : ST.events(v, S.t, { threshold: TL.thr }); ev.forEach(e => rows.push([c, e.start, e.end, e.duration, e.peak, e.peakTime])); });
  rows.sort((a, b) => a[1] - b[1]);
  $('#tevents', main).innerHTML = `<div class="stack"><div class="row" style="justify-content:space-between"><h3>Activity events</h3><button class="btn ghost small" id="tdle">Download events (CSV)</button></div>
    ${rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Action</th><th class="num">Onset (s)</th><th class="num">Offset (s)</th><th class="num">Duration (s)</th><th class="num">Peak</th><th class="num">Peak at (s)</th></tr></thead><tbody>${rows.slice(0, 80).map(r => `<tr><td>${auCode(r[0])} <span class="small muted">${esc(auName(r[0]))}</span></td><td class="num">${fmtT(r[1])}</td><td class="num">${fmtT(r[2])}</td><td class="num">${fmtT(r[3])}</td><td class="num">${fmt.r(r[4], 2)}</td><td class="num">${fmtT(r[5])}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No events at this threshold.</div>'}
    <p class="tiny muted">An event is a run of frames at or above the threshold${S.fps && S.fps < 10 ? `; at ${fmt.r(S.fps, 1)} frames per second, onsets and durations are coarse` : ''}. Timing measures are descriptive, not evidence of a state.${S.kind === 'synthetic' ? ' These events come from synthetic values.' : ''}</p></div>`;
  $('#tdle', main).onclick = () => saveFile(`events_${String(S.name).replace(/\W+/g, '_')}.csv`, toCSV(['au', 'onset_s', 'offset_s', 'duration_s', 'peak', 'peak_time_s'], rows.map(r => ['AU' + r[0]].concat(r.slice(1).map(x => +(+x).toFixed(4))))));
}

/* ---- app/js/method.js ---- */
/* Method; application start-up. */
'use strict';
/* the citation line: author from <meta name="author"> in index.html, name from <title>, address from the page itself */
function citeLine(m) {
  const au = ((document.querySelector('meta[name="author"]') || {}).content || '').trim();
  const p = au.split(/\s+/).filter(Boolean);
  const who = p.length > 1 ? p[p.length - 1] + ', ' + p.slice(0, -1).map(x => x[0].toUpperCase() + '.').join(' ') : au;
  const url = /^https?:$/.test(location.protocol) ? location.origin + location.pathname.replace(/index\.html$/, '') : '';
  return `${who ? who + ' (' + String(m.built || '').slice(0, 4) + '). ' : ''}${TITLE} (preview, snapshot of October 2026) [Web application].${url ? ' ' + url : ''}`;
}
VIEWS.method = function (main) {
  const m = A.kb.meta, D = SEC.datasets();
  const DC = [...new Set(D.map(d => d.cite))];
  const rep = (m.repairs || []).map(r => `<li>${esc(r.desc || r)}</li>`).join('');
  main.innerHTML = `<div class="wrap stack-l narrow"><section class="stack"><h1>How it was built</h1>
    <p class="lead">This tool combines a coded evidence base from logged literature searches (structured, but not yet a systematic review), findings checked against their sources${D.length ? ', and secondary analyses of AU data that studies released' : ''}. Each statement is labelled with the kind of evidence behind it. No video or images were analysed to build the evidence base.</p></section>
  <section class="stack"><h2>Sources</h2><dl class="kv">
    <dt>Evidence base</dt><dd>${fmt.n(m.counts.records)} coded associations between facial actions and states from 337 reports found by 674 logged searches in 23 topic strands (PubMed, Semantic Scholar, OpenAlex, Crossref, Europe PMC, arXiv, six regional databases, general web search; English and 12 other languages). Each record gives the state in the authors' terms, the type of study, elicitation, measure, population and the actions reported as present, absent, unrelated or inverse.</dd>
    <dt>Verified findings</dt><dd>${fmt.n(m.counts.claims)} findings restated in neutral terms and checked against the source in October 2026 (${fmt.n(m.counts.verificationRecords)} verification records); each finding states whether the full text or only the abstract was read.</dd>
    <dt>Secondary analyses</dt><dd>${D.length ? `AU codes released by ${DC.length} ${DC.length === 1 ? 'study' : 'studies'} (${DC.map(esc).join('; ')})${D.length > DC.length ? ` in ${D.length} datasets and tables` : ''}, analysed as described below.` : 'Only AU data released by the studies themselves qualify; none has been analysed yet.'}</dd>
    <dt>Physical descriptions</dt><dd>${esc(m.physicalSource)}</dd>
    <dt>The face</dt><dd>A 3D head rendered as a clay sculpt (ICT-FaceKit Light, USC Institute for Creative Technologies, MIT licence). Each action drives the model's expression shapes named for that FACS action, so the brows, lids, cheeks, nose, lips, jaw, eyes and head move as the action describes, more strongly as intensity rises from A to E. It shows what a movement looks like; it is not a measurement of anyone's face or the output of any detector.</dd></dl></section>
  <section class="stack"><h2>How the best guess is reached</h2>
    <ol class="flow">
      <li><b>Match</b><span>The selected actions are compared with every piece of evidence that names actions: reported configurations, single-action records, the vote counts of systematic reviews, and published rates. Similarity penalises selected actions the evidence lacks more than extra actions the evidence has.</span></li>
      <li><b>Weigh</b><span>Each match counts by its similarity, its sample size and its type of study: spontaneous evidence counts most, then posed, then perception, then theory. Within a state the strongest match leads and the rest add a little.</span></li>
      <li><b>Group</b><span>States that studies treat as variants (happiness, amusement and joy, say) form a family. The reading names one state when it clearly leads, the family when its members share the lead, and says it is not specific otherwise.</span></li>
      <li><b>Grade</b><span>Evidence strength comes from the best matching type of study; confidence also asks whether the exact combination was tested. Observers' readings and uses beyond emotion are reported separately, never mixed into what the person may feel.</span></li>
    </ol>
    <p class="small soft prose">For one action, the reading written for that action leads, and the computed families are shown beside it. "One more action would give" lists additions that make the reading confident, or that hand the lead to another state.</p></section>
  <section class="stack"><h2>Three layers, kept apart</h2><div class="layers3">
    <div><span class="layer-tag l-m">Measurement</span><p class="small">Movement, appearance, intensity, timing and coordination of an action, and detector output. No psychological term appears in this layer.</p></div>
    <div><span class="layer-tag l-a">Association</span><p class="small">What studies found, separated by type of study (posed, spontaneous, perception, functions) and labelled by evidence type. Single-action and joint evidence are computed separately.</p></div>
    <div><span class="layer-tag l-i">Interpretation</span><p class="small">Our synthesis for a situation: the best guess with its evidence grade and confidence, the alternatives, what would distinguish them, and worked examples. A best guess is a reading of the evidence, never a measurement of what someone feels.</p></div></div></section>
  <section class="stack"><h2>Evidence types and streams</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Type</th><th>Meaning</th></tr></thead><tbody>${Object.entries(m.evidenceTypes).map(([k, v]) => `<tr><td>${typeBadge(k)} ${esc(v.label)}</td><td class="small">${esc(v.desc)}</td></tr>`).join('')}</tbody></table></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Stream</th><th>Meaning</th></tr></thead><tbody>${Object.entries(m.streams).map(([k, v]) => `<tr><td>${streamTag(k)}</td><td class="small">${esc(v)}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="stack"><h2>Counting rules</h2><ul class="plain small soft">
    <li>Counts are independent samples from primary studies (several reports of one sample count once), split by type of study. Reviews, theory and indirect evidence are listed but not counted as samples. Counts measure research attention and reporting as well as anything about faces.</li>
    <li>When a record codes the same action under several link types, present takes precedence over inverse, then no link. An action absent by definition (for example, AU6 in a smile defined as non-Duchenne) is not a null finding.</li>
    <li>A positive link means the authors reported the action as present with, or predictive of, the state; null or inverse links are counted and shown with the same prominence.</li>
    <li>Joint evidence comes from configurations that supporting or qualifying records coded with every action present: exact matches and close matches with one or two additional actions. Larger configurations that contain the selection are listed but not counted. Contradicting records are counter-evidence; pooled categories (such as “AU9 or AU10”) and alternatives (“brow raise versus lower”) are not joint occurrences.</li>
    <li>Evidence levels for combinations: ${E.LEVELS.map(l => `<b>${esc(l.label)}</b>: ${esc(l.desc)}`).join(' ')}</li>
    <li>For a single action: <b>two or more samples</b>, <b>one sample</b>, or <b>no positive link</b>.</li>
    <li>States keep the authors' terms; pooled categories (“multiple categories”) are not offered as readings.</li></ul></section>
  <section class="stack"><h2>Reliability and specificity</h2><div class="prose small soft"><p>Following Barrett et al. (2019), reliability is how often an action or configuration appears when a state is present, and specificity is whether it appears without the state: the rate in the other states a study measured, and the share of the action's occurrences that came from the state. That share depends on how many instances of each state a study had, so it is shown with the share expected if the action were unrelated to the state.</p>
    <p>Estimates from the literature (meta-analyses, reviews and primary studies) are listed with their source, the exact sentence the number comes from and its location. Numbers that a review reports from a primary study are labelled as author-reported and name the original study; restatements of a number already listed are kept only to trace where a claim comes from. Estimates computed here come only from AU data that studies released (the WSEFEP photographs and Scherer et al., 2019, Table 2A). Kunz et al. (2013, Table 1) print event counts per 100 five-second segments, which can exceed 100, so they are shown as rates and not converted to shares. Each study keeps its own design and state terms, and nothing is pooled across studies.</p>
    </div></section>
  ${A.v43 ? `<section class="stack"><h2>How findings are drawn</h2><div class="prose small soft">
    <p>Every finding is shown as a face plus a picture of its numbers. The face shows the movements the finding counted, drawn on the 3D head; selecting a finding plays it on a larger face with each action labelled. A share of people (or photographs, or trials) is drawn as a crowd of 20 in which that share shows the movement, so 28% is about 6 of 20; the exact percentage is printed beside it. Two crowds side by side compare the state with a baseline or with the other states a study measured. A correlation is drawn as the variation that feeling and face share (r squared): r = .36 shares about 13%. Mean ratings are bars on the scale the study used, and other statistics are printed with what they compare.</p>
    <p>The four faces of a state are the configuration proposed for it, what people asked to pose it did most, what people in that state showed, and what observers read as it. Each rests on one cited finding or estimate, and its numbers come only from that source.</p></div></section>` : ''}
  ${unlistedHTML()}
  ${SEC.methodHTML()}
  <section class="stack"><h2>Statistics library</h2><p class="small soft prose">The lab uses a dependency-free JavaScript library written for this tool: descriptive statistics, correlation with confidence intervals, contingency tests, rank tests, false-discovery control, logistic regression (maximum likelihood, Firth, ridge; cluster-robust and two-way clustered standard errors), multinomial regression, ordinary least squares with robust errors, linear mixed models (REML), logistic mixed models (adaptive Gauss–Hermite quadrature), grouped and stratified cross-validation, permutation tests, cluster bootstrap, design and leakage checks, temporal event features, co-occurrence statistics and R and Python code export. Its 87 tests compare results with SciPy, statsmodels and scikit-learn.</p></section>
  ${rep ? `<section class="stack"><h2>Corrections to the evidence base in this version</h2><details class="more"><summary class="small soft">${fmt.n((m.repairs || []).length)} corrections, each with the source it was checked against</summary><ul class="plain small soft" style="margin-top:10px">${rep}</ul></details></section>` : ''}
  <section class="stack"><h2>Limitations</h2><ul class="plain small soft">
    <li>${fmt.pct(A.kb.records.filter(r => r.coded === 'abstract only').length / A.kb.records.length, 0)} of records were coded from abstracts; full-text coding will add actions that were measured but not linked to a state.</li>
    <li>Spontaneous evidence at the level of action units is sparse for anger, fear, sadness and contempt; most samples are Western.</li>
    <li>Secondary analyses are limited to AU data that studies released; each dataset keeps its own design, coding and state terms, and results are not pooled across datasets.</li>
    <li>Evidence levels summarize the amount and kind of evidence, not effect sizes or the probability that a person feels a state.</li></ul></section>
  <section class="stack"><h2>Credits and licences</h2><p class="small soft prose">The 3D head, the rendering library, the fonts and the study data are the work of others, used under their licences. <a href="#credits">Credits and licences</a>.</p></section>
  <section class="stack"><h2>How to cite</h2><p class="small soft">${esc(citeLine(m))} The evidence base accompanies a review of facial movements and emotion, manuscript in progress.${D.length ? ' Secondary analyses: cite the studies whose data were analysed (listed above).' : ''}</p></section></div>`;
  $$('[data-get]', main).forEach(b => b.onclick = async () => {
    const k = b.dataset.get;
    try {
      if (k === 'kb') { const r = await fetch('kb.json'); await saveFile('au-evidence-kb-' + m.version + '.json', await r.blob()); }
      else if (k === 'sec') { const r = await fetch('secondary.json'); await saveFile('au-evidence-secondary-' + m.version + '.json', await r.blob()); }
      else if (k === 'claims') await saveFile('au-evidence-findings.csv', toCSV(['id', 'citation', 'actions', 'states', 'stream', 'direction', 'type', 'checked_against', 'finding', 'numbers', 'limitation', 'listed', 'why_not_listed'], A.kb.claims.map(c => [c.id, c.cite, c.aus.map(a => 'AU' + a).join(' '), c.states.join('; '), c.stream, c.dir, c.type, c.basis, (c.v4 && c.v4.head) || c.text, c.num, c.lim, c.named === false ? 'no' : 'yes', c.unnamed || ''])));
      else if (k === 'records') await saveFile('au-evidence-records.csv', toCSV(['id', 'study', 'stream', 'type', 'state', 'state_class', 'elicitation', 'measure', 'population', 'region', 'coded_from', 'links', 'configuration', 'behavior', 'finding'], A.kb.records.map(r => [r.id, (studyOf(r.study) || {}).cit || r.study, r.stream, r.type, r.state, r.stateClass, r.elicitation, r.measure, r.population, r.region, r.coded, JSON.stringify(r.links), r.config, r.behavior, r.finding])));
    } catch (e) { toast('That file is not available here.'); }
  });
};
/* what the lists leave out: estimates and findings that name no movement (build/face_named.py), by reason, with their sources */
function unlistedHTML() {
  const E_ = A.kb.relspec.filter(e => e.show !== false && e.named === false), C_ = A.kb.claims.filter(c => c.named === false);
  if (!E_.length && !C_.length) return '';
  const group = (L, key) => { const m = new Map(); L.forEach(x => { const k = x[key] || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return [...m.entries()].sort((a, b) => b[1].length - a[1].length); };
  /* the original study, from the sentence's citation: "(Mauss et al., 2005, in Reisenzein et al., 2013)" -> "Mauss et al., 2005" */
  const orig = e => { const x = String((e.v4 || {}).sentence || '').match(/\(([^()]*?\d{4}[a-z]?)(?:, (?:Exp|Study)[^()]*?)?(?:, in [^()]*)?\)\.?\s*$/); return x ? x[1] : e.cite; };
  const cites = L => uniq(L.map(orig)).join('; ');
  return `<section class="stack"><h2>What the lists leave out</h2><p class="small soft prose">Every finding and estimate listed here names the movements it measured, so it says what the face did. Items that rated or labelled a whole face without naming its movements, or that concern theory and method, are left out of the lists. They stay in the evidence base, and the pages that cite them still open.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">Left out</th><th>Why</th><th>Sources</th></tr></thead><tbody>
    ${group(E_, 'unnamed').map(([why, L]) => `<tr><td class="num nw">${L.length} estimate${L.length === 1 ? '' : 's'}</td><td class="small">${esc(why.replace(/^./, x => x.toUpperCase()))}</td><td class="small">${esc(cites(L))}</td></tr>`).join('')}
    ${group(C_, 'unnamed').map(([why, L]) => `<tr><td class="num nw">${L.length} finding${L.length === 1 ? '' : 's'}</td><td class="small">${esc(why.replace(/^./, x => x.toUpperCase()))}</td><td class="small">${L.map(c => `<a href="#claim-${esc(c.id)}" class="mono">${esc(c.id)}</a>`).join(' ')}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}
/* ---------- start-up ---------- */
async function start() {
  $('#nav').innerHTML = NAV.map(([k, v]) => `<a href="#${k}" data-k="${k}">${esc(v)}</a>`).join('');
  try {
    const [kb, sec] = await Promise.all([loadJSON('kb.json'), loadJSON('secondary.json').catch(() => null)]);
    A.kb = kb; A.sec = sec; A.I = E.index(kb);
    initSearch(); initLook();
    window.addEventListener('hashchange', route);
    route();
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="wrap"><div class="empty">The knowledge base could not be loaded (${esc(e.message)}). Reload the page to try again.</div></div>`;
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

/* ---- public preview: credits and licences (#credits) ---- */
'use strict';
const MIT_ICT = `MIT License

Copyright (c) 2020 USC Institute for Creative Technologies

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
VIEWS.credits = function (main) {
  const lic = t => `<span class="cr-lic">${esc(t)}</span>`;
  const ext = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text || href.replace(/^https?:\/\//, ''))}</a>`;
  main.innerHTML = `<div class="wrap stack-l narrow">
  <section class="stack"><h1>Credits and licences</h1>
    <p class="lead">This is a preview of a tool in development. It uses a 3D head model, a rendering library, fonts and study data made by others, each under the licence named below.</p></section>
  <section class="stack"><h2>Software, model and fonts</h2><ul class="cr-list">
    <li><b>The 3D head: ICT-FaceKit (ICT Face Model Light)</b>
      <span class="small">${lic('MIT')}Copyright (c) 2020 USC Institute for Creative Technologies. ${ext('https://github.com/ICT-VGL/ICT-FaceKit', 'github.com/ICT-VGL/ICT-FaceKit')}</span>
      <span class="small soft">The mesh, its expression shapes and baked shading, converted for the web (ict_web.json, ict_web_bin.txt, ict_ao_bin.txt). Model paper: Li, R., Bladin, K., Zhao, Y., Chinara, C., Ingraham, O., Xiang, P., Ren, X., Prasad, P., Kishore, B., Xing, J., &amp; Li, H. (2020). Learning formation of physically-based face attributes. CVPR 2020.</span>
      <details class="cr-lictext"><summary class="small">Licence text</summary><pre>${esc(MIT_ICT)}</pre></details></li>
    <li><b>Rendering: three.js r160</b>
      <span class="small">${lic('MIT')}Copyright the three.js authors. Loaded from the jsDelivr CDN. ${ext('https://threejs.org', 'threejs.org')}</span></li>
    <li><b>Fonts: Source Serif 4, Source Code Pro and Archivo</b>
      <span class="small">${lic('SIL OFL 1.1')}Source Serif 4 and Source Code Pro by Adobe; Archivo by the Archivo Project Authors (Omnibus-Type). <a href="fonts/OFL.txt" target="_blank" rel="noopener">Licence and copyright notices</a></span></li>
  </ul></section>
  <section class="stack"><h2>Study data analysed here</h2>
    <p class="small soft prose">Secondary analyses use only action-unit codes and tables that the studies published. No photographs or video from these studies are included.</p>
    <ul class="cr-list">
    <li><b>WSEFEP: FACS codes and judge ratings of 210 posed photographs</b>
      <span class="small">${lic('CC BY')}Olszanowski, M., Pochwatko, G., Kuklinski, K., Scibor-Rylski, M., Lewinski, P., &amp; Ohme, R. K. (2015). Warsaw set of emotional facial expression pictures: A validation study of facial display photographs. <i>Frontiers in Psychology, 5</i>, 1516. ${ext('https://doi.org/10.3389/fpsyg.2014.01516')}</span>
      <span class="small soft">Per-photograph action-unit codes, intensities and judge ratings from the article's supplementary appendix (the copy used came from the public repository of Stöckli et al., 2018). Changed here: converted to JSON, and the displayers' initials replaced with numbered codes. Used by the statistics lab and the study-data sections.</span></li>
    <li><b>Pain and disgust: action-unit frequencies (Table 1)</b>
      <span class="small">${lic('CC BY 4.0')}Kunz, M., Peter, J., Huster, S., &amp; Lautenbacher, S. (2013). Pain and disgust: The facial signaling of two aversive bodily experiences. <i>PLoS ONE, 8</i>(12), e83277. ${ext('https://doi.org/10.1371/journal.pone.0083277')}</span></li>
    <li><b>Enacted emotions: action-unit frequencies (Tables 2A and 2B)</b>
      <span class="small">${lic('CC BY')}Scherer, K. R., Ellgring, H., Dieckmann, A., Unfried, M., &amp; Mortillaro, M. (2019). Dynamic facial expression of emotion and observer inference. <i>Frontiers in Psychology, 10</i>, 508. ${ext('https://doi.org/10.3389/fpsyg.2019.00508')}</span></li>
  </ul></section>
  <section class="stack"><h2>Published findings</h2><ul class="cr-list">
    <li><b>Findings, estimates and quotations</b>
      <span class="small soft">Findings and estimates are summarized from the works cited with them, each linked to its source; quotations are kept to a sentence and cited. The original works remain under their own copyright.</span></li>
  </ul></section>
  <section class="stack"><h2>This tool</h2>
    <p class="small soft prose">A licence for the tool's code and knowledge base has not been chosen yet; please ask before reusing or redistributing them. This preview leaves out parts of the development version, among them photographs of real faces and the integration kit download.</p>
    <p class="small"><a href="THIRD-PARTY-NOTICES.txt" target="_blank" rel="noopener">All notices as plain text</a></p></section>
</div>`;
};
