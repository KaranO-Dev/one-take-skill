// Small, dependency-free DSP toolkit for the score: seeded noise, oscillators,
// filters, a Freeverb-style reverb, delay and a peak limiter.

export const TAU = Math.PI * 2;

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const db = (d) => Math.pow(10, d / 20);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Equal-power pan, p in [-1, 1].
const panGains = (p) => { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; };

// Add a mono signal into a stereo buffer at time t (seconds).
export function addMono(buf, sig, t, gain = 1, pan = 0) {
  const [gl, gr] = panGains(pan);
  const o = Math.round(t * buf.sr);
  for (let i = 0; i < sig.length; i++) {
    const j = o + i; if (j < 0) continue; if (j >= buf.L.length) break;
    buf.L[j] += sig[i] * gain * gl; buf.R[j] += sig[i] * gain * gr;
  }
}

// --- filters ---
// RBJ biquad; type: lp | hp | bp | peak | lowshelf | highshelf
export function biquad(type, f, sr, q = 0.707, gainDb = 0) {
  let b0, b1, b2, a0, a1, a2;
  const set = (freq) => {
    const w = TAU * clamp(freq, 10, sr * 0.45) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), A = Math.pow(10, gainDb / 40);
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'peak') { b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    else if (type === 'lowshelf' || type === 'highshelf') {
      const sq = 2 * Math.sqrt(A) * al, sgn = type === 'lowshelf' ? 1 : -1;
      b0 = A * ((A + 1) - sgn * (A - 1) * c + sq); b1 = 2 * sgn * A * ((A - 1) - sgn * (A + 1) * c); b2 = A * ((A + 1) - sgn * (A - 1) * c - sq);
      a0 = (A + 1) + sgn * (A - 1) * c + sq; a1 = -2 * sgn * ((A - 1) + sgn * (A + 1) * c); a2 = (A + 1) + sgn * (A - 1) * c - sq;
    }
    b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  };
  set(f);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const fn = (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
  fn.set = set;
  return fn;
}

// --- oscillators (phase-accumulating; PolyBLEP-corrected so they don't alias) ---
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
export function saw(phase, dt) { return 2 * phase - 1 - polyBlep(phase, dt); }
export function square(phase, dt) { let v = phase < 0.5 ? 1 : -1; v += polyBlep(phase, dt); v -= polyBlep((phase + 0.5) % 1, dt); return v; }

// --- reverb: Freeverb (8 combs + 4 allpasses per channel) ---
export function reverb(buf, { room = 0.82, damp = 0.35, wet = 0.25, width = 1, pre = 0.012 } = {}) {
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], apT = [556, 441, 341, 225];
  const k = buf.sr / 44100, spread = 23;
  const mk = (n) => ({ b: new Float32Array(Math.round(n * k)), i: 0, f: 0 });
  const chans = [0, 1].map((c) => ({ combs: combT.map((n) => mk(n + c * spread)), aps: apT.map((n) => mk(n + c * spread)) }));
  const preN = Math.round(pre * buf.sr), preL = new Float32Array(preN + 1), preR = new Float32Array(preN + 1);
  const n = buf.L.length, outL = new Float32Array(n), outR = new Float32Array(n);
  let pi = 0;
  for (let i = 0; i < n; i++) {
    const inp = (preL[pi] + preR[pi]) * 0.015;
    preL[pi] = buf.L[i]; preR[pi] = buf.R[i]; pi = (pi + 1) % preL.length;
    const o = [0, 0];
    for (let c = 0; c < 2; c++) {
      const ch = chans[c]; let s = 0;
      for (const cb of ch.combs) { const y = cb.b[cb.i]; cb.f = y * (1 - damp) + cb.f * damp; cb.b[cb.i] = inp + cb.f * room; cb.i = (cb.i + 1) % cb.b.length; s += y; }
      for (const ap of ch.aps) { const y = ap.b[ap.i]; ap.b[ap.i] = s + y * 0.5; ap.i = (ap.i + 1) % ap.b.length; s = y - s; }
      o[c] = s;
    }
    const w1 = wet * (width / 2 + 0.5), w2 = wet * ((1 - width) / 2);
    outL[i] = o[0] * w1 + o[1] * w2; outR[i] = o[1] * w1 + o[0] * w2;
  }
  return { sr: buf.sr, L: outL, R: outR };
}

// Ping-pong delay, returns the wet signal only.
export function pingPong(buf, time, fb = 0.35, wet = 0.3, lp = 4500) {
  const n = buf.L.length, d = Math.round(time * buf.sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const fl = biquad('lp', lp, buf.sr), fr = biquad('lp', lp, buf.sr);
  for (let i = 0; i < n; i++) {
    const dl = i >= d ? L[i - d] : 0, dr = i >= d ? R[i - d] : 0;
    L[i] = fl((buf.L[i] + buf.R[i]) * 0.5 + dr * fb);
    R[i] = fr(dl);
  }
  for (let i = 0; i < n; i++) { L[i] *= wet; R[i] *= wet; }
  return { sr: buf.sr, L, R };
}

// Lookahead peak limiter on a stereo buffer, in place.
export function limit(buf, ceilingDb = -1, release = 0.08, look = 0.004) {
  const c = db(ceilingDb), n = buf.L.length, la = Math.round(look * buf.sr), rel = Math.exp(-1 / (release * buf.sr));
  let g = 1;
  const peak = new Float32Array(n);
  for (let i = 0; i < n; i++) peak[i] = Math.max(Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  // running max over the lookahead window
  const need = new Float32Array(n);
  for (let i = n - 1, m = 0, q = []; i >= 0; i--) {
    while (q.length && peak[q[q.length - 1]] <= peak[i]) q.pop();
    q.push(i); while (q[0] > i + la) q.shift();
    m = peak[q[0]]; need[i] = m > c ? c / m : 1;
  }
  for (let i = 0; i < n; i++) { const t = need[i]; g = t < g ? t : t + (g - t) * rel; buf.L[i] *= g; buf.R[i] *= g; }
  return buf;
}

export function mixInto(dst, src, gain = 1) { for (let i = 0; i < dst.L.length && i < src.L.length; i++) { dst.L[i] += src.L[i] * gain; dst.R[i] += src.R[i] * gain; } return dst; }

// Short fade at both ends so stems never click.
export function edgeFade(buf, inS = 0.004, outS = 0.05) {
  const a = Math.round(inS * buf.sr), b = Math.round(outS * buf.sr), n = buf.L.length;
  for (let i = 0; i < a; i++) { buf.L[i] *= i / a; buf.R[i] *= i / a; }
  for (let i = 0; i < b; i++) { const k = i / b; buf.L[n - 1 - i] *= k; buf.R[n - 1 - i] *= k; }
  return buf;
}
