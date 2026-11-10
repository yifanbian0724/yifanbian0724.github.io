/* Face Mirror: from the face tracker's blendshapes to the clay head's shapes and to approximate FACS action units.
 *
 * MediaPipe Face Landmarker reports 52 ARKit-style blendshape scores (0..1) per video frame. Its "Left" and "Right" are
 * the person's own sides (eyeBlinkLeft is the person's left eye): checked by showing the tracker the synthetic head with
 * one side moved (dev/calibrate.html). Scores arrive here after the person's resting values are taken off (app.js).
 *
 *  1. The head: each blendshape drives the head's shape of the same name. The head is a mirror, so the person's left
 *     drives the head's right (ICT-FaceKit's _R) and the head turns the way a reflection would.
 *  2. The readout: a fixed table maps blendshapes to action units (README, "From blendshapes to action units").
 *     These are estimates from a model trained to animate avatars, not FACS coding by a trained coder.
 */

/* MediaPipe's 52 categories, in its order (index 0 is "_neutral") */
export const BLENDSHAPES = ['_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff',
  'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight',
  'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight',
  'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft',
  'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight'];

/* ---------------------------------------------------------------- 1. blendshapes -> the head's 47 shapes */
/* the person's side -> the head's side (a mirror swaps them) */
const SIDE = { Left: '_R', Right: '_L' };
/* gains: the tracker's scores stay well below 1 for these movements (on the synthetic head several barely register) */
const HEAD_GAIN = { cheekSquint: 1.35, mouthDimple: 1.4, mouthPress: 1.2, noseSneer: 1.5, mouthUpperUp: 1.15, eyeWide: 1.25, browDown: 1.15, mouthStretch: 1.3, mouthFrown: 1.3 };
const NOT_ON_HEAD = new Set(['_neutral', 'jawForward', 'jawLeft', 'jawRight', 'mouthClose', 'mouthLeft', 'mouthRight']);

/** blendshape scores {name: 0..1} -> head shape weights {ICT name: 0..1.25} */
export function headWeights(bs) {
  const w = {};
  for (const name in bs) {
    if (NOT_ON_HEAD.has(name)) continue;
    let v = bs[name]; if (!(v > 0.002)) continue;
    const m = name.match(/^(.*?)(Left|Right)$/), base = m ? m[1] : name;
    v = Math.min(1.25, v * (HEAD_GAIN[base] || 1));
    if (m) w[base + SIDE[m[2]]] = v;
    else if (name === 'browInnerUp' || name === 'cheekPuff') { w[name + '_L'] = v; w[name + '_R'] = v; }
    else w[name] = v;
  }
  // the head has no mouthClose shape: lips the tracker sees closed over an open jaw close the jaw instead
  if (w.jawOpen && bs.mouthClose) w.jawOpen = Math.max(0, w.jawOpen - 0.8 * bs.mouthClose);
  return w;
}

/* ---------------------------------------------------------------- 2. blendshapes -> action units */
/* Each entry: the action unit, the blendshape(s) that estimate it, and how a 0..1 intensity is formed.
 * "pair" takes the person's left and right side and reports the stronger, with both sides kept for the readout.
 * gain scales the tracker's score so that 1 is a clear, full movement; on is the intensity at which the action
 * counts as present (it stops counting below 70% of that). The values are first settings, chosen from the scores the
 * tracker gave the synthetic head and set generously where it barely responded; they have not been checked against
 * FACS coding of real faces. */
