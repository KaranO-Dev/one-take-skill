// Delivery targets. Caps and UI bands change; treat these as defaults the intake can override.
// safe: fraction of the frame covered by platform UI on each side (keep text inside).

// The HyperFrames CLI that run.mjs and the generated package.json call when take.json pins no "hyperframes" version.
export const HF_VERSION = '0.8.223';

// Anything from take.json that becomes part of a path or a command (language, format id, slug, output name,
// CLI version) must pass this: letters, digits, '.', '_' and '-', 1 to 64 characters, never '..'.
export function safeId(what, v) {
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(v) || v.includes('..')) throw new Error(`take.json: ${what} ${JSON.stringify(v)} is not allowed. Use 1-64 letters, digits, '.', '_' or '-', starting with a letter or digit, with no '..'.`);
  return v;
}
export const hfVersion = (take) => safeId('hyperframes version', take.hyperframes || HF_VERSION);

export const SHAPES = {
  '4x5': { w: 1080, h: 1350, shape: 'portrait' },
  '9x16': { w: 1080, h: 1920, shape: 'tall' },
  '16x9': { w: 1920, h: 1080, shape: 'wide' },
  '1x1': { w: 1080, h: 1080, shape: 'square' },
  '4x3': { w: 1440, h: 1080, shape: 'wide' },
  '3x4': { w: 1080, h: 1440, shape: 'portrait' },
};

export const PLATFORMS = {
  'instagram-feed': { shape: '4x5', maxSec: 60, safe: { top: 0.04, bottom: 0.04, left: 0.04, right: 0.04 } },
  'instagram-story': { shape: '9x16', maxSec: 60, safe: { top: 0.14, bottom: 0.2, left: 0.06, right: 0.06 } },
  'instagram-reels': { shape: '9x16', maxSec: 180, safe: { top: 0.12, bottom: 0.24, left: 0.06, right: 0.14 } },
  tiktok: { shape: '9x16', maxSec: 600, safe: { top: 0.1, bottom: 0.22, left: 0.06, right: 0.16 } },
  'youtube-shorts': { shape: '9x16', maxSec: 180, safe: { top: 0.1, bottom: 0.2, left: 0.06, right: 0.14 } },
  youtube: { shape: '16x9', maxSec: null, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  linkedin: { shape: '4x5', maxSec: 600, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  x: { shape: '16x9', maxSec: 140, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
  website: { shape: '16x9', maxSec: null, safe: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 } },
};

// Resolve a format entry from take.json into concrete numbers.
// accepts { id: '9x16', platform: 'instagram-story', scale: 1|2, maxSec?, safe?, w?, h? }
export function resolveFormat(f) {
  const p = PLATFORMS[f.platform] || {};
  const id = safeId('format id', f.id || p.shape);
  const s = SHAPES[id];
  if (!s && !(f.w && f.h)) throw new Error(`unknown format ${id}; use one of ${Object.keys(SHAPES).join(', ')} or give w/h`);
  const dw = f.w || s.w, dh = f.h || s.h, k = f.scale || 1;
  return {
    id, platform: f.platform || 'website', shape: s ? s.shape : dw > dh ? 'wide' : dw < dh ? 'portrait' : 'square',
    dw, dh, w: Math.round(dw * k), h: Math.round(dh * k), k,
    maxSec: f.maxSec !== undefined ? f.maxSec : p.maxSec ?? null,
    safe: Object.assign({ top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 }, p.safe, f.safe),
  };
}
