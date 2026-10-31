// Read-only git and file helpers shared by detect.mjs and facts.mjs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

// A failed command reads as '': git exits non-zero for "not a repo", "no commits yet" and "no remote", which callers treat as "none".
// A missing binary (git, ffmpeg, which) lands here too; detect.mjs reports that as "not installed" and facts.mjs says git may be missing.
export const sh = (cmd, args, cwd) => {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 << 20 }).trim(); } catch { return ''; }
};
export const isRepo = (dir) => sh('git', ['rev-parse', '--is-inside-work-tree'], dir) === 'true';
export const repoRoot = (dir) => sh('git', ['rev-parse', '--show-toplevel'], dir) || dir;

const LANG = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.css': 'CSS', '.scss': 'CSS', '.sass': 'CSS', '.less': 'CSS', '.html': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte', '.astro': 'Astro',
  '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C', '.h': 'C',
  '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP', '.dart': 'Dart', '.lua': 'Lua', '.sh': 'Shell', '.sql': 'SQL',
  '.md': 'Markdown', '.mdx': 'Markdown', '.glsl': 'GLSL', '.wgsl': 'WGSL', '.ex': 'Elixir', '.exs': 'Elixir', '.zig': 'Zig',
};
const SKIP = /(^|\/)(node_modules|vendor|dist|build|out|\.next|coverage|public\/assets)\/|\.min\.(js|css)$|(package-lock|yarn\.lock|pnpm-lock|bun\.lockb|Cargo\.lock|poetry\.lock)/;

export function linesByLanguage(root) {
  const files = sh('git', ['ls-files'], root).split('\n').filter(Boolean);
  const by = {}; let total = 0, counted = 0;
  for (const f of files) {
    if (SKIP.test(f)) continue;
    const lang = LANG[extname(f).toLowerCase()]; if (!lang) continue;
    const p = join(root, f);
    try { if (statSync(p).size > 2e6) continue; } catch { continue; } // expected: tracked in git but deleted from the working tree
    let n = 0; const s = readFileSync(p, 'utf8'); for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
    if (s.length && s[s.length - 1] !== '\n') n++;
    by[lang] = (by[lang] || 0) + n; total += n; counted++;
  }
  return { total, files: files.length, codeFiles: counted, byLanguage: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1])) };
}

export function readmeInfo(root) {
  const f = ['README.md', 'readme.md', 'README.MD', 'Readme.md', 'README'].map((n) => join(root, n)).find(existsSync);
  const pkgPath = join(root, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  let title = pkg.name || basename(root), tagline = pkg.description || '';
  if (f) {
    const lines = readFileSync(f, 'utf8').split('\n').map((l) => l.trim());
    const h = lines.find((l) => /^#\s+/.test(l)); if (h) title = h.replace(/^#\s+/, '').replace(/[*_`]/g, '');
    const p = lines.find((l, i) => i > 0 && l && !/^[#!<\[>|`-]/.test(l) && l.length > 20);
    if (!tagline && p) tagline = p.replace(/[*_`]/g, '').slice(0, 200);
  }
  return { title, tagline, homepage: pkg.homepage || '', version: pkg.version || '' };
}
