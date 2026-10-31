# Changelog

## 1.0.0 (2026-10-31)

The first release.

- One intake round, filled in from the repo and site, then storyboard, build, score, render, QA and a report with no more questions.
- Facts for the film (commits, span, active days, lines by language) computed from git.
- An original score on the film's bar grid, with sound effects keyed to the motion, mastered to −14 LUFS.
- One source re-laid out for 4:5, 9:16, 16:9 and 1:1, with each platform's UI bands as safe zones.
- QA on every file: size, frame rate, duration, loudness and true peak, black, frozen and silent stretches, end-card hold, text size and safe zones, plus HyperFrames lint and contrast.
- Inputs are treated as untrusted: copy and git text go into the page escaped, names that become paths are checked, GSAP and HyperFrames run at pinned versions (GSAP checked against its SHA-256), and the headless Chrome probe has a time limit. See SECURITY.md.
- `scripts/selftest.mjs` checks the toolchain and builds a file made to fail, which QA has to catch. CI runs it on every push to `main` and on pull requests.
