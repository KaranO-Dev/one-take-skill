#!/usr/bin/env node
// The score. Reads what the picture asked for (probe.json: scenes, energy, cues) and writes
// stems, a mix and a loudness-normalised master into <built-dir>/score/, then copies the master to
// assets/audio/score.wav, where the composition's <audio id="score"> points.
//
// usage: score.mjs <built-dir> [--take <take.json>]
//        score.mjs --analyze <track>      (prints the track's bpm and first beat as JSON)
//   sound.mode: score (synthesised bed/band/drums + fx) | track | library (their file + fx) | none
//
// In score mode everything is synthesised here, seeded, with no samples and no dependencies: no licence to clear.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { stereo, writeWav, readWav } from './lib/wav.mjs';
import { rng, mtof, db, clamp, TAU, addMono, biquad, saw, square, reverb, pingPong, limit, mixInto, edgeFade } from './lib/dsp.mjs';

const SR = 48000;

// ---------- harmony ----------
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10] };
// chord roots as scale degrees, one per bar, looped
const MOODS = {
  bright: { scale: 'major', prog: [0, 4, 5, 3] },
  warm: { scale: 'major', prog: [0, 5, 3, 4] },
  cool: { scale: 'minor', prog: [0, 5, 2, 6] },
  tense: { scale: 'minor', prog: [0, 0, 5, 4] },
  dreamy: { scale: 'lydian', prog: [0, 1, 0, 1] },
  drive: { scale: 'dorian', prog: [0, 3, 0, 6] },
};

export function harmony(sound) {
  const mood = MOODS[sound.mood] || MOODS.cool;
  const scale = SCALES[sound.scale || mood.scale];
  const root = 48 + (NOTE[sound.key || 'D'] ?? 2); // C3..B3
  const degree = (d) => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return root + scale[i] + 12 * o; };
  const chordAt = (barIndex) => { const r = mood.prog[barIndex % mood.prog.length]; return { root: r, notes: [r, r + 2, r + 4, r + 6].map(degree) }; };
  return { root, scale, degree, chordAt, prog: mood.prog };
}

// ---------- instruments ----------
function kick(len = 0.45) { const n = Math.round(len * SR), s = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR, f = 46 + 120 * Math.exp(-t / 0.028); ph += f / SR; s[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.32) + (i < 90 ? (1 - i / 90) * 0.35 * Math.sin(i * 1.7) : 0); } return s; }
function noiseHit(len, r, filters, tau) { const n = Math.round(len * SR), s = new Float32Array(n); const fs = filters.map(([ty, f, q]) => biquad(ty, f, SR, q || 0.8)); for (let i = 0; i < n; i++) { let v = r() * 2 - 1; for (const f of fs) v = f(v); s[i] = v * Math.exp(-(i / SR) / tau); } return s; }
function snare(r) { const a = noiseHit(0.3, r, [['bp', 1900, 0.7]], 0.14), n = a.length; for (let i = 0; i < n; i++) a[i] = a[i] * 1.6 + Math.sin(TAU * 185 * i / SR) * Math.exp(-i / SR / 0.06) * 0.5; return a; }
function clap(r) { const out = new Float32Array(Math.round(0.35 * SR)); for (const off of [0, 0.011, 0.022]) { const h = noiseHit(off ? 0.02 : 0.3, r, [['bp', 1400, 1.1]], off ? 0.006 : 0.12); const o = Math.round((off + (off ? 0 : 0.03)) * SR); for (let i = 0; i < h.length && o + i < out.length; i++) out[o + i] += h[i] * 1.8; } return out; }
function hat(r, open) { return noiseHit(open ? 0.3 : 0.06, r, [['hp', 7200, 0.7], ['hp', 6000, 0.7]], open ? 0.12 : 0.022); }

