#!/usr/bin/env node
// Load a built composition in headless Chrome with #probe, and read back what the kit wrote:
// every T.cue() (→ cues.json, the score's input), the end-card mark, and the size and
// position of every piece of text over time (→ the text-size and safe-zone checks).
// usage: probe.mjs <built-dir> [--out <file>]     (default <built-dir>/probe.json)
// Chrome gets 60 s of real time per probe; set ONE_TAKE_PROBE_TIMEOUT=<seconds> for a longer composition.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const base = join(homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell');
  if (existsSync(base)) {
    for (const v of readdirSync(base).sort().reverse()) {
      for (const sub of readdirSync(join(base, v))) {
        for (const exe of ['chrome-headless-shell', 'chrome-headless-shell.exe']) { const p = join(base, v, sub, exe); if (existsSync(p)) return p; }
      }
    }
  }
  const sys = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  const hit = sys.find(existsSync);
  if (!hit) throw new Error('no Chrome found: run `npx hyperframes doctor` once (it downloads chrome-headless-shell) or set CHROME_PATH');
  return hit;
}

export function probe(dir, { timeoutSec = +process.env.ONE_TAKE_PROBE_TIMEOUT || 60 } = {}) {
  const url = pathToFileURL(join(resolve(dir), 'index.html')).href + '#probe';
  const profile = mkdtempSync(join(tmpdir(), 'one-take-chrome-')); // own profile: never joins (or reads) the user's running Chrome
  const posix = process.platform !== 'win32';
  let r;
  try {
    // --allow-file-access-from-files: from file:// Chrome blocks CSS mask images (T.iris with a logo mark) as cross-origin and the masked scene vanishes
    r = spawnSync(findChrome(), ['--headless', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--virtual-time-budget=60000', '--run-all-compositor-stages-before-draw', '--dump-dom', url],
      { encoding: 'utf8', maxBuffer: 512 << 20, stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutSec * 1000, killSignal: 'SIGKILL', detached: posix });
  } finally {
    // detached = its own process group: on a timeout, an error or a normal exit, kill whatever Chrome helpers are left
    if (posix && r && r.pid) try { process.kill(-r.pid, 'SIGKILL'); } catch { /* ESRCH: the group is already gone, which is the normal case */ }
    rmSync(profile, { recursive: true, force: true });
  }
  if (r.error) throw new Error(r.error.code === 'ETIMEDOUT' ? `${dir}: Chrome was killed after ${timeoutSec}s without finishing the probe. A script may be stuck; or set ONE_TAKE_PROBE_TIMEOUT to give a long composition more time.` : `${dir}: could not run Chrome: ${r.error.message}`);
  if (r.status || r.signal) throw new Error(`${dir}: Chrome ended with ${r.signal || `status ${r.status}`}`);
  const html = r.stdout;
  const m = html.match(/<script type="application\/json" id="take-probe">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${dir}: the probe never finished. Open it in a browser with #probe and check the console (a script error, or T.done() not called).`);
  return JSON.parse(m[1]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: probe.mjs <built-dir> [--out file]'); process.exit(2); }
  const oi = process.argv.indexOf('--out'), out = oi > 0 ? process.argv[oi + 1] : join(dir, 'probe.json');
  const p = probe(dir);
  writeFileSync(out, JSON.stringify(p, null, 1));
  writeFileSync(join(dir, 'cues.json'), JSON.stringify(p.cues, null, 1));
  const small = p.text.filter((t) => !t.deco && t.minPct < 3.4).length;
  console.error(`probe ${dir}: ${p.cues.length} cues, ${p.text.length} text items (${small} under 3.4% of the short side), end card at ${p.marks.endCard ?? 'unmarked'} of ${p.duration}s`);
}
