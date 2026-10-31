/* one-take kit: seek-safe motion helpers for one paused GSAP timeline.
 *
 *   const T = Take.init();                 // reads window.TAKE (written by build.mjs)
 *   T.scene('hook', (s) => { T.rise('#h1', s.t(0.2)); T.cue('stab', s.bar(1)); });
 *   T.done();                              // registers the timeline (and runs the probe on #probe)
 *
 * Every sound in the score is written down where the picture makes it, with T.cue().
 * Nothing here reads a clock, the network or unseeded randomness.
 */
(function () {
  'use strict';
  const r4 = (v) => Math.round(v * 10000) / 10000;
  // Only the probe waits for fonts, and only to seek a finished timeline. Nothing is built or registered inside this wait.
  const fontsReady = () => (document.fonts ? document.fonts.ready : Promise.resolve());

  function mulberry(seed) {
    let s = seed >>> 0 || 1;
    return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function init(opts) {
    opts = opts || {};
    const TAKE = window.TAKE;
    if (!TAKE) throw new Error('window.TAKE missing: build with one-take/scripts/build.mjs');
    const gsap = window.gsap;
    const tl = gsap.timeline({ paused: true });
    const $ = (s, root) => (typeof s === 'string' ? (root || document).querySelector(s) : s);
    const $$ = (s, root) => (typeof s === 'string' ? Array.from((root || document).querySelectorAll(s)) : [].concat(s));
    // text only ever goes in through textContent: copy, facts and commit subjects are data, never markup
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const beat = 60 / TAKE.bpm, bar = beat * (TAKE.beatsPerBar || 4);
    const cues = [], marks = {};
    const rnd = mulberry(opts.seed || TAKE.seed || 1);
    const sceneById = {};
    TAKE.scenes.forEach((s) => { sceneById[s.id] = s; });

    const T = {
      tl, gsap, $, $$, beat, bar, take: TAKE, W: TAKE.W, H: TAKE.H, fmt: TAKE.format, lang: TAKE.lang,
      copy: TAKE.copy || {}, facts: TAKE.facts || {}, total: TAKE.duration, rnd, rng: mulberry,
      cues, marks,
      // design units: 1u = 1% of the short side. Use for anything sized in JS.
      u: Math.min(TAKE.W, TAKE.H) / 100,
      has: (id) => !!sceneById[id],
    };

    // ---- clocks ----
    T.scene = (id, fn) => {
      const sc = sceneById[id]; if (!sc) return null;
      const s = {
        id, start: sc.start, dur: sc.dur, end: sc.start + sc.dur, energy: sc.energy, el: $$('[data-scene]').find((e) => e.getAttribute('data-scene') === id) || null,
        t: (x) => sc.start + x, bar: (n) => sc.start + n * bar, beat: (n) => sc.start + n * beat,
        next: sc.next, prev: sc.prev,
      };
      fn(s);
      return s;
    };
    T.at = (id, x) => sceneById[id].start + (x || 0);

    // ---- cues: the score reads these ----
    // o: { x: design px or 0..1, el: selector to take x from (resolved by the probe), s: strength 0..1, d: seconds, p: chord-tone index }
    T.cue = (n, t, o) => {
      const c = Object.assign({ n, t: r4(t) }, o);
      if (c.el && typeof c.el !== 'string') c.el = c.el.id ? '#' + c.el.id : undefined;
      cues.push(c); return t;
    };
    T.mark = (name, t) => { marks[name] = r4(t); return t; };
    // The moment the end card is complete. QA needs it held for >= 3 s.
    T.endCard = (t) => { T.mark('endCard', t); return t; };

    // ---- words ----
    T.split = (sel, text) => {
      const el = $(sel); if (!el) return el;
      const words = Array.isArray(text) ? text : String(text != null ? text : el.textContent).trim().split(/\s+/);
      el.textContent = '';
      words.forEach((w, k) => { if (k) el.appendChild(document.createTextNode(' ')); const m = mk('span', 'w'); m.appendChild(mk('i', '', w)); el.appendChild(m); });
      el.querySelectorAll('.w > i').forEach((i) => gsap.set(i, { yPercent: 118 }));
      return el;
    };
    T.rise = (sel, at, o) => {
      o = o || {}; const words = $$(`${sel} .w > i`).length ? `${sel} .w > i` : sel;
      const n = $$(words).length, st = o.s != null ? o.s : 0.06;
      tl.fromTo(words, { yPercent: 118 }, { yPercent: 0, duration: o.d || 0.8, ease: o.ease || 'expo.out', stagger: st, immediateRender: false }, at);
      if (o.cue !== false) {
        if (o.cue === 'each') for (let i = 0; i < n; i++) T.cue(o.each || 'pop', at + i * st + 0.04, { el: sel, s: 0.5, p: i });
        else T.cue(o.cue || 'rise', at, { el: sel, s: o.strength != null ? o.strength : 0.5, d: (o.d || 0.8) + n * st });
      }
      return at;
    };
    T.sink = (sel, at, o) => {
      o = o || {};
      tl.to(`${sel} .w > i`, { yPercent: -118, duration: o.d || 0.45, ease: 'power3.in', stagger: o.s != null ? o.s : 0.035 }, at);
      if (o.cue) T.cue(o.cue, at, { el: sel, s: 0.3 });
      return at;
    };
    T.handover = (outs, ins, at, o) => {
      [].concat(outs).forEach((s, i) => T.sink(s, at + i * 0.04));
      [].concat(ins).forEach((s, i) => T.rise(s, at + 0.32 + i * 0.14, Object.assign({ s: 0.07, cue: i ? false : undefined }, o)));
      return at;
    };

    // A label that changes in place: versions stacked and crossfaded (seek-safe).
    T.swap = (sel, texts, times, o) => {
      o = o || {}; const host = $(sel);
      host.textContent = '';
      texts.forEach((t) => host.appendChild(mk('span', 'swap-v', t)));
      host.classList.add('swap');
      const sp = Array.from(host.children); sp.forEach((e, i) => gsap.set(e, { opacity: i ? 0 : 1 }));
      times.forEach((t, i) => {
        tl.to(sp[i], { opacity: 0, y: -0.25 + 'em', duration: 0.25, ease: 'power2.in' }, t);
        tl.fromTo(sp[i + 1], { opacity: 0, y: 0.25 + 'em' }, { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out', immediateRender: false }, t + 0.18);
        T.cue(o.cue || 'switch', t + 0.18, { el: sel, s: 0.4 });
      });
    };

    // Number count-up; one tick per visible change, at most `maxRate` per second.
    T.count = (sel, at, to, o) => {
      if (typeof to !== 'number' || !isFinite(to)) throw new Error(`T.count(${String(sel)}): no number to count to (got ${to}). Read it from T.facts or the copy; there is no default.`);
      o = o || {}; const from = o.from || 0, d = o.d || 1.6, ease = o.ease || 'power3.out', el = $(sel);
      const fmt = o.format || ((v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, o.sep || ','));
      const p = { v: from };
      el.textContent = fmt(from);
      tl.to(p, { v: to, duration: d, ease, onUpdate() { el.textContent = fmt(p.v); } }, at);
      if (o.cue !== false) {
        const e = gsap.parseEase(ease), maxRate = o.maxRate || 22; let last = fmt(from), lastT = -1;
        for (let k = 1; k <= 240; k++) {
          const f = k / 240, v = from + (to - from) * e(f), s = fmt(v), tt = at + f * d;
          if (s !== last && tt - lastT >= 1 / maxRate) { T.cue(o.cue || 'tick', tt, { el: sel, s: 0.25 + 0.5 * (1 - f) }); last = s; lastT = tt; }
        }
        T.cue(o.land || 'land', at + d * 0.92, { el: sel, s: 0.6 });
      }
      return at + d;
    };

    // Typewriter: one span per character, a key cue per character with human timing.
    T.type = (sel, text, at, o) => {
      o = o || {}; const el = $(sel), cps = o.cps || 18, jit = mulberry(o.seed || 7);
      el.textContent = '';
      Array.from(text).forEach((ch) => el.appendChild(mk('span', 'ch', ch === ' ' ? '\u00a0' : ch)));
      const chars = Array.from(el.children); let t = at;
      chars.forEach((c, i) => {
        gsap.set(c, { opacity: 0 });
        tl.set(c, { opacity: 1 }, t);
        if (o.cue !== false && text[i] !== ' ') T.cue(o.cue || 'key', t, { el: sel, s: 0.35 + jit() * 0.3 });
        t += (1 / cps) * (0.6 + jit() * 0.8) * (text[i] === ' ' ? 1.6 : 1);
      });
      return t;
    };

    // ---- panels ----
    const DIRS = { up: { y: 40 }, down: { y: -40 }, left: { x: 60 }, right: { x: -60 }, none: {} };
    T.enter = (sel, at, o) => {
      o = o || {}; const from = Object.assign({ opacity: 0, scale: o.scale || 1.035 }, DIRS[o.from || 'up']);
      if (o.blur !== false) from.filter = `blur(${o.blur || 14}px)`;
      const to = { opacity: 1, x: 0, y: 0, scale: 1, duration: o.d || 0.95, ease: o.ease || 'expo.out', stagger: o.st || 0, immediateRender: false };
      if (from.filter) to.filter = 'blur(0px)';
      gsap.set(sel, { opacity: 0 });
      tl.fromTo(sel, from, to, at);
      if (o.cue !== false) T.cue(o.cue || 'swish', at, { el: sel, s: o.strength != null ? o.strength : 0.4 });
      return at;
    };
    T.leave = (sel, at, o) => {
      o = o || {}; const to = Object.assign({ opacity: 0, scale: o.scale || 0.965, duration: o.d || 0.55, ease: 'power2.in', stagger: o.st || 0 }, DIRS[o.to || 'down'] ? { y: (DIRS[o.to || 'down'].y || 0) * -0.6, x: (DIRS[o.to || 'down'].x || 0) * -0.6 } : {});
      if (o.blur !== false) to.filter = `blur(${o.blur || 10}px)`;
      tl.to(sel, to, at);
      if (o.cue) T.cue(o.cue, at, { el: sel, s: 0.3 });
      return at;
    };

    // ---- scene transitions ----
    // Reveal a scene through a growing mask: a circle, or any SVG (a logo mark) via o.mask = 'url(assets/brand/mark.svg)'.
    T.iris = (scene, at, o) => {
      o = o || {}; const el = $(scene), d = o.d || 1.15, p = { v: 0 };
      const cx = o.x != null ? o.x : 50, cy = o.y != null ? o.y : 50;
      const set = () => {
        const k = Math.pow(p.v, o.curve || 2.2);
        if (o.mask) { el.style.webkitMaskImage = el.style.maskImage = o.mask; el.style.webkitMaskRepeat = el.style.maskRepeat = 'no-repeat'; el.style.webkitMaskPosition = el.style.maskPosition = `${cx}% ${cy}%`; el.style.webkitMaskSize = el.style.maskSize = `${2 + k * 1500}%`; }
        else { const r = k * 150; el.style.webkitMaskImage = el.style.maskImage = `radial-gradient(circle at ${cx}% ${cy}%, #000 ${r}%, transparent ${r + 0.4}%)`; }
      };
      set();
      tl.fromTo(p, { v: 0 }, { v: 1, duration: d, ease: o.ease || 'power1.inOut', onUpdate: set, immediateRender: false }, at);
      tl.set(el, { webkitMaskImage: 'none', maskImage: 'none' }, at + d + 0.01);
      if (o.outCam) tl.to(o.outCam, { scale: 0.93, duration: d, ease: 'power2.in' }, at);
      if (o.inCam) tl.fromTo(o.inCam, { scale: 1.12 }, { scale: 1, duration: 1.8, ease: 'expo.out', immediateRender: false }, at + 0.2);
      if (o.cue !== false) { T.cue('whoosh', at, { s: 0.6, d }); T.cue('land', at + d * 0.85, { s: 0.7 }); }
      return at + d;
    };
    // Clip-path wipe with a hard edge, from any of four directions (left, right, up, down).
    T.wipe = (scene, at, o) => {
      o = o || {}; const d = o.d || 0.7, dir = o.dir || 'left';
      const start = { left: 'inset(0 0 0 100%)', right: 'inset(0 100% 0 0)', up: 'inset(100% 0 0 0)', down: 'inset(0 0 100% 0)' }[dir];
      tl.fromTo(scene, { clipPath: start }, { clipPath: 'inset(0 0 0 0)', duration: d, ease: o.ease || 'expo.inOut', immediateRender: false }, at);
      if (o.cue !== false) T.cue('whoosh', at, { s: 0.5, d, x: dir === 'left' ? 1 : dir === 'right' ? 0 : 0.5 });
      return at + d;
    };
    // Whip pan: the old camera flies out with motion blur, the new one lands.
    T.whip = (outCam, inCam, at, o) => {
      o = o || {}; const d = o.d || 0.5, dx = (o.dir === 'right' ? 1 : -1) * T.W * 1.1;
      tl.to(outCam, { x: dx, filter: 'blur(24px)', duration: d * 0.5, ease: 'power3.in' }, at);
      tl.fromTo(inCam, { x: -dx, filter: 'blur(24px)' }, { x: 0, filter: 'blur(0px)', duration: d, ease: 'expo.out', immediateRender: false }, at + d * 0.45);
      if (o.cue !== false) { T.cue('whoosh', at, { s: 0.8, d: d * 0.9, x: o.dir === 'right' ? 0 : 1 }); T.cue('land', at + d * 0.6, { s: 0.5 }); }
      return at + d;
    };
    // Match cut: the next scene opens on a frame that looks like the last one, then its camera settles from scale `sc` to 1.
    T.matchCut = (inCam, at, o) => {
      o = o || {};
      if (o.sc && o.sc !== 1) tl.fromTo(inCam, { scale: o.sc }, { scale: 1, duration: o.d || 1.8, ease: 'power2.inOut', immediateRender: false }, at);
      if (o.cue) T.cue(o.cue, at, { s: 0.5 });
      return at;
    };

    // ---- camera ----
    // No scene stands still: a slow push across the scene.
    T.drift = (cam, from, to, o) => {
      o = o || {};
      // only the properties asked for, so a whip or shake on the same camera keeps its x/y
      const a = { scale: o.from || 1 }, b = { scale: o.scale || 1.03, duration: Math.max(0.1, to - from), ease: o.ease || 'none', immediateRender: false };
      if (o.x != null) { a.x = 0; b.x = o.x; }
      if (o.y != null) { a.y = 0; b.y = o.y; }
      if (o.rot != null) { a.rotation = 0; b.rotation = o.rot; }
      tl.fromTo(cam, a, b, from);
    };
    T.shake = (el, at, o) => {
      o = o || {}; const n = o.n || 7, amp = o.amp || 0.8 * T.u, d = o.d || 0.35, r = mulberry(o.seed || 11);
      for (let i = 0; i < n; i++) { const k = 1 - i / n; tl.to(el, { x: (r() - 0.5) * 2 * amp * k, y: (r() - 0.5) * 2 * amp * k, duration: d / n, ease: 'sine.inOut' }, at + (i * d) / n); }
      tl.to(el, { x: 0, y: 0, duration: d / n, ease: 'sine.out' }, at + d);
      if (o.cue !== false) T.cue(o.cue || 'impact', at, { s: o.strength || 0.8 });
    };
    // Chromatic hit: RGB split on an element for a few frames, plus a punch in scale.
    T.hit = (sel, at, o) => {
      o = o || {}; const px = o.px || 0.6 * T.u, d = o.d || 0.28;
      tl.fromTo(sel, { filter: `drop-shadow(${px}px 0 0 rgba(255,0,72,.75)) drop-shadow(${-px}px 0 0 rgba(0,210,255,.75))`, scale: o.scale || 1.06 },
        { filter: 'drop-shadow(0px 0 0 rgba(255,0,72,0)) drop-shadow(0px 0 0 rgba(0,210,255,0))', scale: 1, duration: d, ease: 'power3.out', immediateRender: false }, at);
      if (o.cue !== false) T.cue(o.cue || 'impact', at, { el: sel, s: o.strength || 0.8 });
    };
    T.flash = (at, o) => {
      o = o || {}; const f = overlay('flash', `background:${o.color || '#fff'};opacity:0;mix-blend-mode:${o.blend || 'normal'}`);
      tl.fromTo(f, { opacity: o.peak || 0.85 }, { opacity: 0, duration: o.d || 0.4, ease: 'power2.out', immediateRender: false }, at);
      if (o.cue) T.cue(o.cue, at, { s: 0.7 });
    };

    // ---- the hand on the mouse ----
    // T.cursor('#cur').from(x, y, t).move(t, x, y, {d, bow}).click(t, {ring:'#ring'}) — design px.
    T.cursor = (sel, o) => {
      o = o || {}; const el = $(sel), r = mulberry(o.seed || 5); let px = 0, py = 0;
      const api = {
        from(x, y, t) { px = x; py = y; tl.set(el, { x, y }, t || 0); return api; },
        move(t, x, y, m) {
          m = m || {}; const d = m.d || 0.6, bow = m.bow != null ? m.bow : 0.18, p = { k: 0 };
          const x0 = px, y0 = py, dx = x - x0, dy = y - y0, cx = x0 + dx / 2 - dy * bow, cy = y0 + dy / 2 + dx * bow, tr = r() * 1000;
          tl.fromTo(p, { k: 0 }, { k: 1, duration: d, ease: m.ease || 'power3.inOut', immediateRender: false, onUpdate() {
            const k = p.k, a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k, w = Math.sin(k * Math.PI) * 1.2;
            gsap.set(el, { x: a * x0 + b * cx + c * x + Math.sin(tr + k * 31) * w, y: a * y0 + b * cy + c * y + Math.cos(tr + k * 27) * w });
          } }, t);
          px = x; py = y;
          if (m.cue) T.cue(m.cue, t, { x: x0 / T.W, s: 0.2 });
          return api;
        },
        click(t, m) {
          m = m || {};
          tl.to(el, { scale: 0.82, duration: 0.08, ease: 'power2.out', transformOrigin: '6px 4px' }, t);
          tl.to(el, { scale: 1, duration: 0.24, ease: 'back.out(3)' }, t + 0.1);
          if (m.ring) { tl.set(m.ring, { x: px, y: py }, t); tl.fromTo(m.ring, { scale: 0.3, opacity: 0.95 }, { scale: 1.3, opacity: 0, duration: 0.55, ease: 'power2.out', immediateRender: false }, t); }
          T.cue(m.cue || 'click', t, { x: px / T.W, s: m.s || 0.6 });
          return api;
        },
      };
      return api;
    };

    // ---- overlays (deterministic) ----
    const stage = document.getElementById('stage') || document.body;
    function overlay(cls, css) { const d = document.createElement('div'); d.className = 'ot-overlay ' + cls; d.setAttribute('data-layout-allow-overflow', ''); d.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:900;${css}`; stage.appendChild(d); return d; }
    // Film grain: one seeded noise tile, jumped to a new offset 12 times a second.
    T.grain = (o) => {
      o = o || {}; const size = 192, c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'), img = g.createImageData(size, size), r = mulberry(o.seed || 3);
      for (let i = 0; i < img.data.length; i += 4) { const v = (r() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
      const el = overlay('grain', `background-image:url(${c.toDataURL()});background-size:${size * (o.scale || 1.5)}px;opacity:${o.opacity || 0.07};mix-blend-mode:${o.blend || 'overlay'}`);
      const steps = Math.max(1, Math.round(T.total * (o.fps || 12)));
      tl.fromTo(el, { backgroundPosition: '0px 0px' }, { backgroundPosition: `${steps * 97}px ${steps * 61}px`, duration: T.total, ease: `steps(${steps})`, immediateRender: false }, 0);
      return el;
    };
    T.vignette = (o) => { o = o || {}; return overlay('vignette', `background:radial-gradient(ellipse at 50% 45%, transparent ${o.inner || 55}%, rgba(0,0,0,${o.strength || 0.45}) 100%)`); };
    // A warm light leak drifting across the frame between two times.
    T.leak = (from, to, o) => {
      o = o || {}; const el = overlay('leak', `background:radial-gradient(closest-side, ${o.color || 'rgba(255,150,60,.55)'}, transparent);width:140%;height:90%;left:-20%;top:5%;inset:auto;mix-blend-mode:screen;opacity:0;filter:blur(${4 * T.u}px)`);
      tl.fromTo(el, { xPercent: -45, opacity: 0 }, { xPercent: 45, opacity: o.peak || 0.7, duration: (to - from) / 2, ease: 'sine.in', immediateRender: false }, from);
      tl.to(el, { xPercent: 90, opacity: 0, duration: (to - from) / 2, ease: 'sine.out' }, from + (to - from) / 2);
      return el;
    };

    // ---- finish ----
    T.done = () => {
      // pad the timeline to the full length so the last frame holds what the end card shows
      tl.set({}, {}, T.total);
      window.TAKE_CUES = cues; window.TAKE_MARKS = marks;
      // Register once, after every tween is added. The runtime treats a registered key as ready.
      const id = TAKE.compositionId || 'main';
      window.__timelines = window.__timelines || {};
      window.__timelines[id] = tl;
      if (/probe/.test(location.hash)) fontsReady().then(() => probe(T));
      return tl;
    };
    return T;
  }

  // ---- probe: run by scripts/probe.mjs in headless Chrome, never during a render ----
  function probe(T) {
    const tl = T.tl, step = 0.25, clips = Array.from(document.querySelectorAll('.clip[data-start]'));
    const root = document.querySelector('[data-composition-id]'), rr = root.getBoundingClientRect();
    const short = Math.min(rr.width, rr.height), safe = T.take.safe || { top: 0, bottom: 0, left: 0, right: 0 };
    const zone = { x0: rr.left + safe.left * rr.width, x1: rr.right - safe.right * rr.width, y0: rr.top + safe.top * rr.height, y1: rr.bottom - safe.bottom * rr.height };
    const vis = (t) => clips.forEach((c) => { const s = +c.dataset.start, d = +c.dataset.duration; c.style.visibility = t >= s && t < s + d ? 'visible' : 'hidden'; });
    const texts = Array.from(document.querySelectorAll('#stage *')).filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest('[data-probe-skip]'));
    const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 4; x = x.parentElement) p.unshift(x.id ? '#' + x.id : x.tagName.toLowerCase() + (x.classList[0] ? '.' + x.classList[0] : '')); return p.join(' > '); };
    const alpha = (e) => { let a = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; a *= +cs.opacity; } return a; };
    // share of the element's box left after every overflow-clipping ancestor (masked word reveals read as hidden)
    const clipped = (e, r) => {
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
        const cs = getComputedStyle(x); if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const q = x.getBoundingClientRect(); x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom);
      }
      return x1 <= x0 || y1 <= y0 ? 0 : ((x1 - x0) * (y1 - y0)) / (r.width * r.height);
    };
    const seen = new Map();
    for (let t = 0; t <= T.total + 1e-6; t += step) {
      vis(t); tl.seek(t, false);
      for (const e of texts) {
        // the text's own box (a centred paragraph's element box is wider than its words)
        const rg = document.createRange(); rg.selectNodeContents(e);
        const r = rg.getBoundingClientRect(), er = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
        if (r.right < rr.left || r.left > rr.right || r.bottom < rr.top || r.top > rr.bottom) continue;
        const a = alpha(e); if (a < 0.6) continue;
        if (clipped(e, r) < 0.5) continue;
        const fs = parseFloat(getComputedStyle(e).fontSize), k = e.offsetHeight ? er.height / e.offsetHeight : 1;
        const pct = (fs * k) / short * 100;
        const outside = r.left < zone.x0 - 1 || r.right > zone.x1 + 1 || r.top < zone.y0 - 1 || r.bottom > zone.y1 + 1;
        const prev = seen.get(e) || { sel: path(e), text: '', minPct: 1e9, first: t, last: t, visibleSec: 0, outsideSec: 0, deco: e.closest('[data-deco]') ? 1 : 0 };
        prev.text = e.textContent.trim().slice(0, 60); prev.minPct = Math.min(prev.minPct, pct); prev.last = t; prev.visibleSec += step; if (outside) prev.outsideSec += step;
        seen.set(e, prev);
      }
    }
    // resolve cue pan from the element it names, at the cue's time
    for (const c of T.cues) {
      if (c.x == null && c.el) { vis(c.t); tl.seek(c.t, false); const e = document.querySelector(c.el); if (e) { const r = e.getBoundingClientRect(); c.x = (r.left + r.width / 2 - rr.left) / rr.width; } }
      if (c.x != null && c.x > 1.5) c.x = c.x / T.W;
      if (c.x != null) c.x = Math.round(c.x * 1000) / 1000;
      if (c.s != null) c.s = Math.round(c.s * 1000) / 1000;
      delete c.el;
    }
    T.cues.sort((a, b) => a.t - b.t);
    const out = { format: T.fmt, lang: T.lang, duration: T.total, bpm: T.take.bpm, scenes: T.take.scenes, marks: T.marks, cues: T.cues, text: Array.from(seen.values()).map((v) => Object.assign(v, { minPct: Math.round(v.minPct * 100) / 100 })) };
    const s = document.createElement('script'); s.type = 'application/json'; s.id = 'take-probe'; s.textContent = JSON.stringify(out).replace(/</g, '\\u003c'); document.body.appendChild(s); // no "</script>" from page text inside
  }

  window.Take = { init };
})();
