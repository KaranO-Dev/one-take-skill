# Direction: making it look like this film and no other

Templates look templated because every decision was left at its default. Make the decisions on purpose, write them down in STORYBOARD.md, and tie each one to the subject or a reference.

## Decide these five, in this order

1. **The one idea.** One sentence the film proves. Every scene either proves it or gets cut.
   - Bad: "Tally is a powerful productivity tool."
   - Good: "Anything you count is one tap from the lock screen."
2. **The signature move.** One visual device that belongs to this subject and comes back three times, getting bigger. It should be taken from the product itself, not from a motion library. Examples:
   - a reveal through the logo's own shape (`T.iris` with `mask`)
   - the product's real UI being taken apart in 3D
   - a counter that becomes the next headline
   - a cut that only happens on the downbeat
3. **Type.** Two families at most, from the brand. One display face with real contrast in weight or width, and one text face.
   - Headlines are big enough to read at a glance: about 8u and up.
   - Sub-lines are 4.6u and up. Nothing readable is below 3.4u.
   - Mixed case reads faster than all caps. Keep caps for short kickers.
4. **Colour.** Take the brand's tokens. Use one accent and use it sparingly: on the word that matters, on the cue that matters. If the brand is dark, add one light scene, or the reverse. A whole film in one value has no rhythm.
5. **Pace.** Choose the tempo for the subject, not the platform.
   - 96–110 bpm for considered, careful work.
   - 118–128 for product energy.
   - 132+ only if the subject is loud.
   - Cut on bars. Move on beats. Hit on downbeats.

## Banned defaults (rewrite if you catch one)

- A centred title that fades in, holds and fades out. Words should arrive (`T.rise`, `T.type`, `T.swap`) and leave for a reason.
- A stock gradient background, a floating blob, or a glassmorphism card with nothing in it.
- Every scene entering the same way. Vary it: `iris`, `wipe`, `whip`, match cut, or a shared object carried across the cut.
- A static scene. `T.drift` every camera and keep secondary motion alive (a cursor, a counter, a ticker).
- Emoji, "Introducing…", "Revolutionary", "Seamless", "Unlock", "Elevate", or any line that would fit any product.
- A logo slammed in on the last half second. Build the end card for **3 s or more of hold**, complete and readable, with the camera still breathing.
- Screenshots pasted flat. Frame them: a device or window, depth (`perspective` + `rotationX`), a cursor that actually does the thing, and crops that show one detail at a time.
- Sound as wallpaper. If something moves on the beat and nothing is heard, either cue it or make it move off the beat.

## Moves worth stealing (generalised from shipped films)

- **Handover.** The old headline sinks word by word while the new one rises in the same place. Use `T.handover(['#a1','#a2'], ['#b1','#b2'], t)`.
- **Match cut.** The next scene opens on the frame where it looks like the last one: the shared object in the same place, the camera at the old scale, settling back (`T.matchCut`).
- **Reveal through the mark.** The scene opens through the brand's shape, with a thin rim of colour around the hole (`T.iris` with `mask: 'url(assets/brand/mark.svg)'`).
- **Data as motion.** Counters tick with the sound (`T.count` cues a tick per visible change, then a `land`). A heat map of commits per day is drawn in time order. The busiest day gets the accent.
- **The hand on the mouse.** A cursor with curved paths, a little tremor, a press and a ring (`T.cursor`). It makes UI footage read as someone using it.
- **Exploded layers.** The real page split into its layers, rotated back in 3D, then reassembled. Note: CSS 3D makes HyperFrames fall back to slower screenshot capture, so budget for it.
- **Typed code.** One character at a time, with a key cue each and human timing (`T.type`).
- **Hits.** On the scene's biggest moment, combine a chromatic split (`T.hit`), a camera shake (`T.shake`) and an impact cue. Once or twice per film, not on every scene.
- **Texture.** Seeded grain (`T.grain`, opacity 0.04–0.08), a vignette, and a light leak across a warm moment (`T.leak`). These take the edge off flat vector frames.

## Format by format

- **4:5** is the default social canvas. Stack vertically and keep the headline in the upper half.
- **9:16:** don't just put 4:5 in a taller box. Use the extra height for a second element (the UI under the headline), push type bigger (`.f-tall`), and keep everything inside the platform's UI bands.
- **16:9:** split the frame. Headline left, evidence right. Give type a wider measure and use a larger number for `count`.
- **1:1:** tighter crops, fewer words per scene.

## Write it down

The **Direction** paragraph in STORYBOARD.md names the idea, the signature move and where it appears (scene ids), the type pair, the accent, the bpm, and the reference behind each choice. If a choice has no reason, it's a default. Change it.
