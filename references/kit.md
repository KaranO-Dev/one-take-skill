# The kit: `T.*`

`kit/take.js` is copied into every build as `assets/vendor/take.js`. It is a set of seek-safe helpers on one paused GSAP timeline.

- Every helper takes absolute seconds. Get them from a scene's clock (`s.t`, `s.beat`, `s.bar`).
- Most helpers cue a sound by default. Pass `cue: false` to keep a moment silent, or `cue: 'name'` to change the sound.

```js
window.TAKE = /*TAKE*/null;          // build.mjs fills this
const T = Take.init();
const C = T.copy, F = T.facts;       // copy/<lang>.json, facts.json

T.scene('proof', (s) => {            // runs only if this format has the scene
  s.start; s.end; s.dur; s.energy; s.prev; s.next;
  s.t(1.2); s.beat(2); s.bar(1);     // local clocks → absolute seconds
  …
});
window.__timelines["main"] = T.done();
```

## Text

| Call | Does | Default cue |
|---|---|---|
| `T.split(sel, text)` | wraps words in `.w > i` masks, hidden below | — |
| `T.rise(sel, at, {d, s, ease, cue:'each', each:'pop'})` | words rise into place, staggered | `rise` once, or one per word |
| `T.sink(sel, at, {d, s, cue})` | words leave upward | none |
| `T.handover(outs, ins, at)` | old lines sink while new lines rise in their place | `rise` |
| `T.swap(sel, texts, times)` | a label changes in place, crossfaded and stacked | `switch` per change |
| `T.type(sel, text, at, {cps, seed})` | typed one character at a time, human timing | `key` per character |
| `T.count(sel, at, to, {from, d, ease, format, sep, maxRate})` | number count-up. `to` must be a finite number, or it throws | `tick` per visible change, `land` at the end |

## Panels

| Call | Does | Default cue |
|---|---|---|
| `T.enter(sel, at, {from:'up'\|'down'\|'left'\|'right'\|'none', blur, scale, d, st})` | arrives out of a blur | `swish` |
| `T.leave(sel, at, {to, blur, d, st, cue})` | leaves into a blur | none |

## Transitions

| Call | Does | Default cue |
|---|---|---|
| `T.iris(scene, at, {mask, x, y, d, curve, outCam, inCam})` | reveal through a growing circle, or any SVG (`mask: 'url(assets/brand/mark.svg)'`) | `whoosh` + `land` |
| `T.wipe(scene, at, {dir, d, ease})` | clip-path wipe | `whoosh` |
| `T.whip(outCam, inCam, at, {dir, d})` | whip pan with motion blur | `whoosh` + `land` |
| `T.matchCut(inCam, at, {sc, d, cue})` | cut on a matching frame; the new camera settles from scale `sc` | none |

Give the incoming scene `in: { d }` in take.json, so the outgoing scene is still on screen under the transition.

## Camera and hits

| Call | Does | Default cue |
|---|---|---|
| `T.drift(cam, from, to, {scale, x, y, rot, from})` | a slow push across a scene, so it never stands still. `from` and `to` are times; the option `from` is the starting scale | — |
| `T.shake(el, at, {amp, n, d, seed})` | seeded camera shake | `impact` |
| `T.hit(sel, at, {px, scale, d})` | RGB split + scale punch | `impact` |
| `T.flash(at, {color, peak, d, blend, cue})` | full-frame flash | none |

## Cursor

```js
T.cursor('#cur').from(540, 900, s.t(0))
  .move(s.t(0.4), 300, 620, { d: 0.7, bow: 0.2 })
  .click(s.t(1.2), { ring: '#ring' });     // design px; cue: click, panned from x
```

## Texture (full-frame overlays, deterministic)

| Call | Does |
|---|---|
| `T.grain({opacity, scale, fps, blend, seed})` | one seeded noise tile, jumped to a new offset 12×/s |
| `T.vignette({inner, strength})` | radial darkening at the edges |
| `T.leak(from, to, {color, peak})` | a warm light leak drifting across |

## Sound and marks

| Call | Does |
|---|---|
| `T.cue(name, t, {s, x, el, d, p})` | one sound at `t`. Categories are listed in `sound.md` |
| `T.endCard(t)` | the end card is complete. QA wants the hold from here to the end to be ≥ 3 s |
| `T.mark(name, t)` | a named time, for the report and the probe |

## Values

- `T.W`, `T.H`: design size.
- `T.u`: 1% of the short side.
- `T.fmt`: `'9x16'` etc.
- `T.take.shape`: `portrait`, `tall`, `wide` or `square`.
- `T.lang`, `T.beat`, `T.bar`, `T.total`.
- `T.rnd()`: seeded random.
- `T.rng(seed)`: a new seeded generator.

## Rules the kit relies on

- `T.count` has no default number. Pass one that exists, such as `F.total.commits`. If `to` is missing or not finite, it throws, and the probe stops with "the probe never finished" (the real error is in the browser console). Run `facts.mjs` first.
- `T.done()` registers the timeline once, under `window.__timelines["main"]`, after every tween is added. Build the whole timeline before it, not inside `document.fonts.ready` or another async callback. HyperFrames lint rejects an early registration (`gsap_timeline_registered_before_async_build`).
- Don't put a template literal inside `querySelector` or `querySelectorAll`, such as `` `[data-scene="${id}"]` ``. Lint rejects it (`template_literal_selector`). Pick the element with `T.$$(...)` and `find`, or use a plain string.
- Set initial states with `fromTo` or `gsap.set`, never with a CSS `transform` on the same property. `lint` rejects that.
- Don't tween `.clip` or `.scene` visibility. HyperFrames owns it. Animate children, or the scene's `.cam`.
- No `Date.now()`, no `Math.random()`, no network. Use `T.rnd()`.
- Text that isn't meant to be read (giant numerals, texture) gets `data-deco`, so the `text-size` and `safe-zone` checks skip it.
