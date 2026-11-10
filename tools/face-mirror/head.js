/* Face Mirror: the clay head, live.
 *
 * The head, its look and its lighting are Face Value's (src/face3d.js in the preview's app.js): ICT-FaceKit Light
 * (USC Institute for Creative Technologies, MIT licence) rendered as a clay sculpt with three.js r160. Face Value poses
 * the head from action units; here it is posed every frame from shape weights (ARKit names, ICT-FaceKit sides), so the
 * per-frame work is kept small: the shapes are summed into typed arrays, normals are recomputed without allocating,
 * the baked shading is computed once (only teeth and tongue brighten as the mouth opens), and nothing is drawn when
 * nothing has changed.
 *
 *   const head = await createHead(canvas, { base: 'head/' })
 *   head.set(weights)            {browDown_L: 0.3, jawOpen: 0.5, ...}, 0..1.25
 *   head.turn({x, y, z})         head rotation in degrees (three.js axes: y turns, x nods, z tilts)
 *   head.highlight(names)        tint the skin these shapes move (or [] for none)
 *   head.frame()                 draws if anything changed; returns true when it drew
 *   head.resize(), head.dispose()
 * Options: base (where the head files are), shadow (shadow map size), maxDpr, background (an opaque colour; transparent
 * by default), view (camera framing overrides, e.g. {R: 160}), keepBuffer (keep the drawn picture readable, for tests),
 * onLost (the WebGL context was lost).
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

const FILES = { json: 'ict_web.json', bin: 'ict_web_bin.txt', ao: 'ict_ao_bin.txt' };
const b64 = t => { const s = atob(t.replace(/\s+/g, '')), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
/* framing: a frontal view of the whole head (model units are centimetres; +x is the head's own left, +z points out of the face) */
const VIEW = { t: [0, 1.9, 2], R: 114, fov: 16, pitch: 4, yaw: 0 };
/* Face Value's clay look */
const LK = { skin: '#c2b3a4', brow: '#8e7e6f', lip: '#b19488', iris: '#8a7a6c', ring: '#665a4f', pupil: '#463d35', sclera: '#cfc3b6', teeth: '#d6cbbd', gums: '#a08a7f',
  rough: 0.86, sheen: 0.15, sss: 0.22, env: 0.38, key: 2.4, fill: 0.38, rim: 1.1, keyColor: '#fff4ea', paint: 0.45, aoK: 1, hot: '#6ea8ff' };

export const hasWebGL = () => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } };

let modelP = null;
function loadModel(base) {
  if (modelP) return modelP;
  const get = (f, kind) => fetch(base + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return kind === 'json' ? r.json() : r.text(); });
  modelP = Promise.all([get(FILES.json, 'json'), get(FILES.bin).then(b64), get(FILES.ao).then(b64).catch(() => null)]).then(([meta, buf, aob]) => {
    const N = meta.vertexCount, q = new Uint16Array(buf, meta.posOffset, N * 3), base0 = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) base0[i * 3 + a] = meta.lo[a] + q[i * 3 + a] * meta.scale[a];
    const index = new Uint16Array(buf, meta.indexOffset, meta.triCount * 3);
    const SH = {}; meta.shapes.forEach(s => { SH[s.name] = { ids: new Uint16Array(buf, s.idOffset, s.n), d: new Int16Array(buf, s.deltaOffset, s.n * 3), sc: s.scale }; });
    const GI = {}; meta.groups.forEach((g, i) => { GI[g.name] = i; });
    const vgroup = new Uint8Array(N); meta.groups.forEach((g, gi) => { for (let k = g.start; k < g.start + g.count; k++) vgroup[index[k]] = gi; });
    const ao = new Float32Array(N).fill(1); if (aob && aob.byteLength === N) { const u = new Uint8Array(aob); for (let i = 0; i < N; i++) ao[i] = u[i] / 255; }
    // the iris painted on the eyeball shell, by the angle from each eye's gaze axis
    const eyeT = new Float32Array(N).fill(-1);
    ['M_ScleraLeft', 'M_ScleraRight'].forEach(gname => {
      const g = meta.groups[GI[gname]], ids = new Set(); for (let k = g.start; k < g.start + g.count; k++) ids.add(index[k]);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let pole = -1, pz = -1e9;
      ids.forEach(i => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], base0[i * 3 + a]); hi[a] = Math.max(hi[a], base0[i * 3 + a]); } if (base0[i * 3 + 2] > pz) { pz = base0[i * 3 + 2]; pole = i; } });
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const ax = [base0[pole * 3] - c[0], base0[pole * 3 + 1] - c[1], base0[pole * 3 + 2] - c[2]], al = Math.hypot(ax[0], ax[1], ax[2]); ax[0] /= al; ax[1] /= al; ax[2] /= al;
      ids.forEach(i => { const v = [base0[i * 3] - c[0], base0[i * 3 + 1] - c[1], base0[i * 3 + 2] - c[2]], vl = Math.hypot(v[0], v[1], v[2]);
        eyeT[i] = Math.acos(Math.max(-1, Math.min(1, (v[0] * ax[0] + v[1] * ax[1] + v[2] * ax[2]) / vl))) * 180 / Math.PI; });
    });
    const LM = meta.landmarks68.map(i => [base0[i * 3], base0[i * 3 + 1], base0[i * 3 + 2]]);
    return { meta, N, base: base0, index, SH, GI, vgroup, ao, eyeT, LM };
  });
  modelP.catch(() => { modelP = null; });
  return modelP;
}

