# Demo video — narration script

Written for `demo.mp4` (24.6s, silent, muted hero loop) — sized so each line
lands roughly on the matching visual beat if you drop it into Descript,
ElevenLabs, or any editor and trim to fit. Timestamps are approximate; the
underlying capture is deterministic (see `../../scripts/generate-demo-video.mjs`)
but hand-editing will shift beats slightly.

| Time | Visual beat | Line |
|---|---|---|
| 0:00 | Empty note, cursor blinking | "This is SyncPad." |
| 0:02 | Typing the checklist | "Open a room, and start writing — nothing to set up." |
| 0:07 | Switches to Live, rendered checklist | "Live and Split modes render your Markdown as you type." |
| 0:09 | Second device joins, typing indicator | "Share the link, and anyone you send it to is editing with you instantly." |
| 0:13 | Remote line arrives, flashes in | "Every change lands in real time — no refresh, no save button." |
| 0:16 | Share modal opens | "Need eyes on it without edit access? Send a read-only link instead." |
| 0:20 | Files panel, upload, file lands | "Drop in a file, and it's ready to hand off in seconds." |
| 0:23 | End card | "SyncPad. Real-time sync. No account needed." |

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
or file name in the script, update this table's line 2 and line 7
accordingly so the narration still matches what's on screen.
