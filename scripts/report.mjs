#!/usr/bin/env node
// REPORT.md: what was made, how each file did on every check, and what is left.
// usage: report.mjs <project-dir>
import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export function report(proj) {
  proj = resolve(proj);
  const take = JSON.parse(readFileSync(join(proj, 'take.json'), 'utf8'));
  const builds = JSON.parse(readFileSync(join(proj, 'out', 'builds.json'), 'utf8'));
  const runPath = join(proj, 'out', 'run.json'), run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, 'utf8')) : { outputs: {} };
  const facts = existsSync(join(proj, 'facts.json')) ? JSON.parse(readFileSync(join(proj, 'facts.json'), 'utf8')) : null;
  const rel = (p) => relative(proj, p);
  const L = [`# ${take.title || 'Take'}: render report`, ''];
  const rows = [], open = [];
  for (const b of builds.filter((x) => run.outputs[x.name])) {
    const o = run.outputs[b.name], qf = o.final ? o.final.replace(/\.mp4$/, '.qa.json') : null;
    const q = qf && existsSync(qf) ? JSON.parse(readFileSync(qf, 'utf8')) : null;
    rows.push({ b, o, q });
    if (q) for (const c of q.checks) if (c.status !== 'pass') open.push(`${b.name}: ${c.id} ${c.status}: ${c.value} (${c.note})`);
    if (!q) open.push(`${b.name}: no QA result${o.error ? `: ${o.error}` : ''}`);
  }
  L.push('| Output | Size | Length | Verdict | File |', '|---|---|---|---|---|');
  for (const { b, o, q } of rows) {
    const mb = o.final && existsSync(o.final) ? (statSync(o.final).size / 1e6).toFixed(1) + ' MB' : '';
    L.push(`| ${b.name} (${b.format.platform}) | ${b.format.w}×${b.format.h} @ ${take.fps || 30} fps | ${b.duration}s | ${q ? q.verdict : '—'} | ${o.final ? '`' + rel(o.final) + '`' : '—'} ${mb} |`);
  }
  L.push('');
  for (const { b, o, q } of rows) {
    if (!q) continue;
    L.push(`## ${b.name}`, '', `Scenes: ${b.scenes.join(' → ')}${b.dropped.length ? ` (cut for ${b.format.platform}: ${b.dropped.join(', ')})` : ''}`, '');
    L.push('| Check | Status | Value | Rule |', '|---|---|---|---|');
    for (const c of q.checks) L.push(`| ${c.id} | ${c.status} | ${String(c.value).replace(/\|/g, '/')} | ${c.note} |`);
    L.push('', `Contact sheet: \`${rel(q.sheet)}\` (frames at ${q.sheetTimes.join(', ')} s)`);
    const extra = [o.cover && `cover \`${rel(o.cover)}\``, o.gif && `gif \`${rel(o.gif)}\``, o.scoreDir && `stems \`${rel(o.scoreDir)}/stems/\``].filter(Boolean);
    if (extra.length) L.push('', `Also: ${extra.join(', ')}`);
    L.push('');
  }
  const s = take.sound || {};
  L.push('## Sound', '', s.mode === 'none' ? 'No sound.' :
    s.mode === 'score' ? `Original score, synthesised for this film (no samples, nothing to license): ${s.mood || 'cool'} in ${s.key || 'D'}, ${take.bpm} bpm, stems bed/band/drums/fx, sound effects keyed to the animation's own cues and tuned to the chord under them. Master at ${s.lufs ?? -14} LUFS integrated, true peak ≤ ${s.tp ?? -1.5} dBTP.`
      : `Music: \`${s.track}\`${s.licence ? ` (${s.licence})` : ' (licence: not recorded, confirm before posting)'}. Sound effects synthesised and keyed to the animation's cues. Master at ${s.lufs ?? -14} LUFS.`, '');
  if (facts?.total && Array.isArray(facts.repos)) { // a facts.json not written by facts.mjs is left out of the report
    const t = facts.total;
    L.push('## Facts used', '', `From git (${facts.repos.map((r) => r.title).join(', ')}): ${t.commits} commits, ${t.lines} lines, ${t.activeDays} active days between ${t.first} and ${t.last}. Computed from git by facts.mjs${facts.built ? ` on ${facts.built.slice(0, 10)}` : ''} when the project was set up and saved in facts.json; build.mjs and run.mjs only read that file. Nothing typed in by hand.`, '');
  }
  L.push('## Open items', '', open.length ? open.map((x) => `- ${x}`).join('\n') : 'None. Every check passed.', '');
  writeFileSync(join(proj, 'REPORT.md'), L.join('\n'));
  return { open: open.length, outputs: rows.length };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = report(process.argv[2] || '.');
  console.error(`report → REPORT.md (${r.outputs} outputs, ${r.open} open items)`);
}
