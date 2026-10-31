---
name: one-take
description: "Make a finished promo, launch, recap or behind-the-scenes video in one go: ask every question once up front (scenes, references, formats and aspect ratios, length and platform caps, source repos and sites, languages, music, voice and captions, brand), then storyboard, build, score, render every format and QA each file with no further questions. Original synthesised score with stems and sound effects keyed to the animation, facts pulled from git, one source re-laid out per aspect ratio, and a QA pass on loudness, black/frozen/silent frames, end-card hold, text size on a phone and platform safe zones. Use when someone wants a complete multi-format video delivered end to end rather than a co-creation session. Built on HyperFrames."
---

# one-take

Ask everything once. Then make the whole film, every format, checked, with no more questions.

This skill orchestrates; HyperFrames does the rendering. It needs the HyperFrames skills (`hyperframes`, `hyperframes-core`, `hyperframes-animation`) and is better with `hyperframes-registry`, `hyperframes-keyframes`, `media-use`, `figma` and `humanizer`. If `hyperframes-core` is missing, stop and give the install line: `npx skills add heygen-com/hyperframes`.

`SKILL_DIR` below means this skill's folder. Scripts are plain Node (≥ 22) plus ffmpeg, with no installs.

## The contract

1. **One intake round.** Detect first, then ask once (Phase 1). After the answers, ask nothing more. The only exception is a hard blocker you cannot default around, such as a file that doesn't exist or a site that refuses to load. Then ask that one exact question and continue.
2. **The intake answer authorises the renders.** It does not authorise publishing, uploading, posting, pushing or downloading anything the user didn't name. Ask for those separately, after the report.
3. **Facts are computed, never typed.** Every number on screen comes from `facts.json` or from a source the user gave. Never invent stats, quotes, logos or testimonials.
4. **The picture writes the sound.** Every motion that should be heard calls `T.cue()` at the moment it happens. The score is built from those cues, so sound and picture can't drift.
5. **Done means QA-passed.** A file is delivered when `qa.mjs` passes it, or when a failure is written up in the report with the reason it couldn't be fixed in two passes.

## Phase 0: detect (silent, before asking)

```bash
node SKILL_DIR/scripts/detect.mjs <subject paths…> --out /tmp/one-take-detect.json
```

- Run it on the current repo and any path or site the user mentioned.
- It returns, per source: README title and tagline, git span and commit count, logos, font files and families, colour tokens. It also returns the toolchain: node, ffmpeg, cached `hyperframes` version, Chrome, heygen CLI, and whether music API keys are set.
- If `take.json` already exists in the target project, this is a resume. Read it, skip the intake, and continue from the first phase whose output is missing.

## Phase 1: the intake (one message, one round)

Read `references/intake.md`. In one message:

1. Show the **intake sheet**: every field pre-filled from detection or a recommended default, each on one line. The user changes only what's wrong.
2. Call **AskUserQuestion once** with the four decisions that most change the work: formats (multi-select), length, sound, and voice/captions. The question text tells them to add any sheet changes as a note on any answer.

   If AskUserQuestion isn't available, put the same four as numbered choices at the end of the sheet and ask for one reply.

Then, without asking again:
- Write `take.json` (schema: `references/take-json.md`). Language codes, format ids, the slug and `output.name` must match `[a-z0-9][a-z0-9._-]{0,63}` (any case, no `..`), or the run stops. Leave `hyperframes` out unless the user asks: the default version is pinned in `scripts/lib/platforms.mjs` (`HF_VERSION`, 0.8.223).
- Write a HyperFrames `BRIEF.md` with `workflow: general-video`, `flow: automation`, `storyboard: no`. This means a later `/hyperframes` call resumes this project instead of re-interviewing.
- Record the answers in BRIEF.md's body: formats, sound, captions, platform caps.

## Phase 2: sources

- **Git facts.** Run `node SKILL_DIR/scripts/facts.mjs --repo <path> [--repo …] [--since …] --out <project>/facts.json`. It collects commits, span, active days, longest streak, busiest day, lines by language, lines added and removed, and top commit words, plus the first and last commit subject. Author names and emails are never recorded. Use only the facts the user allowed.
- **Sites.** For a URL to show, run `npx hyperframes capture <url> -o <project>/src/assets/cap`. Stop on `ok:false` or `BLOCKED.md`: that's a blocker.
- **References.** For each one, write one line in STORYBOARD.md on what you're taking from it: pacing, type, colour, a transition. For a Figma link, run `/figma` first.
- **Brand.** Copy the logo SVG and font files into `src/assets/brand` and `src/assets/fonts`, declare them in `take.json` `fonts`, and lift colour tokens into the template's `:root`.

## Phase 3: direction and storyboard

Read `references/direction.md` before writing anything visual. Write `STORYBOARD.md`:

