# take.json

One file holds the whole film's spec. `build.mjs`, `score.mjs`, `qa.mjs`, `report.mjs` and `run.mjs` all read it.

```jsonc
{
  "title": "Tally",                   // used in the report and the meta
  "slug": "tally-launch",             // file names
  "hyperframes": "0.8.223",           // optional. Default: HF_VERSION in scripts/lib/platforms.mjs (now 0.8.223)
  "fps": 30,
  "quality": "high",                  // draft | standard | high (run.mjs --draft overrides)
  "seed": 7,                          // every random choice in kit and score derives from it

  "bpm": 120, "beatsPerBar": 4,       // pick so the length is whole bars

  "formats": [                        // one output per format × language
    { "id": "4x5", "platform": "instagram-feed" },
    { "id": "9x16", "platform": "instagram-story", "maxSec": 60 },
    { "id": "16x9", "platform": "youtube", "scale": 2 }   // scale 2 = 4K-class pixels, same layout
  ],
  "languages": ["en", "it"],          // copy/<lang>.json each

  "scenes": [
    { "id": "hook",  "bars": 2, "energy": 0.35 },
    { "id": "proof", "bars": 3, "energy": 0.7, "in": { "type": "iris", "d": 1.0 } },
    { "id": "how",   "bars": 4, "energy": 0.8, "optional": 3 },      // dropped first when a cap bites
    { "id": "wide",  "bars": 2, "energy": 0.6, "only": ["16x9"] },   // or "skip": ["9x16"]
    { "id": "end",   "bars": 3, "energy": 0.2, "end": true, "in": { "type": "wipe", "d": 0.7 } }
  ],

  "fonts": [                          // files under src/assets/
    { "family": "Bricolage Grotesque", "file": "fonts/bricolage-grotesque.ttf", "weight": "200 800" }
  ],
  "brand": { "logo": "brand/mark.svg" },

  "sound": {
    "mode": "score",                  // score | track | library | none
    "mood": "cool",                   // bright | warm | cool | tense | dreamy | drive
    "key": "D",                       // C … B, sharps or flats
    "scale": null,                    // override the mood's scale: major | minor | dorian | lydian | mixolydian
    "sfx": "normal",                  // off | subtle | normal | bold
    "motif": [4, 2, 0, 4, 5, 4],      // scale degrees the "motif" cue walks through
    "lufs": -14, "tp": -1.5,
    "gains": { "bed": 0.62, "band": 0.5, "drums": 0.62, "fx": 0.85, "verb": 0.38 },
    "track": "music/song.wav",        // track/library: relative to take.json
    "licence": "…",                   // track/library: recorded in the report
    "duckDb": -9                      // music under a voiceover (src/assets/audio/vo.wav)
  },

  "voice": { "mode": "none", "captions": "none" },   // tts | file ; burn | srt | none
  "qa": { "endHoldSec": 3, "minTextPct": 3.4, "hardMinTextPct": 2.6, "lufs": [-16.5, -13.5] },
  "extras": { "cover": true, "gif": false },
  "output": { "dir": "renders", "name": "{slug}-{format}-{lang}" },
  "copy": { "en": { "hookHead": "…" } }               // or copy/<lang>.json files (they win)
}
```

## The HyperFrames version

Every run uses one HyperFrames version for `check`, `render` and the generated `package.json`. The default is pinned as `HF_VERSION` in `scripts/lib/platforms.mjs`, and it is 0.8.223. That is the version the kit was linted against. Set `hyperframes` in take.json to use another. The lint rules change between versions, so run a draft after changing it.

## Names

Some values become folder names, file names or part of the CLI command: each entry in `languages`, each format's `id`, `slug`, `hyperframes`, and the finished `output.name` (after `{slug}`, `{format}`, `{lang}` and `{platform}` are filled in). Each must match `[a-z0-9][a-z0-9._-]{0,63}`, in upper or lower case, and must not contain `..`. That is 1 to 64 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Slashes, spaces and shell characters are refused. A bad value stops the run with an error that names the field, before anything is rendered.

## How a scene's time is computed

- `sec` = `bars × 60 / bpm × beatsPerBar`. A scene may give `sec` directly, but then it falls off the grid. Avoid that unless the user's track needs it.
- Scenes run back to back. When a scene has `in.d`, the scene before it stays on screen that much longer, so the transition has something to cover.
- `energy` drives the score:
  - below 0.3: bed only
  - 0.3 and up: hats
  - 0.35 and up: bass
  - 0.45 and up: kick
  - 0.55 and up: arp
  - 0.6 and up: snare
  - 0.7 and up: four on the floor
  - Any rise of 0.15 or more adds a riser into the next scene and an impact on it.
- `end: true` drops the drums, bass and arp, and resolves the harmony home.
- Cutdowns: while a format's total runs over its `maxSec` (from the platform or set explicitly), the scene with the highest `optional` number is dropped. `optional: true` counts as 5.