export const AU_TABLE = [
  { au: '1', region: 'Brows', from: ['browInnerUp'], gain: 1.4, on: 0.42 },
  { au: '2', region: 'Brows', pair: 'browOuterUp', gain: 1.5, on: 0.42 },
  { au: '4', region: 'Brows', pair: 'browDown', gain: 1.8, on: 0.4 },
  { au: '5', region: 'Eyes', pair: 'eyeWide', gain: 2.2, on: 0.45 },
  { au: '6', region: 'Eyes', pair: 'cheekSquint', gain: 2.2, on: 0.42 },
  { au: '7', region: 'Eyes', pair: 'eyeSquint', gain: 1.5, on: 0.55 },
  { au: '43', region: 'Eyes', note: 'eyeBlinkLeft and eyeBlinkRight above 0.35 for 0.4 s or longer' },
  { au: '45', region: 'Eyes', note: 'eyeBlinkLeft and eyeBlinkRight above 0.35 for less than 0.4 s; shown, not read' },
  { au: '46', region: 'Eyes', note: 'one eyeBlink above 0.35 for 0.18 s while the other stays below 0.22' },
  { au: '9', region: 'Nose and cheeks', pair: 'noseSneer', gain: 2.4, on: 0.42 },
  { au: '34', region: 'Nose and cheeks', from: ['cheekPuff'], gain: 1.6, on: 0.45 },
  { au: '10', region: 'Mouth', pair: 'mouthUpperUp', gain: 1.6, on: 0.45 },
  { au: '12', region: 'Mouth', pair: 'mouthSmile', gain: 1.25, on: 0.4 },
  { au: '14', region: 'Mouth', pair: 'mouthDimple', gain: 2.6, on: 0.45 },
  { au: '15', region: 'Mouth', pair: 'mouthFrown', gain: 2.6, on: 0.42 },
  { au: '16', region: 'Mouth', pair: 'mouthLowerDown', gain: 1.6, on: 0.5 },
  { au: '17', region: 'Mouth', from: ['mouthShrugLower'], gain: 1.6, on: 0.5 },
  { au: '18', region: 'Mouth', from: ['mouthPucker'], gain: 1.3, on: 0.5 },
  { au: '20', region: 'Mouth', pair: 'mouthStretch', gain: 2.6, on: 0.42 },
  { au: '22', region: 'Mouth', from: ['mouthFunnel'], gain: 1.6, on: 0.45 },
  { au: '24', region: 'Mouth', pair: 'mouthPress', gain: 2.2, on: 0.45 },
  { au: '28', region: 'Mouth', from: ['mouthRollLower', 'mouthRollUpper'], gain: 1.6, on: 0.5 },
  { au: '25', region: 'Jaw', note: 'lips apart: jaw opening without lips closed, or a lowered lower lip' },
  { au: '26', region: 'Jaw', note: 'jawOpen from about 0.18 to 0.6' },
  { au: '27', region: 'Jaw', note: 'jawOpen above about 0.6 (AU26 and AU27 are never both counted)' },
  { au: '51', region: 'Head and eyes', head: true, note: 'head turned more than 12 degrees to the person’s left' },
  { au: '52', region: 'Head and eyes', head: true, note: 'head turned more than 12 degrees to the person’s right' },
  { au: '53', region: 'Head and eyes', head: true, note: 'head tilted back more than 10 degrees' },
  { au: '54', region: 'Head and eyes', head: true, note: 'head tilted down more than 10 degrees' },
  { au: '55', region: 'Head and eyes', head: true, note: 'head tilted toward the left shoulder more than 10 degrees' },
  { au: '56', region: 'Head and eyes', head: true, note: 'head tilted toward the right shoulder more than 10 degrees' },
  { au: '61', region: 'Head and eyes', head: true, note: 'both eyes turned to the person’s left (eyeLookOutLeft + eyeLookInRight)' },
  { au: '62', region: 'Head and eyes', head: true, note: 'both eyes turned to the person’s right (eyeLookInLeft + eyeLookOutRight)' },
  { au: '63', region: 'Head and eyes', head: true, note: 'both eyes up (eyeLookUp)' },
  { au: '64', region: 'Head and eyes', head: true, note: 'both eyes down (eyeLookDown)' }
];
export const REGIONS = ['Brows', 'Eyes', 'Nose and cheeks', 'Mouth', 'Jaw', 'Head and eyes'];
/* Actions with no blendshape behind them (listed in the README): AU8, 11, 13, 19, 21, 23, 29-33, 35-39, 41, 42, 44, 65, 66 */

const clamp01 = v => Math.max(0, Math.min(1, v));
const avg2 = (a, b) => ((a || 0) + (b || 0)) / 2;

/** Intensities 0..1 for every action in AU_TABLE, from one frame of blendshapes and the head pose (degrees, the
 *  person's own frame: yaw > 0 turns to their left, pitch > 0 tilts the head back, roll > 0 toward their left shoulder).
 *  Returns {au: {v, L, R}} where L and R are the person's left and right side for two-sided actions. */
export function auIntensities(bs, poseDeg) {
  const out = {}, get = n => bs[n] || 0;
  AU_TABLE.forEach(e => {
    if (e.pair) { const L = clamp01(get(e.pair + 'Left') * e.gain), R = clamp01(get(e.pair + 'Right') * e.gain); out[e.au] = { v: Math.max(L, R), L, R }; }
    else if (e.from) out[e.au] = { v: clamp01(Math.max(...e.from.map(get)) * e.gain) };
  });
  // the mouth: lips apart and the degree of jaw opening
  const jaw = Math.max(0, get('jawOpen') - 0.7 * get('mouthClose'));
  const lower = avg2(get('mouthLowerDownLeft'), get('mouthLowerDownRight')), upper = avg2(get('mouthUpperUpLeft'), get('mouthUpperUpRight'));
  out['25'] = { v: clamp01(Math.max((jaw - 0.04) * 3.2, (lower - 0.1) * 2.2, (upper - 0.35) * 1.6)) };
  out['26'] = { v: clamp01(jaw < 0.55 ? (jaw - 0.04) * 2.6 : (0.72 - jaw) * 6) };
  out['27'] = { v: clamp01((jaw - 0.5) * 4) };
  // the eyes: closure (sustained, brief and one-sided closure are told apart over time by the tracker in app.js)
  const bl = get('eyeBlinkLeft'), br = get('eyeBlinkRight');
  out.blink = { L: bl, R: br };
  // gaze: both eyes turned together
  const lookL = Math.min(get('eyeLookOutLeft'), get('eyeLookInRight')), lookR = Math.min(get('eyeLookInLeft'), get('eyeLookOutRight'));
  out['61'] = { v: clamp01((lookL - 0.25) * 2.2) }; out['62'] = { v: clamp01((lookR - 0.25) * 2.2) };
  out['63'] = { v: clamp01((avg2(get('eyeLookUpLeft'), get('eyeLookUpRight')) - 0.25) * 2.2) };
  out['64'] = { v: clamp01((avg2(get('eyeLookDownLeft'), get('eyeLookDownRight')) - 0.35) * 2.2) };
  // the head
  const p = poseDeg || { yaw: 0, pitch: 0, roll: 0 };
  out['51'] = { v: clamp01((p.yaw - 6) / 18) }; out['52'] = { v: clamp01((-p.yaw - 6) / 18) };
  out['53'] = { v: clamp01((p.pitch - 5) / 15) }; out['54'] = { v: clamp01((-p.pitch - 5) / 15) };
  out['55'] = { v: clamp01((p.roll - 5) / 15) }; out['56'] = { v: clamp01((-p.roll - 5) / 15) };
  return out;
}
/* the threshold for the computed entries (head and gaze use 0.35: their intensities already start above a dead zone) */
export const ON = Object.fromEntries(AU_TABLE.map(e => [e.au, e.on || (e.head ? 0.35 : 0.4)]));