- **Direction**, one paragraph: the one idea, the signature move, the type pairing, the palette, the reference each choice came from.
- **Tempo first.** Pick bpm so the target length is a whole number of bars (4/4). Then give every scene a length in bars, an `energy` (0–1, which drives the score's arrangement), and how it enters (`in`).
- **Scene table:** id, bars, energy, what's on screen, motion, cues, copy.
  - The last scene is the end card, `end: true`, with enough bars to hold it complete for **3 s or more**.
  - Mark scenes that can go in a cutdown `optional` (1–9, higher goes first).
- **Copy** goes in `copy/<lang>.json`, one key per line of text. Run it through `/humanizer` if available. Keep headlines short enough to read twice in the time they're on screen.

## Phase 4: build

- Copy `SKILL_DIR/templates/index.html` to `<project>/src/index.html` and rewrite its scenes from the storyboard.
- Read `references/kit.md` (the `T.*` API) and `hyperframes-core`'s non-negotiable rules. For motion, read `hyperframes-animation` rules and blueprints. Before hand-building any named effect, search `hyperframes-registry`.

Rules that keep every format and the QA honest:

- Scenes are top-level `<section class="clip scene" data-scene="id">`, never nested, never with inline `style`.
- Size in design px through `--u` (1% of the short side). Readable text is never below `--t-min` (3.4u ≈ 37 px at 1080).
- Keep readable text inside `.safe`, the platform UI bands for that format.
- Re-lay out per format with `.f-tall`, `.f-wide`, `.f-square`, `.f-portrait` rules, not by scaling one layout.
- Clear a scene's words before the next scene's transition covers them (`T.sink`/`T.leave` near `s.end`). Text under a reveal fails the layout check.
- Every scene moves: `T.drift` the camera across it. Nothing stands still before the end card.
- `T.endCard(t)` at the moment the end card is complete. The last frame must still show it: no fade to black over the hold.
- Cue everything that should be heard (`references/sound.md` lists the categories). Most kit helpers cue by default; pass `cue: false` to keep a moment silent.
- Numbers come from `T.facts` or the copy. `T.count` needs a finite number and throws without one, so a missing fact stops the probe instead of putting an invented number on screen.
- End the script with `window.__timelines["main"] = T.done();`. `T.done()` registers the timeline once, after every tween is added, and the template repeats it in that line. Build all tweens first, not inside a font-ready or other async callback: HyperFrames lint rejects an early registration.

## Phase 5: draft pass

```bash
node SKILL_DIR/scripts/run.mjs <project> --draft
```

This runs, per format × language: build → probe (cues, text sizes, end-card mark from headless Chrome) → score → `hyperframes check` → draft render → encode → QA → `REPORT.md`.

HyperFrames runs at the version pinned as `HF_VERSION` in `scripts/lib/platforms.mjs` (0.8.223), or at `hyperframes` from `take.json`. The first run fetches it with `npx`, and the build fetches GSAP 3.14.2 once from jsDelivr into `~/.cache/one-take/`. The GSAP file is checked against a pinned sha256 after download and each time it is read from the cache. A file that doesn't match is never used: a bad download isn't cached, and a bad cached file is deleted and the build stops. Run it again to fetch a fresh copy.

Then:
- Open every `*.sheet.jpg` contact sheet and look at it.
- Read `REPORT.md`.
- Fix failures and anything that looks wrong: overlaps, crops, dead frames, text too small, a cut that doesn't land.

There are at most **two** fix passes. Each one reruns `run.mjs --draft`; use `--only <format>-<lang>` to rerun just what changed.

## Phase 6: final

```bash
node SKILL_DIR/scripts/run.mjs <project>
```

This is the full quality render of every output. Deliverables land in `renders/` (or `output.dir`). Each output gets:
- `<name>.mp4`: x264 CRF 12, AAC 320k, faststart
- `.cover.jpg`: the end card
- `.sheet.jpg`
- `.qa.json`

Score stems and `marks.json` are kept in `out/<format>-<lang>/score/`.

## Phase 7: report

Reply with:
- the outputs table from `REPORT.md` (file, size, length, verdict)
- the contact sheet of the main format
- one line on the sound
- open items, if any

Offer the next steps without doing them: post copy, more languages, a cutdown, publishing. Nothing gets posted or pushed unless the user asks.

## Sound modes

| `sound.mode` | What happens |
|---|---|
| `score` (default) | `score.mjs` synthesises bed, band and drums from the scene energies on the bar grid: chord plan from `mood` and `key`, sidechained to the kick, risers into every lift, an impact on each arrival. The fx stem is built from the cues, tuned to the chord under each one and panned from where it happens on screen. Mixed, limited, then two-pass loudnorm to `lufs` (default −14) with true peak −1.5. Original, so nothing to license. |
| `track` | The user's file. Get bpm and first beat with `score.mjs --analyze <file>` (or `npx hyperframes beats`), set `bpm` to it and lay the scenes on its bars. The fx stem plays over it. |
| `library` | `/media-use` `resolve --type bgm` (needs the heygen CLI) or its generators. The result is used as `track`, and its licence is recorded in `sound.licence`. |
| `none` | No audio element at all. |

For a voiceover, put it at `src/assets/audio/vo.wav`, from Kokoro via `npx hyperframes tts` or the user's recording. The score carves the music under it (`duckDb`, default −9). For captions, time them from `npx hyperframes transcribe vo.wav --model <model>`. Burned captions are scene text placed inside `.safe` at `--t-cap` or larger. For sidecar captions, write `<name>.srt` from the same transcript next to each output.

## Files

- `scripts/detect.mjs`, `facts.mjs`: what's there, and the numbers
- `scripts/build.mjs`: one source → `out/<format>-<lang>/` HyperFrames projects. Fills sizes, safe bands and scene timing, inlines `TAKE` (copy, facts, scenes), vendors the kit and GSAP 3.14.2 (sha256-checked), drops scenes for cutdowns
- `scripts/probe.mjs`: headless Chrome pass that reads cues, text sizes and positions over time, and marks
- `scripts/score.mjs`: synth score, stems, mix, master, `marks.json`; `--analyze` for a track's tempo
- `scripts/encode.mjs`, `qa.mjs`, `report.mjs`, `run.mjs`: delivery, checks, report, and the whole run
- `scripts/selftest.mjs`: checks the toolchain, then proves QA fails a file built to fail
- `scripts/lib/`: shared helpers (git, platforms with `HF_VERSION` and the name check, WAV, DSP)
- `kit/take.js`: the motion kit (`references/kit.md`)
- `templates/index.html`: the starting stage
- `references/`: `intake.md`, `take-json.md`, `direction.md`, `sound.md`, `formats.md`, `qa.md`, `kit.md`