function tone(freq, len, { type = 'sine', a = 0.003, tau = 0.15, drop = 0, fm = 0, ratio = 3.5 } = {}) {
  const n = Math.round(len * SR), s = new Float32Array(n); let ph = 0, mp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, f = freq * Math.pow(2, (-drop * Math.min(t / 0.08, 1)) / 12);
    mp += (f * ratio) / SR; const mod = fm ? Math.sin(TAU * mp) * fm * Math.exp(-t / (tau * 0.6)) : 0;
    ph += f / SR; const p = (ph + mod) % 1, x = type === 'sine' ? Math.sin(TAU * p) : type === 'tri' ? 1 - 4 * Math.abs(p - 0.5) : type === 'saw' ? saw(p, f / SR) : square(p, f / SR);
    s[i] = x * Math.min(1, t / a) * Math.exp(-t / tau);
  }
  return s;
}
// band-passed noise swept from f0 to f1 (log), rising then falling in level
function sweep(len, f0, f1, r, { q = 1.2, peak = 0.6, back } = {}) {
  const n = Math.round(len * SR), s = new Float32Array(n), bq = biquad('bp', f0, SR, q);
  for (let i = 0; i < n; i++) {
    const k = i / n, f = back ? (k < 0.6 ? f0 * Math.pow(f1 / f0, k / 0.6) : f1 * Math.pow(back / f1, (k - 0.6) / 0.4)) : f0 * Math.pow(f1 / f0, k);
    if ((i & 31) === 0) bq.set(f);
    const env = k < peak ? Math.pow(k / peak, 1.6) : Math.pow(1 - (k - peak) / (1 - peak), 2.2);
    s[i] = bq(r() * 2 - 1) * env * 2.2;
  }
  return s;
}
function stab(notes, len = 0.5) {
  const n = Math.round(len * SR), s = new Float32Array(n), lp = biquad('lp', 4000, SR, 0.9), ph = notes.flatMap(() => [0, 0.33, 0.66]);
  for (let i = 0; i < n; i++) {
    const t = i / SR; if ((i & 31) === 0) lp.set(500 + 5200 * Math.exp(-t / 0.07));
    let v = 0; notes.forEach((m, j) => { for (let d = 0; d < 3; d++) { const f = mtof(m) * (1 + (d - 1) * 0.006), k = j * 3 + d; ph[k] = (ph[k] + f / SR) % 1; v += saw(ph[k], f / SR); } });
    s[i] = lp(v / (notes.length * 2)) * Math.min(1, t / 0.004) * Math.exp(-t / 0.22);
  }
  return s;
}
function boom(len = 1.2) { const n = Math.round(len * SR), s = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR, f = 34 + 52 * Math.exp(-t / 0.09); ph += f / SR; s[i] = Math.tanh(Math.sin(TAU * ph) * 1.6 * Math.exp(-t / 0.5)); } return s; }
function crush(sig, bits = 5, hold = 6) { const q = Math.pow(2, bits - 1); let h = 0; for (let i = 0; i < sig.length; i++) { if (i % hold === 0) h = Math.round(sig[i] * q) / q; sig[i] = h; } return sig; }

