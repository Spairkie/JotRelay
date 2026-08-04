# Demo video

This folder is a placeholder for SyncPad's product demo video. The landing
page hero (`index.html`, `.lp-video-shell`) already has a video slot wired
up and waiting for a real file — it currently shows a poster image and a
"Demo video coming soon" badge instead of playing anything.

## Expected file

| | |
|---|---|
| **Filename** | `demo.mp4` |
| **Format** | H.264 MP4 (broadest browser support without extra `<source>` variants) |
| **Length** | 20–45s works best for an autoplay hero loop — long enough to show Create → Sync → Share, short enough to loop without feeling repetitive |
| **Audio** | None needed — the hero video plays `muted` (a browser requirement for autoplay anyway) |
| **Resolution** | 1600×1000 or similar (matches the `.lp-video-shell` aspect ratio, ~16:10) |
| **Poster frame** | `presskit/screenshot/desktop-editor.png` is used as the poster today — replace it with a still from the real video once you have one, or leave it as a clean fallback frame |

## Suggested shot list

1. Landing page → click **Create a Room**
2. Type a few lines in a fresh room
3. Cut to a second device/window showing the same room updating live
4. Open the Share modal, show the read-only link/QR
5. Drag a file into the Files panel

## Wiring it up

Once `demo.mp4` exists, add it to the empty `<video>` element in
`index.html`'s hero section (search for `lp-demo-video`) and add
`autoplay` back:

```html
<video class="lp-demo-video" autoplay muted loop playsinline
       poster="/SyncPad/presskit/screenshot/desktop-editor.png">
  <source src="/SyncPad/presskit/video/demo.mp4" type="video/mp4">
</video>
```

The surrounding comment in `index.html` has the same snippet inline —
this file is the canonical reference if that comment ever drifts.
