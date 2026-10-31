# Formats

HyperFrames reads `data-width`/`data-height` and the root `data-duration` once, at compile time. So one composition can't render several aspect ratios. `build.mjs` handles this by writing one HyperFrames project per format × language from a single source.

## What build.mjs fills in

| Token | Value |
|---|---|
| `{{W}}` `{{H}}` | output pixels (design × `scale`) |
| `{{DW}}` `{{DH}}` | design pixels: what you lay out in |
| `{{K}}` | scale from design to output (`#stage` is scaled by it, so 4K stays sharp) |
| `{{U}}` | 1% of the short side, in design px. Exposed as `--u` |
| `{{SAFE_T}}` … `{{SAFE_R}}` | the platform's UI bands in design px. Exposed as `--safe-*` and used by `.safe` |
| `{{FORMAT}}` `{{SHAPE}}` | `<html class="f-9x16 f-tall">`; shape is `portrait`, `tall`, `wide` or `square` |
| `{{LANG}}` `{{TITLE}}` | the language code, and `take.json` `title` |
| `{{DUR}}` | this format's length after cutdowns |
| `/*TAKE*/` | the format's scene timing, copy, facts, safe bands |
| `/*FONTS*/` | `@font-face` for each `take.json` font |

Each `<section data-scene>` gets `data-start`, `data-duration`, `data-track-index` and a z-index. Scenes not in this format (`only`, `skip`, or cut for the cap) are removed from the HTML, and `T.scene()` skips their code.

## Re-lay out, don't rescale

Write the base layout for the first format, then override per shape:

```css
.f-tall #proof .num  { font-size: calc(var(--u) * 30); }        /* taller frame, bigger number */
.f-tall #proof .safe { justify-content: flex-start; padding-top: calc(var(--u) * 12); }
.f-wide #proof .safe { flex-direction: row; align-items: center; gap: calc(var(--u) * 8); }
.f-square .body      { display: none; }                          /* fewer words where space is tight */
```

In JS, branch on `T.fmt` or `T.take.shape` for positions (a cursor path, a camera target) and use `T.W`/`T.H`/`T.u` for sizes.

## Safe zones

- `.safe` is the area platform UI won't cover. Readable text belongs inside it.
- Backgrounds, imagery and motion should bleed to the full frame.
- The probe measures every text element over time. QA fails a story, reel, TikTok or Shorts output whose text sits outside the bands for 0.75 s or more, and warns on other platforms.

## Cutdowns

When a format has a cap (`maxSec`, from the platform or set explicitly) and the film runs longer, `build.mjs` drops `optional` scenes, highest number first, until it fits. If it still doesn't fit, it warns and QA fails `platform-cap`.

To plan a 60 s story cut of a 64 s film, mark a 4 s scene `optional`. Don't speed anything up: the music's bars stay intact.

## Resolution and fps

- `scale: 2` on a format renders at twice the pixels with the same layout. Expect about 4× the render time.
- `fps: 60` doubles render time. Use it only when motion is fast enough to judder at 30, such as whips, fast counters or scrolling UI.
