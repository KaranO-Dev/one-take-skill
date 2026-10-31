# QA

`qa.mjs` runs on every final file. Each check returns pass, warn or fail together with the value it measured. The run fails if any output has a fail. Everything not passed goes to the report's "Open items".

| Check | Measure | Pass | Why |
|---|---|---|---|
| size | ffprobe | equals the format | platforms crop or letterbox the wrong size |
| fps | ffprobe | equals `fps` | |
| duration | ffprobe vs the build | within 1 frame + 60 ms | a short file means the render stopped early |
| platform-cap | duration vs cap | ≤ cap | stories cut at 60 s, and the cut lands mid-word |
| codec | ffprobe | h264, yuv420p | plays everywhere (warn only) |
| loudness | ebur128, integrated | `lufs` −1.5 … +0.5 (default −16.5 … −13.5) | platforms normalise to about −14: quieter sounds weak, louder gets turned down |
| true-peak | ebur128 | ≤ −1 dBTP | AAC transcodes clip above that |
| loudness-range | ebur128 LRA | 2–14 LU (warn) | below 2 is a wall of sound; above 14 drops out on phone speakers |
| silence | silencedetect −50 dB | no gap ≥ 0.8 s | a dead gap reads as a broken file |
| black | blackdetect (99.5% of pixels under 6%), first 0.15 s ignored | nothing ≥ 0.4 s (shorter gaps warn) | empty frames between scenes |
| frozen | freezedetect | nothing ≥ 1.5 s before the end card | a stalled timeline, or a scene that forgot to move |
| end-card-hold | duration − `T.endCard` mark | ≥ 3 s | people need time to read the name and the URL |
| end-card-steady | SSIM and luma, mark vs last frame | SSIM > 0.6, luma kept | the hold isn't eaten by a fade to black |
| text-size | probe: rendered font size ÷ short side | ≥ 3.4% (warns below, fails below 2.6%) | 3.4% of 1080 ≈ 37 px ≈ 13 pt on a phone. A 27 px caption (2.5%) is too small to read |
| safe-zone | probe: text box vs platform bands | inside, or out for under 0.75 s (a whip passing through is fine) | story and reel UI covers the top and bottom |
| hyperframes-check | `hyperframes check --json`, at the pinned HyperFrames version | no errors | lint, layout overlaps, WCAG contrast |

Two more checks can fail: `audio` when sound was asked for and the file has no audio stream, and `end-card` when the composition never calls `T.endCard`.

Text marked `data-deco` (giant background numerals, texture text) and anything inside `[data-probe-skip]` is left out of text-size and safe-zone. Text on screen for less than 0.5 s is ignored too.

## Contact sheet

`<name>.sheet.jpg` holds these frames: each scene's midpoint, 0.1 s before and 0.25 s after every cut, the end-card mark, and the last frame. Look at every sheet. The checks can't see:

- **Composition.** Is the eye led to one thing per frame?
- **Cuts.** Does the frame after a cut read as a continuation or as a jump?
- **Crops.** Does anything important sit at the edge in one format but not another?
- **Repetition.** Do three scenes look the same?
- **The end card.** Is it the best-looking frame of the film? It's also the cover.

## Fix loop

There are at most two passes. In each pass:

1. Fix the cause in `src/` or `take.json`, never the output.
2. Run `run.mjs --draft --only <name>` again.

| Common failure | Fix |
|---|---|
| black | a scene ends before the next one's reveal covers it. Clear the words later, start the reveal earlier, or give the next scene `in.d` |
| frozen | add `T.drift` to the scene's camera, or secondary motion |
| end-card-hold | the end scene needs more bars, or `T.endCard` sooner |
| text-size | raise the class to `--t-min` or more, or mark it `data-deco` if it isn't meant to be read |
| loudness | it's normally fine after loudnorm. A failure means a broken master or the wrong audio in the encode. Check `score/score.json` |
| safe-zone | move the text inside `.safe` for that shape (`.f-tall …`) |

If it still fails after two passes, deliver the file anyway and write it up in Open items: what, why, and what would fix it.