/* three.js RoomEnvironment (from Google model-viewer): a grey room with soft light panels, prefiltered for image-based lighting */
function roomEnv(renderer) {
  const T = THREE, scene = new T.Scene(), geo = new T.BoxGeometry(); geo.deleteAttribute('uv');
  const roomMat = new T.MeshStandardMaterial({ side: T.BackSide }), boxMat = new T.MeshStandardMaterial();
  const main = new T.PointLight(0xffffff, 900, 28, 2); main.position.set(0.418, 16.199, 0.3); scene.add(main);
  const add = (mat, p, r, sc) => { const m = new T.Mesh(geo, mat); m.position.set(p[0], p[1], p[2]); if (r) m.rotation.set(0, r, 0); m.scale.set(sc[0], sc[1], sc[2]); scene.add(m); };
  add(roomMat, [-0.757, 13.219, 0.717], 0, [31.713, 28.305, 28.591]);
  [[[-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]], [[-5.607, -0.754, -0.758], 0.994, [1.97, 1.534, 3.955]], [[6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]],
    [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]], [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]], [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]]].forEach(([p, r, sc]) => add(boxMat, p, r, sc));
  const lamp = k => { const m = new T.MeshBasicMaterial(); m.color.setScalar(k); return m; };
  add(lamp(50), [-16.116, 14.37, 8.208], 0, [0.1, 2.428, 2.739]); add(lamp(50), [-16.109, 18.021, -8.207], 0, [0.1, 2.425, 2.751]); add(lamp(17), [14.904, 12.198, -1.832], 0, [0.15, 4.265, 6.331]);
  add(lamp(43), [-0.462, 8.89, 14.52], 0, [4.38, 5.441, 0.088]); add(lamp(20), [3.235, 11.486, -12.541], 0, [2.5, 2, 0.1]); add(lamp(100), [0, 20, 0], 0, [1, 0.1, 1]);
  const pm = new T.PMREMGenerator(renderer), tex = pm.fromScene(scene, 0.04).texture; pm.dispose(); return tex;
}

