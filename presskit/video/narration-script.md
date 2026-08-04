# Demo video — narration script

Written for `demo.mp4` (24.6s, silent, muted hero loop) — sized so each line
lands roughly on the matching visual beat if you drop it into Descript,
ElevenLabs, or any editor and trim to fit. Timestamps below are the actual
beat-boundary output of `../../scripts/generate-demo-video.mjs` (each `logBeat()`
call there prints the cumulative manifest duration at the moment that beat
starts) — copied verbatim from a real run, not hand-estimated.

| Time | Visual beat | Line |
|---|---|---|
| 0:00 | Empty note, cursor blinking | "This is SyncPad." |
| 0:01 | Typing the checklist | "Open a room, and start writing — nothing to set up." |
| 0:05 | Switches to Live, rendered checklist | "Live and Split modes render your Markdown as you type." |
| 0:06 | Second device joins, typing indicator | "Share the link, and anyone you send it to is editing with you instantly." |
| 0:08 | Remote line arrives, flashes in | "Every change lands in real time — no refresh, no save button." |
| 0:11 | Share modal opens | "Need eyes on it without edit access? Send a read-only link instead." |
| 0:15 | Files panel, upload, file lands | "Drop in a file, and it's ready to hand off in seconds." |
| 0:21 | End card | "SyncPad. Real-time sync. No account needed." |

## Tone notes for a voiceover pass

- Confident and plain — this is a utility, not a lifestyle pitch. Avoid
  hype words ("revolutionary," "game-changing").
- Keep pacing tight: the video is intentionally short. Don't pad lines to
  fill time; let a beat play silently if the line runs short.
- The last line ("SyncPad. Real-time sync. No account needed.") doubles as
  the tagline already used in the video's own end card and the marketing
  page's chip row — keep it verbatim for consistency if you re-record it.

## If you re-record over a re-generated capture

`scripts/generate-demo-video.mjs`'s timeline is hard-coded (see the `hold()`/
`sampleTransition()` calls) — if you change the room name, checklist items,
timing, or file name in the script, re-run it (`npm run presskit:video` or
`node scripts/generate-demo-video.mjs`) and copy the `[beat] Xs — ...` lines
it prints to stdout straight into this table's Time column. Don't hand-guess
the numbers — they shift by a beat or two any time a `hold()`/
`sampleTransition()` duration above them changes.
