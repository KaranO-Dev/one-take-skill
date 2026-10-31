#!/usr/bin/env node
// Final delivery encode: the HyperFrames render's picture + the score master, at upload quality.
// Platforms re-encode everything, so give them as much as they will take.
// usage: encode.mjs <render.mp4> <master.wav|-> <out.mp4> [--cover <t>] [--gif]
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const run = (args) => { const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }); if (p.status) throw new Error(p.stderr.slice(-1200)); return p.stderr; };

export function encode(render, master, out, o = {}) {
  const audio = master && master !== '-';
  run([
    '-i', render, ...(audio ? ['-i', master] : []),
    '-map', '0:v:0', ...(audio ? ['-map', '1:a:0'] : ['-map', '0:a:0?']),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(o.crf ?? 12), '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-x264-params', 'ref=6:bframes=4:deblock=-1,-1:psy-rd=0.4,0:aq-strength=0.6',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-aac_pns', '0',
    '-movflags', '+faststart', '-shortest', out,
  ]);
  const extra = {};
  if (o.cover != null) { extra.cover = out.replace(/\.mp4$/, '.cover.jpg'); run(['-ss', String(o.cover), '-i', out, '-frames:v', '1', '-q:v', '2', extra.cover]); }
  if (o.gif) {
    extra.gif = out.replace(/\.mp4$/, '.gif');
    run(['-i', out, '-vf', `fps=15,scale=${o.gifWidth || 540}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', extra.gif]);
  }
  return extra;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2), [render, master, out] = a;
  if (!out) { console.error('usage: encode.mjs <render.mp4> <master.wav|-> <out.mp4> [--cover t] [--gif]'); process.exit(2); }
  const ci = a.indexOf('--cover');
  const x = encode(render, master, out, { cover: ci >= 0 ? +a[ci + 1] : undefined, gif: a.includes('--gif') });
  console.error(`encode → ${out}${x.cover ? ` + ${x.cover}` : ''}${x.gif ? ` + ${x.gif}` : ''}`);
}
