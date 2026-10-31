#!/usr/bin/env node
// Check a finished file against what was asked for. Every check returns pass | warn | fail with the value it saw.
// usage: qa.mjs <final.mp4> --build <built-dir> [--take take.json]
// writes <final>.qa.json and <final>.sheet.jpg (the contact sheet) next to the file
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveFormat } from './lib/platforms.mjs';

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 }).stderr || '';
const probeJson = (f) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f], { encoding: 'utf8' }).stdout);

export const DEFAULTS = { lufs: [-16.5, -13.5], tpMax: -1.0, endHoldSec: 3, minTextPct: 3.4, hardMinTextPct: 2.6, blackMaxSec: 0.4, freezeMaxSec: 1.5, silenceMaxSec: 0.8 };

function intervals(log, key) {
  const out = []; let s = null;
  for (const l of log.split('\n')) {
    let m;
    if (key === 'black' && (m = l.match(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/))) out.push({ start: +m[1], end: +m[2], dur: +m[3] });
    if (key !== 'black') {
      if ((m = l.match(new RegExp(`${key}_start: ?([\\d.]+)`)))) s = +m[1];
      if ((m = l.match(new RegExp(`${key}_end: ?([\\d.]+)`))) && s != null) { out.push({ start: s, end: +m[1], dur: +(+m[1] - s).toFixed(3) }); s = null; }
      if ((m = l.match(new RegExp(`${key}_duration: ?([\\d.]+)`))) && out.length) out[out.length - 1].dur = +m[1];
    }
  }
  if (s != null) out.push({ start: s, end: null, dur: null, open: true });
  return out;
}

function frameStats(file, t) {
  const log = ff(['-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-']);
  const y = log.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return y ? +y[1] : null;
}
function ssim(file, t1, t2) {
  const log = ff(['-ss', String(t1), '-i', file, '-ss', String(t2), '-i', file, '-frames:v', '1', '-lavfi', '[0:v][1:v]ssim', '-f', 'null', '-']);
  const m = log.match(/All:([\d.]+)/); return m ? +m[1] : null;
}

