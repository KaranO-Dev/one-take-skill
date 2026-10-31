#!/usr/bin/env node
// Look around before asking anything: repos, README, brand assets, and the toolchain.
// usage: detect.mjs [path …] [--out detect.json]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { homedir } from 'node:os';
import { sh, isRepo, repoRoot, readmeInfo } from './lib/git.mjs';

const args = process.argv.slice(2);
const oi = args.indexOf('--out'), out = oi >= 0 ? args[oi + 1] : null;
const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!paths.length) paths.push('.');

function walk(dir, depth = 0, acc = []) {
  if (depth > 5 || acc.length > 4000) return acc;
  let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return acc; } // expected: a folder we may not read, or one that vanished mid-walk; skip it
  for (const e of ents) {
    if (e.name.startsWith(".") || /^(node_modules|dist|build|out|coverage|renders|vendor)$/.test(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, acc); else acc.push(p);
  }
  return acc;
}

function brand(root) {
  const files = walk(root);
  const rel = (p) => relative(root, p);
  const logos = files.filter((p) => /(logo|mark|brand|wordmark|icon|favicon|lockup)[^/]*\.(svg|png|webp)$/i.test(p) || /favicon\.(ico|svg|png)$/i.test(p))
    .sort((a, b) => (extname(a) === '.svg' ? -1 : 1) - (extname(b) === '.svg' ? -1 : 1)).slice(0, 12).map(rel);
  const fontFiles = files.filter((p) => /\.(woff2?|ttf|otf)$/i.test(p)).slice(0, 16).map(rel);
  const families = {}, colors = {}, google = new Set();
  for (const p of files.filter((f) => /\.(css|scss|html|tsx|jsx|astro|vue|svelte)$/i.test(f)).slice(0, 400)) {
    let s; try { if (statSync(p).size > 1e6) continue; s = readFileSync(p, 'utf8'); } catch { continue; } // expected: unreadable or deleted since the walk
    for (const m of s.matchAll(/font-family\s*:\s*['"]?([A-Z][\w\s-]{2,40}?)['",;]/g)) families[m[1].trim()] = (families[m[1].trim()] || 0) + 1;
    for (const m of s.matchAll(/fonts\.googleapis\.com\/css2?\?family=([\w+]+)/g)) google.add(m[1].replace(/\+/g, ' '));
    for (const m of s.matchAll(/next\/font\/google['"][\s\S]{0,200}?\{\s*([A-Z]\w+)/g)) google.add(m[1].replace(/_/g, ' '));
    for (const m of s.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|oklch\([^)]+\)|rgb\([^)]+\)|hsl\([^)]+\))/g)) colors[`--${m[1]}: ${m[2]}`] = 1;
    for (const m of s.matchAll(/#[0-9a-fA-F]{6}\b/g)) colors[m[0].toLowerCase()] = (colors[m[0].toLowerCase()] || 0) + 1;
  }
  const tokens = Object.keys(colors).filter((k) => k.startsWith('--')).slice(0, 24);
  const hexes = Object.entries(colors).filter(([k]) => k.startsWith('#')).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  return {
    logos, fontFiles,
    fontFamilies: Object.entries(families).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k).filter((f) => !/^(Inherit|Initial|System|Sans|Serif|Mono)/i.test(f)),
    googleFonts: [...google], colorTokens: tokens, topColors: hexes,
  };
}

function toolchain() {
  const v = (cmd, a = ['--version']) => sh(cmd, a).split('\n')[0];
  const npx = join(homedir(), '.npm', '_npx');
  let hf = '';
  let cached = []; try { cached = readdirSync(npx); } catch { /* expected: no ~/.npm/_npx yet, so nothing is cached */ }
  for (const d of cached) {
    const p = join(npx, d, 'node_modules', 'hyperframes', 'package.json'); if (!existsSync(p)) continue;
    try { const ver = JSON.parse(readFileSync(p, 'utf8')).version; if (!hf || ver.localeCompare(hf, undefined, { numeric: true }) > 0) hf = ver; } catch { /* a half-written package.json in the npx cache: ignore that entry only */ }
  }
  const chromeCache = join(homedir(), '.cache', 'hyperframes', 'chrome');
  const chrome = existsSync(chromeCache) || existsSync('/Applications/Google Chrome.app') || !!sh('which', ['google-chrome']) || !!sh('which', ['chromium']);
  return {
    node: process.version, nodeOk: +process.versions.node.split('.')[0] >= 22,
    ffmpeg: v('ffmpeg', ['-version']), ffprobe: !!v('ffprobe', ['-version']),
    hyperframesCached: hf || null, chrome,
    heygen: !!sh('which', ['heygen']),
    musicKeys: { gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), elevenlabs: !!process.env.ELEVENLABS_API_KEY },
  };
}

const sources = paths.map((p) => {
  const abs = resolve(p);
  const repo = isRepo(abs);
  const root = repo ? repoRoot(abs) : abs;
  const info = readmeInfo(root);
  const g = repo ? {
    commits: +sh('git', ['rev-list', '--count', '--no-merges', 'HEAD'], root) || 0,
    first: sh('git', ['log', '--reverse', '--format=%ad', '--date=short'], root).split('\n')[0],
    last: sh('git', ['log', '-1', '--format=%ad', '--date=short'], root),
    remote: sh('git', ['remote', 'get-url', 'origin'], root).replace(/\/\/[^@/]+@/, '//'),
  } : null;
  return { path: root, isRepo: repo, ...info, git: g, brand: brand(root) };
});

const result = { sources, toolchain: toolchain() };
const json = JSON.stringify(result, null, 1);
if (out) { writeFileSync(out, json); console.error(`detect → ${out}`); } else process.stdout.write(json + '\n');