// ---------- SFX: one case per category, tuned to the chord under it ----------
// returns [{ sig, at (offset s), gain, send }] for a cue
const ALIAS = { type: 'key', keys: 'key', typing: 'key', reflow: 'tick', count: 'tick', press: 'click', tap: 'click', hover: 'detent', scroll: 'detent', toggle: 'switch', word: 'pop', card: 'page', flip: 'page', paper: 'page', swoosh: 'whoosh', transition: 'whoosh', drop: 'impact', hit: 'impact', boom: 'impact', bell: 'chime', ding: 'chime', note: 'motif', sting: 'stab', settle: 'land', thud: 'land', build: 'riser', rise: 'rise', glitch: 'glitch', end: 'end', logo: 'end' };
function sfx(c, ctx) {
  const name = ALIAS[c.n] || c.n, r = ctx.r, chord = ctx.chord(c.t), s = c.s != null ? c.s : 0.5, p = c.p || 0;
  const hi = (o = 2) => mtof(chord.notes[p % 3] + 12 * o);
  switch (name) {
    case 'pop': return [{ sig: tone(hi(2), 0.22, { tau: 0.07, drop: 1.5, type: 'tri' }), gain: 0.32, send: 0.18 }, { sig: noiseHit(0.01, r, [['hp', 3000]], 0.002), gain: 0.12 }];
    case 'tick': return [{ sig: tone(2900 + r() * 500, 0.03, { tau: 0.006 }), gain: 0.16 * (0.6 + s), send: 0.02 }, { sig: noiseHit(0.01, r, [['hp', 6000]], 0.002), gain: 0.07 }];
    case 'detent': return [{ sig: noiseHit(0.012, r, [['bp', 4200, 2]], 0.0025), gain: 0.22 }];
    case 'click': return [{ sig: noiseHit(0.015, r, [['bp', 1900, 1.4]], 0.003), gain: 0.42 }, { sig: tone(320, 0.04, { tau: 0.012 }), gain: 0.2, at: 0.001 }];
    case 'switch': return [{ sig: noiseHit(0.012, r, [['bp', 2600, 1.6]], 0.0025), gain: 0.3 }, { sig: noiseHit(0.012, r, [['bp', 1800, 1.6]], 0.0025), gain: 0.25, at: 0.028 }, { sig: tone(hi(2), 0.18, { tau: 0.05, type: 'sine' }), gain: 0.1, send: 0.2, at: 0.03 }];
    case 'key': { const f = 1100 + r() * 1400; return [{ sig: noiseHit(0.025, r, [['bp', f, 1.3]], 0.006), gain: 0.28 * (0.7 + s * 0.6) }, { sig: tone(160 + r() * 40, 0.04, { tau: 0.012 }), gain: 0.16 }]; }
    case 'page': return [{ sig: sweep(0.18, 2200, 5200, r, { q: 0.9, peak: 0.2 }), gain: 0.2 }, { sig: noiseHit(0.03, r, [['bp', 3000, 1]], 0.008), gain: 0.15, at: 0.12 }];
    case 'swish': return [{ sig: sweep(c.d ? Math.min(c.d, 0.6) : 0.35, 700, 3600, r, { q: 1.1, peak: 0.55 }), gain: 0.16 * (0.5 + s), send: 0.1 }];
    case 'rise': return [{ sig: sweep(Math.min(c.d || 0.5, 0.7), 900, 4200, r, { q: 1.4, peak: 0.45 }), gain: 0.11 * (0.5 + s), send: 0.12 }, { sig: tone(hi(2), 0.6, { tau: 0.25, fm: 0.8, ratio: 2 }), gain: 0.07, send: 0.4, at: 0.05 }];
    case 'whoosh': { const d = clamp(c.d || 0.7, 0.3, 1.6); return [{ sig: sweep(d, 260, 4800, r, { q: 0.9, peak: 0.62, back: 900 }), gain: 0.34 * (0.5 + s), send: 0.22 }, { sig: tone(55, d, { tau: d * 0.5, a: d * 0.5 }), gain: 0.18 }]; }
    case 'land': return [{ sig: tone(110, 0.3, { tau: 0.09, drop: 14 }), gain: 0.42 * (0.5 + s) }, { sig: noiseHit(0.08, r, [['lp', 2200]], 0.02), gain: 0.12, send: 0.1 }];
    case 'impact': return [{ sig: boom(1.1), gain: 0.42 * (0.5 + s) }, { sig: noiseHit(0.25, r, [['hp', 900]], 0.06), gain: 0.32, send: 0.45 }, { sig: stab(chord.notes.slice(0, 3).map((m) => m + 12), 0.5), gain: 0.18, send: 0.4 }];
    case 'stab': return [{ sig: stab(chord.notes.slice(0, 3).map((m) => m + 12), 0.55), gain: 0.36 * (0.5 + s), send: 0.35 }, { sig: tone(mtof(chord.notes[0] - 12), 0.4, { tau: 0.16 }), gain: 0.25 }];
    case 'motif': { const seq = ctx.motif, m = ctx.harm.degree(seq[ctx.motifI++ % seq.length] + 14); return [{ sig: tone(mtof(m), 1.4, { tau: 0.5, fm: 1.2, ratio: 3.5 }), gain: 0.22, send: 0.5 }]; }
    case 'chime': return [{ sig: tone(hi(3), 1.6, { tau: 0.6, fm: 1.5, ratio: 3.5 }), gain: 0.16 * (0.5 + s), send: 0.55 }];
    case 'glitch': { const g = crush(tone(220 + r() * 600, 0.09, { type: 'square', tau: 0.05 }), 4, 9); return [{ sig: g, gain: 0.18 }, { sig: crush(noiseHit(0.06, r, [['bp', 3000, 0.7]], 0.02), 3, 14), gain: 0.14, at: 0.04 }]; }
    case 'riser': { const d = c.d || ctx.bar; return [{ sig: sweep(d, 300, 9000, r, { q: 0.8, peak: 0.97 }), gain: 0.24, send: 0.3, at: -d }]; }
    case 'end': return [{ sig: boom(1.6), gain: 0.38 }, { sig: stab(chord.notes.map((m) => m + 12), 1.2), gain: 0.22, send: 0.6 }, { sig: tone(mtof(ctx.harm.degree(14 + 4)), 2.4, { tau: 0.9, fm: 1.2, ratio: 3.5 }), gain: 0.14, send: 0.6, at: 0.02 }];
    default: return [{ sig: tone(hi(2), 0.2, { tau: 0.06, drop: 1, type: 'tri' }), gain: 0.25, send: 0.15 }];
  }
}
const INTENSITY = { off: 0, subtle: 0.6, normal: 1, bold: 1.35 };
const MIN_GAP = { tick: 0.03, detent: 0.03, key: 0.025, pop: 0.04, click: 0.04, whoosh: 0.25, impact: 0.4, land: 0.08 };

