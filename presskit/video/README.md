# Demo video

`demo.mp4` is live in the landing page hero (`index.html`'s `.lp-video-shell`,
autoplay/muted/loop). It's a genuine screen capture of the real app — not
a mockup — driven entirely through automation, with no narration or music.
`narration-script.md` in this folder is a script sized to the video's beats
if you want to hand this off to a voiceover/editing tool for a produced cut.

## What it is

24.6s, silent, 1600×1000, H.264 MP4, ~270 KB. The sequence: type a checklist
→ switch to Live and watch it render → a second device joins and adds a
line, with the change flashing in → the Share modal opens (editable link,
read-only link, short code) → a file uploads and lands in the Files panel
→ end card. See `narration-script.md` for the beat-by-beat timing.

## How it was made

`../../scripts/generate-demo-video.mjs` drives the app's *real* markup,
CSS, and transitions — the same technique as `scripts/build-mockups.mjs`
for the presskit screenshots — through a scripted sequence: real keystrokes
via `page.keyboard.type()`, and every panel/modal open via the exact class
toggle the real app's JS would use (`.side-panel.open`, `.modal-backdrop.visible`,
etc.), so the CSS transitions already defined in `styles/panels.css` and
`styles/modals.css` animate exactly as they would for a live user. No
Supabase calls are made — content is hard-coded, matching the presskit
screenshots' approach for the same reason (see `docs/marketing-site.md`).

**Why it isn't a continuous screen recording:** Playwright's built-in video
capture (`recordVideo`) renders blank frames in some headless/sandboxed
environments — a compositor/screencast limitation, confirmed separately
from regular screenshots (which are unaffected). The script works around
this by taking a real screenshot at every meaningful animation beat — every
keystroke, and dense sampling during each CSS transition — and assembling
the variable-duration frame sequence into an MP4 with ffmpeg's concat
demuxer. If you regenerate this in a normal desktop/CI environment where
`recordVideo` works, you could simplify the script to use it directly.

## Regenerating

```bash
npm run presskit:video
```

Requires `ffmpeg` on `PATH` (with `libx264`; check with `ffmpeg -encoders | grep 264`).
Edit the room name, checklist copy, or filename directly in
`generate-demo-video.mjs`'s scripted sequence, then update
`narration-script.md` to match if you change what's on screen.

## Upgrading to a produced/narrated cut

This capture is a solid placeholder, not a finished marketing asset. To
turn it into one:

1. Hand `demo.mp4` + `narration-script.md` to a video-editing tool — Descript
   is a good fit (AI editing built for screen recordings, can generate an
   AI voiceover directly from the script) — or record narration separately
   (e.g. ElevenLabs) and drop it into any editor.
2. Export the result back to `demo.mp4` in this folder (same filename, so
   nothing else needs to change) — or update the `<source>` path in
   `index.html` if you rename it.
3. Regenerate the poster frame from the new video if the opening frame
   changed:
   ```bash
   ffmpeg -y -i presskit/video/demo.mp4 -ss 00:00:07 -frames:v 1 -update 1 presskit/screenshot/demo-video-poster.png
   ```

## Format reference

| | |
|---|---|
| **Filename** | `demo.mp4` |
| **Format** | H.264 MP4, no audio track (muted autoplay loop) |
| **Length** | 20–45s is the sweet spot for an autoplay hero loop; this cut is 24.6s |
| **Resolution** | 1600×1000 (matches `.lp-video-shell`'s ~16:10 aspect ratio) |
| **Poster frame** | `presskit/screenshot/demo-video-poster.png`, extracted from the video itself |