function materials(m) {
  const T = THREE, C = h => new T.Color(h);
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
function eyeColor(t) {
  const T = THREE, pc = new T.Color(LK.pupil), ic = new T.Color(LK.iris), rc = new T.Color(LK.ring), sc = new T.Color(LK.sclera);
  const c = pc.clone().lerp(ic, sm(8.7, 10.9, t)); c.lerp(rc, sm(17.5, 25.5, t) * 0.7); c.lerp(sc, sm(25.8, 28.5, t));
  if (t > 28.5) c.multiplyScalar(1 - 0.12 * sm(40, 95, t));
  return c;
}

/** A live head on a canvas (options above). */
export async function createHead(canvas, opt) {
  opt = opt || {};
  const m = await loadModel(opt.base || '');
  const T = THREE, N = m.N;
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!opt.keepBuffer, powerPreference: 'high-performance' });
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.VSMShadowMap;
  if (opt.background) renderer.setClearColor(new T.Color(opt.background), 1); else renderer.setClearColor(0x000000, 0);
  const scene = new T.Scene(); scene.environment = roomEnv(renderer);
  const C = h => new T.Color(h);
  const key = new T.DirectionalLight(C(LK.keyColor), LK.key); key.position.set(-26, 30, 34); key.castShadow = true;
  const sz = opt.shadow || 2048; key.shadow.mapSize.set(sz, sz); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.04; key.shadow.radius = 9; key.shadow.blurSamples = 20;
  Object.assign(key.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 }); scene.add(key);
  const fill = new T.DirectionalLight(0xffffff, LK.fill); fill.position.set(30, 2, 26); scene.add(fill);
  const rim = new T.DirectionalLight(0xffffff, LK.rim); rim.position.set(26, 16, -28); scene.add(rim);
  const rim2 = new T.DirectionalLight(0xffffff, LK.rim * 0.6); rim2.position.set(-28, 12, -24); scene.add(rim2);

  const geo = new T.BufferGeometry(), pos = new Float32Array(m.base), nrm = new Float32Array(N * 3);
  const posA = new T.BufferAttribute(pos, 3).setUsage(T.DynamicDrawUsage), nrmA = new T.BufferAttribute(nrm, 3).setUsage(T.DynamicDrawUsage);
  geo.setAttribute('position', posA); geo.setAttribute('normal', nrmA);
  geo.setAttribute('p0', new T.BufferAttribute(new Float32Array(m.base), 3));
  const idx = new Uint32Array(m.index); geo.setIndex(new T.BufferAttribute(idx, 1));
  const col = new Float32Array(N * 3).fill(1), colA = new T.BufferAttribute(col, 3).setUsage(T.DynamicDrawUsage); geo.setAttribute('color', colA);
  const mv = new Float32Array(N), mvA = new T.BufferAttribute(mv, 1).setUsage(T.DynamicDrawUsage); geo.setAttribute('mv', mvA);
  const hot = new Float32Array(N), hotA = new T.BufferAttribute(hot, 1).setUsage(T.DynamicDrawUsage); geo.setAttribute('hot', hotA);
  m.meta.groups.forEach((g, i) => geo.addGroup(g.start, g.count, i));
  const mats = materials(m);
  const mesh = new T.Mesh(geo, mats); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const headG = new T.Group(); headG.add(mesh); scene.add(headG);
  const camera = new T.PerspectiveCamera(VIEW.fov, 1, 1, 1000), V = Object.assign({}, VIEW, opt.view);

  // baked shading, computed once: ambient occlusion, the dark mouth socket, painted eyes; teeth and tongue are kept apart
  const GI = m.GI, vg = m.vgroup, mouthIdx = [], mouthAO = [];
  for (let i = 0; i < N; i++) {
    let a = Math.pow(Math.max(0, m.ao[i]), 1.35); a = 1 - LK.aoK * (1 - a);
    const g = vg[i]; let r = a, gg = a, b = a;
    if (g === GI.M_Teeth || g === GI.M_GumsTongue) { mouthIdx.push(i); mouthAO.push(a); }
    if (g === GI.M_BackHead) { const x = m.base[i * 3], y = m.base[i * 3 + 1], z = m.base[i * 3 + 2]; if (Math.abs(x) < 4.6 && y > -7.5 && y < 1 && z > 0 && z < 11) { r *= 0.42; gg *= 0.3; b *= 0.3; } }
    if (m.eyeT[i] >= 0) { const c = eyeColor(m.eyeT[i]), ea = 1 - (1 - a) * 0.65; r = ea * c.r; gg = ea * c.g; b = ea * c.b; }
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  const disp = new Float32Array(N * 3);
  let W = {}, rot = { x: 0, y: 0, z: 0 }, hotNames = [], dirty = true, shapeDirty = true, lastOpen = -1, alive = true, drawn = false;

  function normals() {   // area-weighted vertex normals, in place (no allocation per frame)
    nrm.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz; nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz; nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  }
  function shape() {
    disp.fill(0);
    for (const nm in W) { const s = m.SH[nm], w = W[nm]; if (!s || !(w > 0.002)) continue; const f = w * s.sc, ids = s.ids, d = s.d;
      for (let j = 0; j < ids.length; j++) { const i = ids[j] * 3; disp[i] += d[j * 3] * f; disp[i + 1] += d[j * 3 + 1] * f; disp[i + 2] += d[j * 3 + 2] * f; } }
    for (let i = 0; i < pos.length; i++) pos[i] = m.base[i] + disp[i];
    normals(); posA.needsUpdate = true; nrmA.needsUpdate = true;
    if (hotNames.length) { for (let i = 0; i < N; i++) mv[i] = Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]); mvA.needsUpdate = true; }
    // teeth and tongue are lighter once they show
    const open = Math.min(1, (W.jawOpen || 0) * 1.6 + (W.mouthLowerDown_L || 0) * 0.5 + (W.mouthUpperUp_L || 0) * 0.4 + (W.mouthSmile_L || 0) * 0.25);
    if (Math.abs(open - lastOpen) > 0.01) { lastOpen = open;
      for (let k = 0; k < mouthIdx.length; k++) { const a = mouthAO[k], v = a + (0.55 + 0.45 * a - a) * open, i = mouthIdx[k] * 3; col[i] = col[i + 1] = col[i + 2] = v; }
      colA.needsUpdate = true; }
  }
  function frameCamera() {
    const w = canvas.clientWidth || 400, h = canvas.clientHeight || 500, cam = camera;
    const yaw = V.yaw * Math.PI / 180, pitch = V.pitch * Math.PI / 180;
    cam.aspect = w / h;
    // keep the whole head in view on tall, square and wide canvases (the head is about as tall as 1.25 of its width)
    cam.fov = cam.aspect < 0.8 ? V.fov * 0.8 / cam.aspect : cam.aspect > 0.9 ? V.fov * 1.08 : V.fov;
    cam.position.set(V.t[0] + Math.sin(yaw) * Math.cos(pitch) * V.R, V.t[1] + Math.sin(pitch) * V.R, V.t[2] + Math.cos(yaw) * Math.cos(pitch) * V.R);
    cam.lookAt(V.t[0], V.t[1], V.t[2]); cam.updateProjectionMatrix();
  }
  function draw() {
    if (shapeDirty) { shape(); shapeDirty = false; }
    renderer.render(scene, camera); dirty = false; drawn = true;
  }
  function resize() {
    if (!alive) return;
    const w = Math.max(64, canvas.clientWidth || 400), h = Math.max(64, canvas.clientHeight || 500);
    renderer.setPixelRatio(Math.min(opt.maxDpr || 2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false);
    frameCamera();
    if (drawn) draw(); else dirty = true;   // a new size clears the canvas: draw again at once, so it never shows empty
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (ro) ro.observe(canvas);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (opt.onLost) opt.onLost(); });

  return {
    set(w) {
      let changed = false; const keys = new Set(Object.keys(W).concat(Object.keys(w || {})));
      for (const k of keys) if (Math.abs((W[k] || 0) - ((w && w[k]) || 0)) > 0.003) { changed = true; break; }
      if (changed) { W = Object.assign({}, w); shapeDirty = true; dirty = true; }
    },
    turn(r) {
      const x = (r && r.x) || 0, y = (r && r.y) || 0, z = (r && r.z) || 0;
      if (Math.abs(x - rot.x) + Math.abs(y - rot.y) + Math.abs(z - rot.z) > 0.05) { rot = { x, y, z }; headG.rotation.set(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180); dirty = true; }
    },
    highlight(names) {
      hotNames = (names || []).filter(n => m.SH[n]); hot.fill(0);
      hotNames.forEach(nm => { const ids = m.SH[nm].ids; for (let j = 0; j < ids.length; j++) hot[ids[j]] = 1; });
      if (!hotNames.length) mv.fill(0);
      hotA.needsUpdate = true; mvA.needsUpdate = true; shapeDirty = true; dirty = true;
    },
    frame(force) {
      if (!alive || (!dirty && !force)) return false;
      draw(); return true;
    },
    resize,
    get shapes() { return Object.keys(m.SH); },
    renderer,
    dispose() { alive = false; if (ro) ro.disconnect(); geo.dispose(); mats.forEach(x => x.dispose && x.dispose()); renderer.dispose(); }
  };
}
