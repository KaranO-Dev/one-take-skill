#!/usr/bin/env node
// Check the toolchain, then prove QA catches what it claims to: a file made to fail
// (a black gap, a frozen stretch, an end card held 1 s, quiet audio with a silent hole, tiny text)
// must fail those checks, while size, fps, duration and safe-zone still pass.
// usage: selftest.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { qa } from './qa.mjs';
import { findChrome } from './probe.mjs';

let bad = 0;
const ok = (c, m) => { console.error(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) bad++; };
const has = (cmd, args = ['-version']) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;

ok(+process.versions.node.split('.')[0] >= 22, `node ${process.version} (need ≥ 22)`);
ok(has('ffmpeg'), 'ffmpeg on PATH');
ok(has('ffprobe'), 'ffprobe on PATH');
let chrome = null; try { chrome = findChrome(); } catch {}
ok(!!chrome, `Chrome for the probe${chrome ? `: ${chrome}` : ' (run `npx hyperframes doctor` once, or set CHROME_PATH)'}`);

const dir = mkdtempSync(join(tmpdir(), 'one-take-selftest-')), build = join(dir, 'out', '4x5-en');
mkdirSync(build, { recursive: true });
const file = join(dir, 'bad.mp4');
// 10 s at 1080x1350: moving test pattern, black 3.0–4.0, frozen 5.0–7.5, quiet tone with a silent hole 6–7.5
const v = `testsrc2=s=1080x1350:r=30:d=10,loop=loop=75:size=1:start=150,setpts=N/30/TB,trim=duration=10,format=yuv420p,drawbox=enable='between(t,3,4)':c=black:t=fill`;
const a = `sine=f=440:d=10,volume=0.08,volume=enable='between(t,6,7.5)':volume=0`;
const r = spawnSync('ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', v, '-f', 'lavfi', '-i', a, '-c:v', 'libx264', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' });
if (r.status) { console.error(r.stderr.slice(-600)); process.exit(1); }
writeFileSync(join(dir, 'take.json'), JSON.stringify({ fps: 30, formats: [{ id: '4x5', platform: 'instagram-feed' }], sound: { mode: 'score', lufs: -14 } }));
writeFileSync(join(build, 'probe.json'), JSON.stringify({
  format: '4x5', lang: 'en', duration: 10, scenes: [{ id: 'a', start: 0, dur: 5 }, { id: 'end', start: 5, dur: 5, end: true }], marks: { endCard: 9 },
  text: [{ sel: '#cap', text: 'a 27px caption', minPct: 2.5, visibleSec: 3, outsideSec: 0 }, { sel: '#h', text: 'Headline', minPct: 8, visibleSec: 3, outsideSec: 0 }],
}));
const res = qa(file, build, join(dir, 'take.json'));
const st = Object.fromEntries(res.checks.map((c) => [c.id, c.status]));
for (const id of ['black', 'end-card-hold', 'loudness', 'silence', 'text-size']) ok(st[id] === 'fail', `QA fails ${id} (${res.checks.find((c) => c.id === id)?.value})`);
ok(st.frozen === 'fail', `QA fails frozen (${res.checks.find((c) => c.id === 'frozen')?.value})`);
for (const id of ['size', 'fps', 'duration', 'safe-zone']) ok(st[id] === 'pass', `QA passes ${id}`);
rmSync(dir, { recursive: true, force: true });
console.error(bad ? `\n${bad} problem(s)` : '\nall good');
process.exit(bad ? 1 : 0);