export function contactSheet(file, times, out, w) {
  const tmp = out + '.frames'; rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  times.forEach((t, i) => ff(['-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:-2`, join(tmp, `f${String(i).padStart(3, '0')}.png`)]));
  const cols = Math.min(6, times.length);
  ff(['-y', '-framerate', '1', '-i', join(tmp, 'f%03d.png'), '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}:padding=6:margin=6:color=0x202020`, '-frames:v', '1', '-q:v', '3', out]);
  rmSync(tmp, { recursive: true, force: true });
  return out;
}

export function qa(file, buildDir, takePath) {
  file = resolve(file); buildDir = resolve(buildDir);
  const P = JSON.parse(readFileSync(join(buildDir, 'probe.json'), 'utf8'));
  const take = JSON.parse(readFileSync(takePath || join(buildDir, '..', '..', 'take.json'), 'utf8'));
  const fmt = resolveFormat(take.formats.find((f) => (f.id || '') === P.format) || { id: P.format });
  const Q = Object.assign({}, DEFAULTS, take.qa);
  if (take.sound?.lufs != null && !take.qa?.lufs) Q.lufs = [take.sound.lufs - 1.5, take.sound.lufs + 0.5];
  const fps = take.fps || 30, checks = [];
  const add = (id, status, value, note) => checks.push({ id, status, value, note });

  // container
  const meta = probeJson(file), v = meta.streams.find((s) => s.codec_type === 'video'), a = meta.streams.find((s) => s.codec_type === 'audio');
  const dur = +meta.format.duration, [fn, fd] = v.r_frame_rate.split('/').map(Number), rate = fn / fd;
  add('size', v.width === fmt.w && v.height === fmt.h ? 'pass' : 'fail', `${v.width}x${v.height}`, `want ${fmt.w}x${fmt.h}`);
  add('fps', Math.abs(rate - fps) < 0.01 ? 'pass' : 'fail', +rate.toFixed(3), `want ${fps}`);
  add('duration', Math.abs(dur - P.duration) <= 1 / fps + 0.06 ? 'pass' : 'fail', +dur.toFixed(3), `want ${P.duration}s`);
  if (fmt.maxSec) add('platform-cap', dur <= fmt.maxSec + 0.01 ? 'pass' : 'fail', +dur.toFixed(2), `${fmt.platform} takes up to ${fmt.maxSec}s`);
  add('codec', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p' ? 'pass' : 'warn', `${v.codec_name} ${v.pix_fmt}`, 'h264 yuv420p plays everywhere');

  // audio
  const wantAudio = take.sound?.mode !== 'none';
  if (wantAudio) {
    if (!a) add('audio', 'fail', 'missing', 'sound was asked for');
    else {
      const log = ff(['-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
      const sum = log.slice(log.lastIndexOf('Summary:'));
      const I = +(sum.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1], tp = +(sum.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1], lra = +(sum.match(/LRA:\s+([\d.]+) LU/) || [])[1];
      add('loudness', I >= Q.lufs[0] && I <= Q.lufs[1] ? 'pass' : 'fail', I, `integrated LUFS, want ${Q.lufs[0]}…${Q.lufs[1]}`);
      add('true-peak', tp <= Q.tpMax ? 'pass' : 'fail', tp, `dBTP, want ≤ ${Q.tpMax}`);
      add('loudness-range', lra >= 2 && lra <= 14 ? 'pass' : 'warn', lra, 'LU; under 2 is a wall, over 14 drops out on a phone speaker');
      const sil = intervals(ff(['-i', file, '-map', '0:a:0', '-af', `silencedetect=n=-50dB:d=${Q.silenceMaxSec}`, '-f', 'null', '-']), 'silence');
      add('silence', sil.length ? 'fail' : 'pass', sil.map((s) => `${s.start.toFixed(2)}+${s.dur != null ? s.dur.toFixed(2) : "end"}`).join(', ') || 'none', `no gap over ${Q.silenceMaxSec}s below -50 dB`);
    }
  }

  // picture
  const black = intervals(ff(['-i', file, '-vf', 'blackdetect=d=0.1:pix_th=0.06:pic_th=0.995', '-an', '-f', 'null', '-']), 'black').filter((b) => b.start > 0.15);
  const longBlack = black.filter((b) => b.dur >= Q.blackMaxSec);
  add('black', longBlack.length ? 'fail' : black.length ? 'warn' : 'pass', black.map((b) => `${b.start.toFixed(2)}+${b.dur.toFixed(2)}`).join(', ') || 'none', `empty frames; fail at ${Q.blackMaxSec}s`);
  const endAt = P.marks?.endCard;
  const frozen = intervals(ff(['-i', file, '-vf', `freezedetect=n=0.0008:d=${Q.freezeMaxSec}`, '-an', '-f', 'null', '-']), 'lavfi.freezedetect.freeze')
    .filter((f) => !(endAt != null && f.start >= endAt - 0.5));
  add('frozen', frozen.length ? 'fail' : 'pass', frozen.map((f) => `${f.start.toFixed(2)}+${f.dur ?? 'end'}`).join(', ') || 'none', `nothing stands still ${Q.freezeMaxSec}s+ before the end card`);

  // end card: marked, held, and still on screen at the last frame
  if (endAt == null) add('end-card', 'fail', 'unmarked', 'call T.endCard(t) when the end card is complete');
  else {
    const hold = +(dur - endAt).toFixed(2), y1 = frameStats(file, endAt + 0.05), y2 = frameStats(file, dur - 0.1), sim = ssim(file, endAt + 0.05, dur - 0.1);
    add('end-card-hold', hold >= Q.endHoldSec ? 'pass' : 'fail', hold, `seconds fully composed, want ≥ ${Q.endHoldSec}`);
    add('end-card-steady', sim != null && sim > 0.6 && y2 > y1 * 0.6 ? 'pass' : 'fail', `ssim ${sim} luma ${y1}→${y2}`, 'the last frame still shows the end card (no fade-out eating the hold)');
  }

  // text: size relative to the short side, and position against the platform's UI bands (both from the probe)
  const read = P.text.filter((t) => !t.deco && t.visibleSec >= 0.5);
  const tiny = read.filter((t) => t.minPct < Q.hardMinTextPct), small = read.filter((t) => t.minPct >= Q.hardMinTextPct && t.minPct < Q.minTextPct);
  add('text-size', tiny.length ? 'fail' : small.length ? 'warn' : 'pass', [...tiny, ...small].map((t) => `"${t.text.slice(0, 28)}" ${t.minPct}%`).join('; ') || `min ${Math.min(...read.map((t) => t.minPct)).toFixed(2)}%`, `font size as % of the short side; fail < ${Q.hardMinTextPct}, warn < ${Q.minTextPct}`);
  const out = read.filter((t) => t.outsideSec >= 0.75); // 0.75 s is 3 probe samples (0.25 s apart): a whip or push passing through is fine
  const uiHeavy = /story|reels|tiktok|shorts/.test(fmt.platform);
  add('safe-zone', out.length ? (uiHeavy ? 'fail' : 'warn') : 'pass', out.map((t) => `"${t.text.slice(0, 28)}" ${t.outsideSec}s`).join('; ') || 'all inside', `${fmt.platform} UI bands t${fmt.safe.top} b${fmt.safe.bottom} l${fmt.safe.left} r${fmt.safe.right}`);

  // the composition's own HyperFrames check (lint, runtime, layout, contrast), if run.mjs saved it
  const cj = join(buildDir, 'check.json');
  if (existsSync(cj)) {
    const c = JSON.parse(readFileSync(cj, 'utf8'));
    const errs = ['lint', 'runtime', 'layout', 'contrast'].flatMap((k) => (c[k]?.findings || []).filter((f) => f.severity === 'error').map((f) => `${k}:${f.code}`));
    add('hyperframes-check', errs.length ? 'fail' : 'pass', errs.join(', ') || `contrast ${c.contrast?.passed}/${c.contrast?.checked}`, 'lint, layout and WCAG contrast');
  }

  // contact sheet: each scene's middle, both sides of every cut, the end card and the last frame
  const times = [];
  for (const s of P.scenes) { if (s.start > 0) times.push(s.start - 0.1, s.start + 0.25); times.push(s.start + s.dur / 2); }
  if (endAt != null) times.push(endAt + 0.05); times.push(dur - 0.05);
  const uniq = [...new Set(times.map((t) => +Math.min(dur - 0.05, Math.max(0, t)).toFixed(2)))].sort((x, y) => x - y);
  const sheet = contactSheet(file, uniq, file.replace(/\.mp4$/, '.sheet.jpg'), Math.round(Math.min(360, fmt.w / 3)));

  const verdict = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  const res = { file, format: P.format, lang: P.lang, platform: fmt.platform, verdict, checks, sheet, sheetTimes: uniq };
  writeFileSync(file.replace(/\.mp4$/, '.qa.json'), JSON.stringify(res, null, 1));
  return res;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), bi = a.indexOf('--build'), ti = a.indexOf('--take');
  if (!a[0] || bi < 0) { console.error('usage: qa.mjs <final.mp4> --build <built-dir> [--take take.json]'); process.exit(2); }
  const r = qa(a[0], a[bi + 1], ti >= 0 ? a[ti + 1] : undefined);
  for (const c of r.checks) console.error(`${c.status === 'pass' ? 'ok  ' : c.status.toUpperCase().padEnd(4)} ${c.id.padEnd(18)} ${c.value}  (${c.note})`);
  console.error(`qa ${r.format}-${r.lang}: ${r.verdict.toUpperCase()}  sheet → ${r.sheet}`);
  process.exit(r.verdict === 'fail' ? 1 : 0);
}
