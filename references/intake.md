# The intake

The whole interview happens in one message. Detection fills in most of it first, so the user only corrects what's wrong. Afterwards, nothing more is asked.

## 1. The sheet

Fill in each line from `detect.mjs` or the default shown, and render it as a compact list. Mark detected values with `(found)`, so the user can see what was inferred and what was defaulted.

```
Subject        Tally: "Count anything from your lock screen, offline" (found: README)
One message    what the viewer should remember. Default: the README tagline in eight words
Film type      launch promo | behind the scenes | feature reveal | recap | event | explainer. Default: launch promo
Sources        ~/code/tally (found: 214 commits, 3 Mar to 2 Apr). Other repos or sites?
Facts allowed  commits, days, lines of code, languages, busiest day. Say no to any
Scenes         "you decide" (default 5–7 for 30 s), or a count, or must-have beats in order
References     none. Links, videos, images or Figma, plus what to take from each (pace, type, colour, a move)
Formats        see question 1
Resolution     1080 on the short side, 30 fps. Say 4K or 60 fps if wanted
Length         see question 2
Languages      en. Others are rendered as separate files
Brand          logo assets/brand/mark.svg, fonts Inter Display + Inter, colours #101014 #f5f3ee #ff6b3d (found)
Sound          see question 3. SFX intensity: normal (subtle / normal / bold). Loudness: -14 LUFS
Voice          see question 4
Extras         cover still from the end card (default yes). GIF preview (default no)
Output         videos/tally-launch/ → renders/tally-launch-<format>-<lang>.mp4
```

Language codes, the slug and the output name become file names, so they may use only letters, digits, `.`, `_` and `-` (see "Names" in `take-json.md`).

## 2. The four questions (one AskUserQuestion call)

1. **Formats** (multiSelect)
   - 4:5 feed (1080×1350) *(Recommended for Instagram and LinkedIn)*
   - 9:16 story / reels / TikTok / Shorts (1080×1920)
   - 16:9 YouTube / site / X (1920×1080)
   - 1:1 square (1080×1080)
2. **Length**
   - 30 s *(Recommended)*
   - 15 s
   - 45–60 s
   - Longest each platform allows

   If a platform cap is shorter than the film, optional scenes are cut for that file. See `formats.md`.
3. **Sound**
   - Original score + SFX synced to the motion *(Recommended: offline, nothing to license)*
   - My own track (give the path)
   - Library or AI music via media-use (needs the heygen CLI or a music API key)
   - No sound
4. **Voice and captions**
   - No voice: on-screen type carries it *(Recommended for social, where most viewing is muted)*
   - Voiceover (local TTS) + burned-in captions
   - My recording + burned-in captions
   - Captions as an .srt file only

Question text for the last one ends with: "Anything else on the sheet to change? Add it as a note on any answer, or pick Other."

Only list options that work on this machine. Hide "Library or AI music" when detection found no heygen CLI and no music API key, and say why in the sheet.

## 3. Defaults when an answer is missing

| Field | Default |
|---|---|
| formats | 4:5 for `instagram-feed` |
| length | 30 s, rounded to whole bars |
| fps | 30 (60 only if asked: twice the render time) |
| sound | `score`, mood picked from the brand (dark and technical → `cool`, warm and consumer → `warm`, playful → `bright`) |
| sfx | `normal` |
| lufs | −14 (social); −16 if the user names a podcast or site player |
| voice | none; captions none |
| scenes | 5–7, with the end card ≥ 3 s |
| output | `videos/<slug>/` in the current directory |

## 4. Platform caps

These are defaults and change often, so a user's number always wins.

| Platform | Shape | Cap | UI bands (top / bottom / sides) |
|---|---|---|---|
| Instagram feed | 4:5 | 60 s | thin |
| Instagram story | 9:16 | 60 s per card | 14% / 20% / 6% |
| Instagram reels | 9:16 | 180 s | 12% / 24% / 6–14% |
| TikTok | 9:16 | 10 min | 10% / 22% / right 16% |
| YouTube Shorts | 9:16 | 180 s | 10% / 20% / right 14% |
| YouTube / website | 16:9 | none | 5% action-safe |
| LinkedIn | 4:5 or 1:1 | 10 min | 5% |
| X | 16:9 | 140 s | 5% |

## 5. What gets written

- `take.json`: everything above, machine-readable (`take-json.md`).
- `BRIEF.md`: HyperFrames-compatible, so `/hyperframes` resumes instead of re-asking:

```markdown
---
workflow: general-video
flow: automation
storyboard: no
message: <one message>
destination: <first platform>
aspect: <first format's WxH>
language: <first language>
length: <seconds>
narration: no | yes
---
## Intent
<film type, audience, what to take from each reference>
## Customizations
- formats: 4x5 instagram-feed, 9x16 instagram-story
- sound: score (cool, D, 120 bpm), sfx normal, -14 LUFS
- captions: none
## Notes
Run by one-take: take.json is the source of truth; renders are pre-authorised; publishing is not.
```