// ---------- arrangement ----------
function arrange(P, sound, harm, seed) {
  const dur = P.duration, beat = 60 / P.bpm, bpb = P.beatsPerBar || 4, bar = beat * bpb, r = rng(seed);
  const bed = stereo(SR, dur), band = stereo(SR, dur), drums = stereo(SR, dur), side = new Float32Array(Math.ceil(dur * SR)).fill(1);
  const scenes = P.scenes, last = scenes[scenes.length - 1];
  const sceneAt = (t) => scenes.find((s) => t >= s.start - 1e-6 && t < s.start + s.dur - 1e-6) || last;
  const endT = P.marks?.endCard ?? last.start;
  const nBars = Math.ceil(dur / bar);

  // --- drums, with a kick sidechain envelope for the bed and bass
  const K = kick(), SN = snare(r), CL = clap(r);
  for (let b = 0; b < nBars; b++) for (let q = 0; q < bpb * 4; q++) {
    const t = b * bar + q * beat / 4; if (t >= dur) break;
    const sc = sceneAt(t), e = sc.energy, isEnd = sc.end || t >= endT - 0.01, beatI = q / 4, onBeat = q % 4 === 0;
    const toNext = sc.start + sc.dur - t, nextSc = scenes[scenes.indexOf(sc) + 1];
    const lift = nextSc && nextSc.energy - e >= 0.15;
    if (isEnd) continue;
    if (lift && toNext <= beat + 1e-6) { // pre-drop: a 16th snare roll into the next scene, kick drops out
      addMono(drums, SN, t, 0.12 + 0.25 * (1 - toNext / beat), 0.1); continue;
    }
    if (onBeat && e >= 0.45 && (e >= 0.7 || beatI % 2 === 0)) {
      addMono(drums, K, t, 0.95, 0);
      const o = Math.round(t * SR); for (let i = 0; i < 0.22 * SR && o + i < side.length; i++) side[o + i] = Math.min(side[o + i], 1 - 0.55 * Math.exp(-i / SR / 0.07));
    }
    if (onBeat && e >= 0.6 && beatI % 2 === 1) addMono(drums, e >= 0.75 ? CL : SN, t, 0.42, 0.05);
    if (e >= 0.3 && q % 2 === 0) { const off = q % 4 === 2; addMono(drums, hat(r, off && e >= 0.8 && q % 16 === 14), t + (r() - 0.5) * 0.004, (off ? 0.2 : 0.12) * (0.6 + e * 0.5) * (0.85 + r() * 0.3), q % 4 ? 0.25 : -0.2); }
    if (e >= 0.65 && q % 2 === 1) addMono(drums, hat(r, false), t, 0.05, 0.35);
  }

  // --- bed: a slow pad on the chord of each bar, filter opening with energy
  const voices = [];
  for (let b = 0; b < nBars; b++) {
    const t0 = b * bar, ch = harm.chordAt(b), isEndBar = t0 >= endT - bar * 0.5;
    const notes = isEndBar ? [harm.degree(0), harm.degree(4), harm.degree(7 + 1), harm.degree(7 + 2)] : ch.notes; // the end resolves home, add9
    for (const m of notes) voices.push({ m, t0, t1: Math.min(dur, t0 + bar), last: isEndBar });
  }
  const padL = new Float32Array(side.length), padR = new Float32Array(side.length);
  for (const v of voices) {
    const f = mtof(v.m), n0 = Math.round(v.t0 * SR), n1 = Math.round((v.last ? dur : v.t1 + 0.35) * SR), ph = [0, 0.37, 0.71], det = [-0.007, 0, 0.0065];
    for (let i = n0; i < n1 && i < padL.length; i++) {
      const t = (i - n0) / SR, len = (v.t1 - v.t0) || bar, att = Math.min(1, t / (bar * 0.22)), rel = t > len ? Math.max(0, 1 - (t - len) / 0.35) : 1;
      let l = 0, rr = 0;
      for (let d = 0; d < 3; d++) { const fd = f * (1 + det[d]); ph[d] = (ph[d] + fd / SR) % 1; const x = saw(ph[d], fd / SR); l += x * (d === 2 ? 0.4 : 1); rr += x * (d === 0 ? 0.4 : 1); }
      const g = att * rel * 0.09;
      padL[i] += l * g; padR[i] += rr * g;
    }
  }
  const lpL = biquad('lp', 900, SR, 0.6), lpR = biquad('lp', 900, SR, 0.6), hpL = biquad('hp', 90, SR), hpR = biquad('hp', 90, SR);
  let bedE = 1;
  const fade = Math.round(0.35 * SR), endFade = Math.round(Math.min(0.8, dur * 0.05) * SR);
  for (let i = 0; i < padL.length; i++) {
    if ((i & 63) === 0) { const t = i / SR, sc = sceneAt(t), k = (t - sc.start) / sc.dur, swell = Math.sin(Math.PI * clamp(k, 0, 1)) * 0.25; const f = 600 + 4200 * clamp(sc.energy * 0.85 + swell, 0, 1); lpL.set(f); lpR.set(f); }
    // level follows the scene's energy, so quiet scenes are quiet and the film has a shape (LRA)
    if ((i & 1023) === 0) bedE = 0.45 + 0.75 * sceneAt(i / SR).energy;
    const g = Math.min(1, i / fade) * Math.min(1, (padL.length - i) / endFade) * (0.55 + 0.45 * side[i]) * bedE;
    bed.L[i] = hpL(lpL(padL[i])) * g; bed.R[i] = hpR(lpR(padR[i])) * g;
  }

  // --- band: bass on the root, an arp on the chord tones when the energy is up
  const bassLP = biquad('lp', 700, SR, 0.9);
  const bass = new Float32Array(side.length), arpBuf = stereo(SR, dur);
  for (let b = 0; b < nBars; b++) {
    const ch = harm.chordAt(b), rootM = ch.notes[0] - 12;
    for (let q = 0; q < bpb * 2; q++) {
      const t = b * bar + q * beat / 2; if (t >= dur) break;
      const sc = sceneAt(t), e = sc.energy; if (sc.end || t >= endT - 0.01 || e < 0.35) continue;
      const play = e >= 0.6 ? true : q % bpb === 0; if (!play) continue;
      // sine plus some saw: enough harmonics for the bass to read on a phone speaker
      const m = e >= 0.6 && q % 2 === 1 ? rootM + 12 : rootM, len = e >= 0.6 ? beat * 0.45 : beat * 1.8;
      const f = mtof(m), n0 = Math.round(t * SR), n = Math.round((len + 0.08) * SR); let ph = 0;
      for (let i = 0; i < n && n0 + i < bass.length; i++) { const tt = i / SR; ph = (ph + f / SR) % 1; const env = Math.min(1, tt / 0.004) * (tt < len ? Math.exp(-tt / (len * 1.5)) : Math.exp(-(len) / (len * 1.5)) * Math.max(0, 1 - (tt - len) / 0.08)); bass[n0 + i] += (Math.sin(TAU * ph) * 0.6 + saw(ph, f / SR) * 0.4) * env * 0.5; }
    }
    for (let q = 0; q < bpb * 4; q++) {
      const t = b * bar + q * beat / 4; if (t >= dur) break;
      const sc = sceneAt(t), e = sc.energy; if (sc.end || t >= endT - 0.01 || e < 0.55) continue;
      if (e < 0.7 && q % 2) continue;
      const pat = [0, 1, 2, 3, 2, 1, 0, 2], idx = pat[q % pat.length], m = ch.notes[idx % 4] + 12 + (q % 8 >= 4 ? 12 : 0);
      const sig = tone(mtof(m), 0.25, { type: 'square', tau: 0.07 }); filterLP(sig, 2600);
      addMono(arpBuf, sig, t, 0.06 * (0.8 + r() * 0.3), ((q % 4) - 1.5) * 0.25);
    }
  }
  for (let i = 0; i < bass.length; i++) { const v = bassLP(bass[i]) * (0.45 + 0.55 * side[i]); band.L[i] += v; band.R[i] += v; }
  const dl = pingPong(arpBuf, beat * 0.75, 0.38, 0.5, 3800);
  mixInto(band, arpBuf); mixInto(band, dl);

  // --- transitions: a riser into every lift, an impact on the arrival
  const trans = [];
  scenes.forEach((s, i) => {
    if (!i) return;
    const prev = scenes[i - 1], jump = s.energy - prev.energy;
    if (jump >= 0.15) trans.push({ n: 'riser', t: s.start, d: Math.min(bar, prev.dur), s: 0.6 }, { n: 'impact', t: s.start, s: clamp(0.4 + jump, 0.4, 1) });
    else if (!s.in) trans.push({ n: 'swish', t: s.start - 0.05, d: 0.4, s: 0.4 });
  });
  return { bed, band, drums, trans };
}
function filterLP(sig, f) { const bq = biquad('lp', f, SR, 0.7); for (let i = 0; i < sig.length; i++) sig[i] = bq(sig[i]); }

