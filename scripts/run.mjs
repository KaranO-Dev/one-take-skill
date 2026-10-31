#!/usr/bin/env node
// The whole run, no questions: build → probe → score → check → render → encode → QA → report.
// usage: run.mjs <project-dir> [--only 4x5-en,9x16-en] [--draft] [--skip-render] [--no-score]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from './probe.mjs';
import { score } from './score.mjs';
import { encode } from './encode.mjs';
import { qa } from './qa.mjs';
import { report } from './report.mjs';
import { safeId, hfVersion } from './lib/platforms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2), proj = resolve(a.find((x) => !x.startsWith('--') && !/^--only$/.test(a[a.indexOf(x) - 1] || '')) || '.');
const flag = (k) => a.includes(k), oi = a.indexOf('--only'), only = oi >= 0 ? a[oi + 1].split(',') : null;
const take = JSON.parse(readFileSync(join(proj, 'take.json'), 'utf8'));
const hf = `hyperframes@${hfVersion(take)}`, fps = take.fps || 30, quality = flag('--draft') ? 'draft' : take.quality || 'high';
const outDir = resolve(proj, take.output?.dir || 'renders'); mkdirSync(outDir, { recursive: true });
// the finished name becomes a file name, so it has to pass safeId() whatever the template put into it
const nameOf = (b) => safeId('output name', (take.output?.name || '{slug}-{format}-{lang}').replace('{slug}', safeId('slug', take.slug || 'take')).replace('{format}', b.format.id).replace('{lang}', b.lang).replace('{platform}', b.format.platform));
const log = (m) => console.error(`[one-take] ${m}`);
const sh = (cmd, args, cwd) => { const p = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 512 << 20 }); return { ok: p.status === 0, out: p.stdout, err: p.stderr }; };

const t0 = Date.now();
log('build');
const b = sh(process.execPath, [join(HERE, 'build.mjs'), proj]);
process.stderr.write(b.err);
if (!b.ok) process.exit(1);
const builds = JSON.parse(readFileSync(join(proj, 'out', 'builds.json'), 'utf8')).filter((x) => !only || only.includes(x.name));
builds.forEach(nameOf); // a bad output.name stops the run here, before any render
const runPath = join(proj, 'out', 'run.json'), run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : { outputs: {} };

for (const x of builds) {
  const o = (run.outputs[x.name] = { started: new Date().toISOString() });
  try {
    log(`${x.name}: probe`);
    const p = probe(x.dir);
    writeFileSync(join(x.dir, 'probe.json'), JSON.stringify(p, null, 1));
    writeFileSync(join(x.dir, 'cues.json'), JSON.stringify(p.cues, null, 1));
    if (take.sound?.mode !== 'none' && !flag('--no-score')) {
      log(`${x.name}: score (${p.cues.length} cues)`);
      const s = score(x.dir, join(proj, 'take.json')); o.scoreDir = join(x.dir, 'score'); o.score = s;
    }
    log(`${x.name}: hyperframes check`);
    const c = sh('npx', ['--yes', hf, 'check', '--json'], x.dir);
    const j = c.out.indexOf('{');
    if (j >= 0) writeFileSync(join(x.dir, 'check.json'), c.out.slice(j)); // a real write error should surface
    else log(`${x.name}: hyperframes check printed no JSON, so QA skips its check row`); // npx failed or was offline
    // kept outside the build folder, which build.mjs rewrites, so --skip-render can reuse it
    const render = join(proj, 'out', `${x.name}.render.mp4`);
    if (!flag('--skip-render') || !existsSync(render)) {
      log(`${x.name}: render ${x.format.w}x${x.format.h} ${fps}fps ${quality}`);
      const r = sh('npx', ['--yes', hf, 'render', '.', '--fps', String(fps), '--quality', quality, '-o', render], x.dir);
      writeFileSync(join(x.dir, 'render.log'), r.err + r.out);
      if (!r.ok || !existsSync(render)) throw new Error(`render failed, see ${join(x.dir, 'render.log')}`);
    }
    const final = join(outDir, nameOf(x) + '.mp4');
    log(`${x.name}: encode`);
    const master = o.scoreDir ? join(o.scoreDir, 'master.wav') : '-';
    Object.assign(o, encode(render, master, final, { cover: take.extras?.cover === false ? undefined : (p.marks.endCard ?? p.duration - 1) + 0.4, gif: !!take.extras?.gif }));
    o.final = final;
    log(`${x.name}: qa`);
    const q = qa(final, x.dir, join(proj, 'take.json'));
    o.verdict = q.verdict;
    for (const ch of q.checks.filter((k) => k.status !== 'pass')) log(`  ${ch.status} ${ch.id}: ${ch.value}`);
    log(`${x.name}: ${q.verdict.toUpperCase()}`);
  } catch (e) { o.error = String(e.message || e).slice(0, 600); log(`${x.name}: ERROR ${o.error}`); }
  writeFileSync(runPath, JSON.stringify(run, null, 1));
}
const r = report(proj);
log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${r.outputs} outputs, ${r.open} open items → ${join(proj, 'REPORT.md')}`);
process.exit(builds.some((x) => run.outputs[x.name].verdict !== 'pass' && run.outputs[x.name].verdict !== 'warn') ? 1 : 0);
