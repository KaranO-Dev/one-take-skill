#!/usr/bin/env node
// Pull real numbers from one or more git repos for the film to quote.
// usage: facts.mjs --repo <path> [--repo <path> …] [--since 2025-01-01] [--until …] [--out facts.json]
// The output holds counts, dates and commit subjects. Author names and emails are never written;
// emails are read only to count distinct contributors.
import { writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { sh, isRepo, repoRoot, linesByLanguage, readmeInfo } from './lib/git.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const repos = args.flatMap((a, i) => (a === '--repo' ? [args[i + 1]] : []));
if (!repos.length) repos.push('.');
const since = opt('--since'), until = opt('--until'), out = opt('--out');

const day = (iso) => iso.slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

function repoFacts(dir) {
  const root = repoRoot(resolve(dir));
  if (!isRepo(root)) throw new Error(`${dir} is not a git repository (or git is not installed)`);
  const range = [...(since ? [`--since=${since}`] : []), ...(until ? [`--until=${until}`] : [])];
  const log = sh('git', ['log', '--no-merges', '--date=iso-strict', '--format=%H%x09%ad%x09%s', ...range], root).split('\n').filter(Boolean)
    .map((l) => { const [h, d, ...s] = l.split('\t'); return { h, d, s: s.join('\t') }; });
  const perDay = {};
  for (const c of log) perDay[day(c.d)] = (perDay[day(c.d)] || 0) + 1;
  const days = Object.keys(perDay).sort();
  const first = days[0], last = days[days.length - 1];
  // longest run of consecutive active days
  let streak = 0, run = 0, prev = null;
  for (const d of days) { run = prev && daysBetween(prev, d) === 2 ? run + 1 : 1; streak = Math.max(streak, run); prev = d; }
  const busiest = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const hours = Array(24).fill(0); for (const c of log) hours[+c.d.slice(11, 13)]++;
  const shortstat = sh('git', ['log', '--no-merges', '--shortstat', '--format=', ...range], root);
  let added = 0, removed = 0;
  for (const m of shortstat.matchAll(/(\d+) insertion|(\d+) deletion/g)) { if (m[1]) added += +m[1]; if (m[2]) removed += +m[2]; }
  const authors = new Set(sh('git', ['log', '--no-merges', '--format=%aE', ...range], root).split('\n').filter(Boolean)).size;
  const tags = sh('git', ['tag'], root).split('\n').filter(Boolean).length;
  const words = {};
  for (const c of log) for (const w of c.s.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) words[w] = (words[w] || 0) + 1;
  const STOP = new Set(['with', 'from', 'that', 'this', 'into', 'when', 'than', 'then', 'them', 'they', 'have', 'more', 'only', 'also', 'make', 'made', 'merge', 'branch', 'update', 'updates']);
  const topWords = Object.entries(words).filter(([w]) => !STOP.has(w)).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    folder: basename(root), ...readmeInfo(root), // the folder name only: facts.json is inlined into every build, so no absolute paths
    commits: log.length, first, last, spanDays: first ? daysBetween(first, last) : 0, activeDays: days.length, longestStreak: streak,
    busiestDay: { date: busiest[0], commits: busiest[1] }, perDay, commitsByHour: hours,
    linesAdded: added, linesRemoved: removed, contributors: authors, tags,
    code: linesByLanguage(root), topCommitWords: topWords,
    firstCommit: log.length ? log[log.length - 1].s : '', lastCommit: log.length ? log[0].s : '',
  };
}

const list = repos.map(repoFacts);
const all = {
  built: new Date().toISOString(),
  repos: list,
  total: {
    commits: list.reduce((a, r) => a + r.commits, 0),
    lines: list.reduce((a, r) => a + r.code.total, 0),
    first: list.map((r) => r.first).filter(Boolean).sort()[0],
    last: list.map((r) => r.last).filter(Boolean).sort().pop(),
    activeDays: new Set(list.flatMap((r) => Object.keys(r.perDay))).size,
  },
};
all.total.spanDays = all.total.first ? daysBetween(all.total.first, all.total.last) : 0;
const json = JSON.stringify(all, null, 1);
if (out) writeFileSync(out, json); else process.stdout.write(json + '\n');
if (out) console.error(`facts: ${all.total.commits} commits, ${all.total.lines} lines, ${all.total.activeDays} active days over ${all.total.spanDays} → ${out}`);