function placeFx(P, cues, harm, sound, seed, bar) {
  const fx = stereo(SR, P.duration), send = stereo(SR, P.duration), r = rng(seed * 7 + 1), level = INTENSITY[sound.sfx || 'normal'] ?? 1;
  const ctx = { r, harm, bar, motif: sound.motif || [4, 2, 0, 4, 5, 4], motifI: 0, chord: (t) => harm.chordAt(Math.floor(t / bar)) };
  const lastAt = {}, marks = [];
  for (const c of cues.slice().sort((a, b) => a.t - b.t)) {
    const name = ALIAS[c.n] || c.n;
    if (lastAt[name] != null && c.t - lastAt[name] < (MIN_GAP[name] || 0.02)) continue;
    lastAt[name] = c.t;
    const pan = c.x != null ? clamp((c.x - 0.5) * 1.4, -0.8, 0.8) : 0;
    const jitter = ['stab', 'motif', 'impact', 'end', 'riser'].includes(name) ? 0 : (r() - 0.5) * 0.006, vel = 0.92 + r() * 0.16;
    for (const part of sfx(c, ctx)) {
      const at = c.t + (part.at || 0) + jitter, g = part.gain * level * vel;
      addMono(fx, part.sig, at, g, pan);
      if (part.send) addMono(send, part.sig, at, g * part.send, pan);
    }
    marks.push([c.t, name]);
  }
  return { fx, send, marks };
}