/* ---------------------------------------------------------------- the head pose from the tracker's transformation matrix */
/** MediaPipe's facial transformation matrix (column-major 4x4, camera frame, the camera image not mirrored) ->
 *  the person's yaw, pitch and roll in degrees (signs as in auIntensities). The signs were set with the synthetic head
 *  turned, nodded and tilted by known angles (yaw 20 degrees read as 18, pitch 15 as 10-13, roll 15 as 15). */
export function poseFromMatrix(d) {
  // rotation part, row r column c = d[c * 4 + r]
  const r00 = d[0], r10 = d[1], r20 = d[2], r21 = d[6], r22 = d[10];
  const yaw = Math.atan2(-r20, Math.hypot(r21, r22)), pitch = Math.atan2(r21, r22), roll = Math.atan2(r10, r00);
  const deg = 180 / Math.PI;
  return { yaw: POSE_SIGN.yaw * yaw * deg, pitch: POSE_SIGN.pitch * pitch * deg, roll: POSE_SIGN.roll * roll * deg };
}
export const POSE_SIGN = { yaw: 1, pitch: -1, roll: -1 };
/** The head's rotation for a pose (three.js degrees): a reflection turns and tilts toward the same side of the screen as
 *  the person, which is its own opposite side; it nods the same way. */
export function headRotation(p, limit) {
  const L = limit || 25, c = v => Math.max(-L, Math.min(L, v));
  return { x: c(-p.pitch), y: c(-p.yaw), z: c(p.roll) };
}

/* ---------------------------------------------------------------- sample expressions (no camera) */
/* Each sample is a set of blendshape scores, run through exactly the same mapping as the camera: the head moves and
 * the readout lights the actions the table finds. Values are the person's own sides; small asymmetries keep it lifelike. */
export const SAMPLES = [
  { id: 'smile-cheeks', name: 'Smile with raised cheeks', aus: ['6', '12'],
    bs: { mouthSmileLeft: 0.78, mouthSmileRight: 0.72, cheekSquintLeft: 0.42, cheekSquintRight: 0.38, eyeSquintLeft: 0.18, eyeSquintRight: 0.16, mouthUpperUpLeft: 0.12, mouthUpperUpRight: 0.1, mouthDimpleLeft: 0.06 } },
  { id: 'brow-lid', name: 'Brows lowered, lids tightened', aus: ['4', '7'],
    bs: { browDownLeft: 0.62, browDownRight: 0.6, eyeSquintLeft: 0.6, eyeSquintRight: 0.58, mouthPressLeft: 0.08, mouthPressRight: 0.08 } },
  { id: 'brows-up', name: 'Brows raised, eyes widened', aus: ['1', '2', '5'],
    bs: { browInnerUp: 0.62, browOuterUpLeft: 0.6, browOuterUpRight: 0.56, eyeWideLeft: 0.42, eyeWideRight: 0.4, jawOpen: 0.05 } },
  { id: 'nose-lip', name: 'Nose wrinkled, upper lip raised', aus: ['9', '10'],
    bs: { noseSneerLeft: 0.42, noseSneerRight: 0.38, mouthUpperUpLeft: 0.55, mouthUpperUpRight: 0.5, browDownLeft: 0.12, browDownRight: 0.12, cheekSquintLeft: 0.1, cheekSquintRight: 0.1 } },
  { id: 'inner-brows', name: 'Inner brows raised and drawn together', aus: ['1', '4'],
    bs: { browInnerUp: 0.7, browDownLeft: 0.36, browDownRight: 0.34, mouthFrownLeft: 0.06, mouthFrownRight: 0.06 } },
  { id: 'corners-chin', name: 'Lip corners down, chin raised', aus: ['15', '17'],
    bs: { mouthFrownLeft: 0.5, mouthFrownRight: 0.46, mouthShrugLower: 0.6, mouthShrugUpper: 0.3, mouthRollLower: 0.06, browInnerUp: 0.16 } }
];
