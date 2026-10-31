#!/usr/bin/env node
// Turn one source composition into one HyperFrames project per format × language.
// usage: build.mjs <project-dir>      (reads take.json, src/index.html, src/assets/, facts.json, copy/<lang>.json)
// writes <project>/out/<format>-<lang>/{index.html, assets/, hyperframes.json, package.json, meta.json}
// and <project>/out/builds.json (the list of builds, read by run.mjs and report.mjs)
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveFormat, safeId, hfVersion } from './lib/platforms.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'kit', 'take.js');
const GSAP_VER = '3.14.2';
// sha256 of https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js; bump both together
const GSAP_SHA256 = 'c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280';
const proj = resolve(process.argv[2] || '.');
const take = JSON.parse(readFileSync(join(proj, 'take.json'), 'utf8'));
const src = readFileSync(join(proj, 'src', 'index.html'), 'utf8');
const facts = existsSync(join(proj, 'facts.json')) ? JSON.parse(readFileSync(join(proj, 'facts.json'), 'utf8')) : {};
// Everything from take.json that becomes part of a path or a command is checked before any path is built.
const hfVer = hfVersion(take), slug = safeId('slug', take.slug || 'take');
const languages = (take.languages || ['en']).map((l) => safeId('language', l));
const formats = take.formats.map(resolveFormat); // checks each format id too

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Data goes into the template as JSON inside an inline <script>: keep <, > and & (and the two JS line separators) out of it,
// so copy or a commit subject holding "</script>" or "<!--" stays text.
const jsonForScript = (v) => JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const htmlText = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cssString = (v) => String(v).replace(/[\\'"<\r\n]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
const cssWord = (what, v) => { if (!/^[\w\s%.-]+$/.test(String(v))) throw new Error(`take.json: font ${what} ${JSON.stringify(v)} is not allowed`); return String(v); };
const inside = (root, p) => { const r = relative(root, p); return !!r && !r.startsWith('..') && !isAbsolute(r); };

// GSAP is pinned to one version and one hash: a cached or downloaded file that does not match is deleted and the build stops.
async function gsapFile() {
  const cache = join(homedir(), '.cache', 'one-take', `gsap-${GSAP_VER}.min.js`);
  const url = `https://cdn.jsdelivr.net/npm/gsap@${GSAP_VER}/dist/gsap.min.js`;
  if (existsSync(cache) && sha256(readFileSync(cache)) !== GSAP_SHA256) { rmSync(cache, { force: true }); throw new Error(`cached ${cache} did not match the pinned sha256 and was deleted; run the build again to fetch ${url}`); }
  if (!existsSync(cache)) {
    mkdirSync(dirname(cache), { recursive: true });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`could not fetch gsap ${GSAP_VER}: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer()), got = sha256(buf);
    if (got !== GSAP_SHA256) throw new Error(`gsap ${GSAP_VER} from ${url} has sha256 ${got}, expected ${GSAP_SHA256}; nothing was cached`);
    const part = `${cache}.${process.pid}.part`; writeFileSync(part, buf); renameSync(part, cache);
  }
  return cache;
}

function copyFor(lang) { // lang has passed safeId() by now
  const f = join(proj, 'copy', `${lang}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  return (take.copy && take.copy[lang]) || {};
}

// Scene list for one format: filter, cut down to the platform cap, then lay out on the bar grid.
function plan(fmt) {
  const bar = (60 / take.bpm) * (take.beatsPerBar || 4);
  const secOf = (s) => (s.sec != null ? s.sec : s.bars * bar);
  let scenes = take.scenes.filter((s) => (!s.only || s.only.includes(fmt.id)) && !(s.skip || []).includes(fmt.id));
  const cap = fmt.maxSec, dropped = [];
  if (cap) {
    // optional: true or 1–9; higher numbers go first
    const v = (s) => (s.optional === true ? 5 : +s.optional);
    const order = scenes.filter((s) => s.optional).sort((a, b) => v(b) - v(a));
    while (scenes.reduce((a, s) => a + secOf(s), 0) > cap && order.length) { const d = order.shift(); dropped.push(d.id); scenes = scenes.filter((s) => s !== d); }
  }
  let t = 0;
  const out = scenes.map((s, i) => { const o = { id: s.id, start: +t.toFixed(4), dur: +secOf(s).toFixed(4), energy: s.energy ?? 0.5, in: s.in || null, end: !!s.end, prev: scenes[i - 1]?.id || null, next: scenes[i + 1]?.id || null }; t += secOf(s); return o; });
  const duration = +t.toFixed(4);
  if (cap && duration > cap) console.error(`warn: ${fmt.id} runs ${duration}s, over its ${cap}s cap even after dropping optional scenes`);
  return { scenes: out, duration, dropped };
}

// Remove a top-level <section data-scene="id"> … </section>, counting nested sections.
function removeSection(html, id) {
  const m = new RegExp(`<section\\b[^>]*data-scene="${escapeRegExp(id)}"[^>]*>`).exec(html); if (!m) return html;
  let depth = 1, i = m.index + m[0].length; const re = /<\/?section\b[^>]*>/g; re.lastIndex = i;
  for (let x; (x = re.exec(html));) { depth += x[0][1] === '/' ? -1 : 1; if (!depth) return html.slice(0, m.index) + html.slice(x.index + x[0].length); }
  return html;
}

// family and file go into quoted CSS strings, the other fields are bare words: neither can close the rule or the <style> element
function fontFaces(fonts = []) {
  return fonts.map((f) => `@font-face { font-family: '${cssString(f.family)}'; src: url('assets/${cssString(f.file)}') format('${/\.woff2$/.test(f.file) ? 'woff2' : /\.woff$/.test(f.file) ? 'woff' : /\.otf$/.test(f.file) ? 'opentype' : 'truetype'}'); font-weight: ${cssWord('weight', f.weight || '100 900')};${f.stretch ? ` font-stretch: ${cssWord('stretch', f.stretch)};` : ''} font-style: ${cssWord('style', f.style || 'normal')}; font-display: block; }`).join('\n      ');
}

const gsapPath = await gsapFile();
const outRoot = join(proj, 'out');
const builds = [];
for (const fmt of formats) {
  for (const lang of languages) {
    const name = `${fmt.id}-${lang}`, dir = join(outRoot, name);
    const p = plan(fmt);
    const TAKE = {
      compositionId: 'main', format: fmt.id, shape: fmt.shape, lang, W: fmt.dw, H: fmt.dh, scale: fmt.k,
      bpm: take.bpm, beatsPerBar: take.beatsPerBar || 4, seed: take.seed || 1, duration: p.duration,
      scenes: p.scenes, safe: fmt.safe, copy: copyFor(lang), facts, brand: take.brand || {},
    };
    let html = src;
    for (const id of p.dropped) html = removeSection(html, id);
    for (const s of take.scenes) if (!p.scenes.find((x) => x.id === s.id)) html = removeSection(html, s.id);
    p.scenes.forEach((s, i) => {
      const next = p.scenes[i + 1], tail = next && next.in && next.in.d ? next.in.d : 0;
      html = html.replace(new RegExp(`<section\\b([^>]*)data-scene="${escapeRegExp(s.id)}"([^>]*)>`), (m0, a, b) =>
        `<section${a.replace(/\sdata-(start|duration|track-index)="[^"]*"/g, '')}data-scene="${s.id}"${b.replace(/\sdata-(start|duration|track-index)="[^"]*"/g, '')} data-start="${s.start}" data-duration="${+(s.dur + tail).toFixed(4)}" data-track-index="${i + 1}" style="z-index:${i + 1}">`);
    });
    const u = Math.min(fmt.dw, fmt.dh) / 100;
    const vars = {
      W: fmt.w, H: fmt.h, DW: fmt.dw, DH: fmt.dh, K: fmt.k, DUR: p.duration, FORMAT: fmt.id, SHAPE: fmt.shape, LANG: lang, U: +u.toFixed(3),
      SAFE_T: Math.round(fmt.safe.top * fmt.dh), SAFE_B: Math.round(fmt.safe.bottom * fmt.dh), SAFE_L: Math.round(fmt.safe.left * fmt.dw), SAFE_R: Math.round(fmt.safe.right * fmt.dw),
      TITLE: htmlText(take.title || ''),
    };
    // one pass, so nothing inserted is scanned again; every replacement is a function, so `$&` and `$'` in the data stay text.
    // Like before, only the first FONTS and TAKE placeholder in the file is filled.
    const fonts = fontFaces(take.fonts), data = jsonForScript(TAKE), done = new Set();
    html = html.replace(/\{\{(\w+)\}\}|\/\*FONTS\*\/|\/\*TAKE\*\/null/g, (m0, k) => {
      if (k) return k in vars ? String(vars[k]) : m0;
      if (done.has(m0)) return m0;
      done.add(m0); return m0 === '/*FONTS*/' ? fonts : data;
    });
    if (take.sound?.mode === 'none') html = html.replace(/\s*<audio id="score"[^>]*><\/audio>/, '');

    if (!inside(outRoot, dir)) throw new Error(`refusing to clear ${dir}: it is not inside ${outRoot}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'assets', 'vendor'), { recursive: true });
    if (existsSync(join(proj, 'src', 'assets'))) cpSync(join(proj, 'src', 'assets'), join(dir, 'assets'), { recursive: true });
    cpSync(gsapPath, join(dir, 'assets', 'vendor', 'gsap.min.js'));
    cpSync(KIT, join(dir, 'assets', 'vendor', 'take.js'));
    mkdirSync(join(dir, 'assets', 'audio'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), html);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: `${slug}-${name}`, name: `${take.title || 'Take'} ${name}` }, null, 1));
    writeFileSync(join(dir, 'hyperframes.json'), JSON.stringify({ $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json', paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true }, authoringSkill: 'one-take' }, null, 2));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `${slug}-${name}`, private: true, type: 'module', scripts: { dev: `npx --yes hyperframes@${hfVer} preview`, check: `npx --yes hyperframes@${hfVer} check`, render: `npx --yes hyperframes@${hfVer} render` } }, null, 2));
    builds.push({ name, dir, format: fmt, lang, duration: p.duration, scenes: p.scenes.map((s) => s.id), dropped: p.dropped });
  }
}
writeFileSync(join(outRoot, 'builds.json'), JSON.stringify(builds, null, 1));
for (const b of builds) console.error(`build ${b.name}: ${b.format.w}x${b.format.h}, ${b.duration}s, scenes ${b.scenes.join(' ')}${b.dropped.length ? `, dropped ${b.dropped.join(' ')}` : ''}`);