// ---------- loudness ----------
function spawnStderr(args) { const p = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); if (p.status) throw new Error(p.stderr.slice(-800)); return p.stderr; }
// Two-pass EBU R128 normalisation to the target, linear so the dynamics stay as mixed.
function loudnorm(inFile, outFile, I = -14, TP = -1.5) {
  const res = spawnStderr(['-hide_banner', '-nostats', '-y', '-i', inFile, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(res.slice(res.lastIndexOf('{'), res.lastIndexOf('}') + 1));
  const f = `loudnorm=I=${I}:TP=${TP}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  spawnStderr(['-hide_banner', '-nostats', '-y', '-i', inFile, '-af', f, '-ar', String(SR), '-c:a', 'pcm_s24le', outFile]);
  return j;
}

// ---------- track mode helpers ----------
function loadTrack(file, dur, tmp) {
  const wav = join(tmp, 'track-48k.wav');
  spawnStderr(['-hide_banner', '-y', '-i', file, '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_f32le', wav]);
  const t = readWav(wav), out = stereo(SR, dur), n = out.L.length, fo = Math.round(Math.min(1.2, dur * 0.06) * SR);
  for (let i = 0; i < n && i < t.L.length; i++) { const g = Math.min(1, (n - i) / fo); out.L[i] = t.L[i] * g; out.R[i] = t.R[i] * g; }
  return out;
}
// Tempo and first beat from an onset envelope (autocorrelation). Accurate enough to lay a cut grid on.
export function analyze(file) {
  // the 48 kHz copy goes to a temp folder, never next to the user's track, and is removed afterwards
  const tmp = mkdtempSync(join(tmpdir(), 'one-take-analyze-')), wav = join(tmp, 'track-48k.wav');
  let t;
  try {
    spawnStderr(['-hide_banner', '-y', '-i', file, '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_f32le', wav]);
    t = readWav(wav);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const hop = 480, n = Math.floor(t.L.length / hop), env = new Float32Array(n);
  let prev = 0; for (let i = 0; i < n; i++) { let e = 0; for (let j = 0; j < hop; j++) { const v = t.L[i * hop + j] + t.R[i * hop + j]; e += v * v; } e = Math.log(1e-9 + e); env[i] = Math.max(0, e - prev); prev = e; }
  let best = 120, bestV = -1;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) { const lag = (60 / bpm) * (SR / hop); let v = 0; for (let i = 0; i + lag * 2 < n; i++) { const a = Math.round(i + lag), b = Math.round(i + lag * 2); v += env[i] * (env[a] + 0.5 * env[b]); } v /= Math.sqrt(bpm); if (v > bestV) { bestV = v; best = bpm; } }
  const period = (60 / best) * (SR / hop); let ph = 0, phV = -1;
  for (let o = 0; o < period; o++) { let v = 0; for (let k = o; k < n; k += period) v += env[Math.round(k)] || 0; if (v > phV) { phV = v; ph = o; } }
  return { bpm: best, firstBeat: +(ph * hop / SR).toFixed(3), duration: +(t.L.length / SR).toFixed(2) };
}

// ---------- main ----------
export function score(dir, takePath) {
  dir = resolve(dir);
  const P = JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'));
  const take = JSON.parse(readFileSync(takePath || join(dir, '..', '..', 'take.json'), 'utf8'));
  const sound = Object.assign({ mode: 'score', sfx: 'normal', lufs: -14, tp: -1.5, mood: 'cool', key: 'D' }, take.sound);
  if (sound.mode === 'none') { console.error('score: sound.mode none, skipped'); return null; }
  P.beatsPerBar = take.beatsPerBar || 4;
  const seed = take.seed || 1, harm = harmony(sound), bar = (60 / P.bpm) * P.beatsPerBar;
  const sdir = join(dir, 'score'), stems = join(sdir, 'stems'); mkdirSync(stems, { recursive: true });

  let bed, band, drums, trans = [];
  if (sound.mode === 'score') ({ bed, band, drums, trans } = arrange(P, sound, harm, seed));
  else {
    const src = resolve(dirname(takePath || join(dir, '..', '..', 'take.json')), sound.track || '');
    if (!sound.track || !existsSync(src)) throw new Error(`sound.mode ${sound.mode} needs sound.track pointing at a file (got ${sound.track})`);
    bed = loadTrack(src, P.duration, sdir); band = stereo(SR, P.duration); drums = stereo(SR, P.duration);
  }
  const { fx, send, marks } = placeFx(P, [...P.cues, ...trans], harm, sound, seed, bar);

  // voiceover: if assets/audio/vo.wav exists, carve the music under it
  const voPath = join(dir, 'assets', 'audio', 'vo.wav');
  if (existsSync(voPath)) {
    const vo = loadTrack(voPath, P.duration, sdir); let env = 0; const att = Math.exp(-1 / (0.02 * SR)), rel = Math.exp(-1 / (0.35 * SR)), depth = db(sound.duckDb ?? -9);
    for (let i = 0; i < bed.L.length; i++) { const x = Math.abs(vo.L[i]) + Math.abs(vo.R[i]); env = x > env ? x + (env - x) * att : x + (env - x) * rel; const g = 1 - (1 - depth) * clamp(env * 8, 0, 1); bed.L[i] *= g; bed.R[i] *= g; band.L[i] *= g; band.R[i] *= g; }
  }

  // one shared room for the bed and the fx sends
  const room = stereo(SR, P.duration); mixInto(room, bed, sound.mode === 'score' ? 0.5 : 0); mixInto(room, send, 1);
  const verb = reverb(room, { room: 0.84, damp: 0.4, wet: 0.9, width: 1 });
  const G = Object.assign({ bed: 0.62, band: 0.5, drums: 0.62, fx: 0.85, verb: 0.38 }, sound.gains);
  if (sound.mode === 'score') { mixInto(bed, verb, G.verb * 0.6); mixInto(fx, verb, G.verb * 0.4); } else mixInto(fx, verb, G.verb);
  for (const b of [bed, band, drums, fx]) edgeFade(b, 0.002, 0.03);
  writeWav(join(stems, 'bed.wav'), bed, 32); writeWav(join(stems, 'band.wav'), band, 32); writeWav(join(stems, 'drums.wav'), drums, 32); writeWav(join(stems, 'fx.wav'), fx, 32);

  const mix = stereo(SR, P.duration);
  mixInto(mix, bed, sound.mode === 'score' ? G.bed : (sound.trackGain ?? 0.9)); mixInto(mix, band, G.band); mixInto(mix, drums, G.drums); mixInto(mix, fx, G.fx);
  if (existsSync(voPath)) mixInto(mix, loadTrack(voPath, P.duration, sdir), sound.voGain ?? 1);
  // master EQ: nothing under 30 Hz, a little less sub (phones can't play it and it eats loudness), a little air
  const eq = [0, 1].map(() => [biquad('hp', 30, SR, 0.7), biquad('lowshelf', 110, SR, 0.7, sound.lowShelfDb ?? -3), biquad('highshelf', 6500, SR, 0.7, 1.5)]);
  for (let i = 0; i < mix.L.length; i++) { let l = mix.L[i], r = mix.R[i]; for (const f of eq[0]) l = f(l); for (const f of eq[1]) r = f(r); mix.L[i] = l; mix.R[i] = r; }
  limit(mix, -3, 0.06);
  writeWav(join(sdir, 'mix.wav'), mix, 32);
  const m = loudnorm(join(sdir, 'mix.wav'), join(sdir, 'master.wav'), sound.lufs, sound.tp);
  writeFileSync(join(sdir, 'marks.json'), JSON.stringify(marks));
  mkdirSync(join(dir, 'assets', 'audio'), { recursive: true });
  copyFileSync(join(sdir, 'master.wav'), join(dir, 'assets', 'audio', 'score.wav'));
  const info = { mode: sound.mode, key: sound.key, mood: sound.mood, bpm: P.bpm, cues: P.cues.length, placed: marks.length, inputLufs: +m.input_i, target: sound.lufs };
  writeFileSync(join(sdir, 'score.json'), JSON.stringify(info, null, 1));
  return info;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), ai = a.indexOf('--analyze');
  if (ai >= 0) { console.log(JSON.stringify(analyze(a[ai + 1]))); process.exit(0); }
  const ti = a.indexOf('--take'), dir = a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--take');
  if (!dir) { console.error('usage: score.mjs <built-dir> [--take take.json] | --analyze <track>'); process.exit(2); }
  const t0 = Date.now(), info = score(dir, ti >= 0 ? a[ti + 1] : undefined);
  if (info) console.error(`score ${dir}: ${info.placed}/${info.cues} cues placed, ${info.mood} in ${info.key} at ${info.bpm} bpm, mix ${info.inputLufs} LUFS → ${info.target} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
