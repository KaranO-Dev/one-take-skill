# Sound

The picture writes the sound. Each `T.cue(name, t, opts)` in the composition is one sound in the fx stem, at the exact time the motion happens. The probe reads all the cues from headless Chrome. `score.mjs` then builds the music around the scene grid and plays the cues on top.

## Cue categories

Use these names; aliases on the right map to them. Unknown names fall back to a soft tuned blip.

| Cue | What it sounds like | Use for | Aliases |
|---|---|---|---|
| `pop` | short tuned blip, walks the chord with `p` | words or items arriving one by one | word |
| `tick` | tiny high click | counters, reflow, fast series (min 30 ms apart) | count, reflow |
| `detent` | very short mechanical tick | scroll wheel, slider steps | scroll, hover |
| `click` | mouse click with a body | cursor presses, button taps | press, tap |
| `switch` | two-part toggle plus a faint tuned tail | labels swapping, toggles | toggle |
| `key` | keyboard key, random pitch | typed text (`T.type` does this) | type, typing |
| `page` | paper flick | cards, pages, sheets | card, flip |
| `swish` | short air sweep | panels entering (`T.enter`) | |
| `rise` | airy sweep plus a tuned shimmer | headlines rising (`T.rise`) | |
| `whoosh` | long two-way sweep plus sub | transitions, whips, big moves | swoosh, transition |
| `land` | low thump | things settling, counters landing | settle, thud |
| `impact` | sub boom, crack, chord | the biggest arrivals only | hit, drop, boom |
| `stab` | short chord on the current harmony | section openers, punctuation | sting |
| `motif` | FM bell walking `sound.motif` | a recurring idea: the same thing, back again | note |
| `chime` | high bell on a chord tone | success, completion | bell, ding |
| `glitch` | bitcrushed burst | errors, digital artefacts | |
| `riser` | noise sweep up into `t` (it starts `d` earlier) | builds the score doesn't add itself | build |
| `end` | boom, full chord, bell | the end card completing (`T.endCard` time) | logo |

Options:
- `s`: strength, 0–1. It scales level and some timbre.
- `x` or `el`: where on screen. `el` is a selector; the probe measures it at the cue's time and pans to it.
- `d`: duration, for sweeps.
- `p`: chord-tone index, for pops.

## Timing rules

- **Cue at the frame the motion reads.** For an ease-out arrival, that's the start, not the end. For a landing, cue `land` at about 90% of the tween.
- **Thin series.** The score drops repeats closer than a category's minimum gap. It's still better not to cue forty identical ticks: let `T.count` sample its own ease.
- **Leave air.** One or two `impact`s per film. Most cuts want a `swish` or nothing. The score already adds a riser and impact on every energy lift of 0.15 or more.
- **Downbeats are free emphasis.** A cue on a bar line lands with the kick. A cue a 16th before it feels like a pickup.

## The arrangement

From `take.json` scenes:
- The bed is a pad on a chord per bar, from `mood` and `key`. Its filter opens with each scene's energy and swells mid-scene.
- Bass, arp and drums enter by energy (thresholds are in `take-json.md`).
- The kick sidechains the bed and bass.
- A 16th snare roll leads into each lift.
- The end scene resolves home on an add9 chord, holds through the end card, and fades only in the last 5% of the film (at most 0.8 s).

Moods (each loops a four-chord progression, one chord per bar):

| mood | scale | progression |
|---|---|---|
| bright | major | I V vi IV |
| warm | major | I vi IV V |
| cool | minor | i VI III VII |
| tense | minor | i i VI V |
| dreamy | lydian | I II I II |
| drive | dorian | i IV i VII |

## Levels

- Stems are written as float WAV: `bed`, `band`, `drums`, `fx`.
- `mix.wav` is the sum through a −3 dBFS lookahead limiter.
- `master.wav` is two-pass EBU R128 loudnorm, linear, to `lufs` (default −14) with true peak −1.5 dBTP, 24-bit 48 kHz.
- Platforms normalise to about −14, so mastering louder only gets turned down. A podcast or website player is better at −16.
- Mix balance lives in `sound.gains`. When fx feel loud, lower `fx` or set `sfx: "subtle"` before thinning cues.

## Someone else's music

1. `node scripts/score.mjs --analyze song.mp3` returns `{ bpm, firstBeat, duration }`. `npx hyperframes beats` writes a beat list if you need every beat.
2. Set `bpm`, and trim or offset the track so `firstBeat` lands on 0 (`ffmpeg -ss`).
3. Lay the scenes on whole bars. Cuts land on the music because the grid is the music's.
4. `sound.mode: "track"` mixes their file with the fx stem and masters both together. Record the licence in `sound.licence`.

## Voiceover

Put it at `src/assets/audio/vo.wav` (copied into each build). The score ducks the music under it with an envelope follower (`duckDb`, default −9 dB), mixes the voice in, and masters it all. Keep the words inside the bars they belong to: a scene too short for its line gets a longer `bars`, not faster speech.
