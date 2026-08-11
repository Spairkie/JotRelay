// JotRelay – scroll-rail.js
// A single vertical strip that merges a draggable scroll-position thumb with
// heading tick marks — replacing the native scrollbar's *visual* chrome
// (native scrolling itself — wheel, touch, keyboard, drag-select — is left
// completely alone; only its rendered bar is hidden via CSS, see
// styles/editor.css) on both editor surfaces: the plain Write-mode textarea
// and the CM6 Live surface.
//
// Each surface owns its own independent ScrollRail instance rather than one
// shared singleton — Split mode shows the textarea and the Live surface at
// once, side by side, so a single shared instance can't work. See
// wireScrollRail() in app/editor-behavior.js (textarea) and this module's
// mount() call inside live-editor.js (CM6) for where each is created.
//
// `adapter` abstracts over the two surfaces:
//   - getMetrics(): { scrollTop, scrollHeight, clientHeight }
//   - setScrollTop(px, { smooth }): scroll the underlying surface to an exact
//     pixel offset. `smooth` is only ever true for a discrete jump (a tick
//     click or a bare-track click) — a thumb *drag* always calls this with
//     smooth omitted/false, since an in-flight drag is already a continuous,
//     user-driven motion that a smooth-scroll easing would only add lag to.
//   - jumpToHeading(heading): scroll (+select/focus, surface-appropriate,
//     smoothly) so `heading` is in view. CM6 needs its own estimate-then-
//     correct dance for positions outside the currently-measured viewport
//     (see live-editor.js's _scrollPosIntoView); the textarea can just
//     scrollTo() directly since its mirror-measured `top` is already exact.
//
// Headings are pushed in externally via updateHeadings() rather than pulled
// through the adapter — each surface collects them on its own natural
// trigger (CM6: ViewPlugin update() on doc/viewport/geometry change; textarea:
// debounced 'input' listener) and the shapes of "how do I know when to
// recollect" differ enough between the two that folding it into a shared
// pull-based adapter method would just relocate the surface-specific code
// here without simplifying anything.
// How far (in CSS px, vertically) a tick reaches full prominence from the
// pointer — wide enough that adjacent headings in a dense document don't
// all sit at 0 simultaneously, narrow enough that "close to the mouse"
// still reads as a handful of ticks, not the whole rail.
const _TICK_PROXIMITY_RADIUS_PX = 56;

export class ScrollRail {
  constructor(mountEl, adapter) {
    this.adapter = adapter;
    this.dom = document.createElement('div');
    this.dom.className = 'scroll-rail';
    this.thumb = document.createElement('div');
    this.thumb.className = 'scroll-rail-thumb';
    this.dom.appendChild(this.thumb);
    this.ticksLayer = document.createElement('div');
    this.ticksLayer.className = 'scroll-rail-ticks';
    this.dom.appendChild(this.ticksLayer);
    mountEl.appendChild(this.dom);

    this._headings = [];
    this._dragging = false;
    this._lastMetrics = null;

    this._onTrackPointerDown = this._onTrackPointerDown.bind(this);
    this._onThumbPointerDown = this._onThumbPointerDown.bind(this);
    this._onThumbPointerMove = this._onThumbPointerMove.bind(this);
    this._onThumbPointerUp = this._onThumbPointerUp.bind(this);
    this._onTicksPointerMove = this._onTicksPointerMove.bind(this);
    this._onTicksPointerLeave = this._onTicksPointerLeave.bind(this);

    // The rail's own box often isn't laid out yet at construction time (a
    // freshly-mounted CM6 view, or a textarea whose grid row hasn't settled
    // its height) — a synchronous updateMetrics() call right here would read
    // a 0px clientHeight and leave the thumb with no height/position until
    // some *other* trigger (a scroll, a doc change) happened to call it
    // again later. A ResizeObserver on the rail's own element catches that
    // initial layout pass generically, plus every later resize (window
    // resize, a side panel opening, the monospace font toggle, Split mode
    // narrowing the pane) without every mount site needing its own resize
    // wiring for this.
    this._resizeObserver = new ResizeObserver(() => this.updateMetrics());
    this._resizeObserver.observe(this.dom);

    this.thumb.addEventListener('pointerdown', this._onThumbPointerDown);
    // Clicking the bare track (not the thumb, not a tick) jumps straight to
    // that position — the rail is thin enough that a native scrollbar's
    // "page up/down" track-click convention would add a step for no benefit.
    this.dom.addEventListener('pointerdown', this._onTrackPointerDown);
    // Ticks only fade in near the cursor (see _onTicksPointerMove) — a
    // "which sections are near where I'm pointing" reveal rather than
    // dumping the whole heading list on the rail at once, which is what
    // keeps a document with many headings from turning the rail into a
    // solid dashed line the instant it's hovered.
    this.dom.addEventListener('mousemove', this._onTicksPointerMove);
    this.dom.addEventListener('mouseleave', this._onTicksPointerLeave);
  }

  // Called on scroll/resize of the underlying surface. Cheap — just reads
  // already-known metrics and repositions the thumb; skipped mid-drag since
  // the drag handler itself is already driving the thumb's position directly
  // and re-deriving it from adapter.getMetrics() would fight the drag with a
  // frame of lag (the adapter's scrollTop write and this read aren't atomic).
  updateMetrics() {
    if (this._dragging) return;
    const { scrollTop, scrollHeight, clientHeight } = this.adapter.getMetrics();
    if (!clientHeight || scrollHeight <= clientHeight + 1) {
      this.dom.classList.add('is-unscrollable');
      this._lastMetrics = null;
      return;
    }
    this.dom.classList.remove('is-unscrollable');
    const trackHeight = this.dom.clientHeight;
    if (!trackHeight) { this._lastMetrics = null; return; }
    const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
    const maxThumbTop = trackHeight - thumbHeight;
    const maxScroll = scrollHeight - clientHeight;
    const scrollRatio = maxScroll > 0 ? scrollTop / maxScroll : 0;
    const thumbTop = maxThumbTop * scrollRatio;
    this.thumb.style.height = `${thumbHeight}px`;
    this.thumb.style.transform = `translateY(${thumbTop}px)`;
    this._lastMetrics = { scrollHeight, clientHeight, trackHeight, thumbHeight, maxThumbTop, maxScroll };
  }

  // headings: [{ level, text, top, ...anything jumpToHeading needs }] —
  // `top` is a pixel offset into the scrollable content, in the same
  // coordinate space as adapter.getMetrics().scrollHeight, so a tick's
  // vertical position on the rail lines up with where the thumb sits once
  // scrolled there.
  updateHeadings(headings) {
    const unchanged = headings.length === this._headings.length &&
      headings.every((h, i) => h.level === this._headings[i].level && h.text === this._headings[i].text && h.top === this._headings[i].top);
    if (unchanged) return;
    this._headings = headings;
    this.ticksLayer.innerHTML = '';
    this.dom.classList.toggle('has-ticks', headings.length >= 2);
    if (headings.length < 2) return;
    const { scrollHeight } = this.adapter.getMetrics();
    const denom = Math.max(1, scrollHeight);
    for (const h of headings) {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = `scroll-rail-tick scroll-rail-tick-h${h.level}`;
      const topPct = Math.min(100, (h.top / denom) * 100);
      tick.style.top = `${topPct}%`;
      tick.dataset.topPct = String(topPct);
      tick.title = h.text || 'section';
      tick.setAttribute('aria-label', `Jump to ${h.text || 'section'}`);
      const jump = () => this.adapter.jumpToHeading(h);
      // mousedown (not click) so this fires before the surface underneath
      // would otherwise steal focus/selection on the way to a click.
      tick.addEventListener('mousedown', (evt) => { evt.preventDefault(); evt.stopPropagation(); jump(); });
      // A native <button> is Tab-focusable, but keyboard Enter/Space
      // activation only ever fires 'click' (never 'mousedown') — evt.detail
      // is 0 only for a keyboard-synthesized click, never a real pointer
      // one, so a mouse click (already handled by mousedown above) doesn't
      // double-jump.
      tick.addEventListener('click', (evt) => { if (evt.detail === 0) jump(); });
      this.ticksLayer.appendChild(tick);
    }
  }

  _onTrackPointerDown(evt) {
    if (evt.target !== this.dom) return; // thumb/tick handle their own
    evt.preventDefault();
    const rect = this.dom.getBoundingClientRect();
    const ratio = rect.height > 0 ? Math.min(1, Math.max(0, (evt.clientY - rect.top) / rect.height)) : 0;
    const { scrollHeight, clientHeight } = this.adapter.getMetrics();
    // A discrete jump (like a tick click), not a drag — smooth, same as
    // jumpToHeading, rather than the instant snap a thumb *drag* uses.
    this.adapter.setScrollTop(ratio * Math.max(0, scrollHeight - clientHeight), { smooth: true });
  }

  // Fades ticks in based on vertical distance from the pointer instead of
  // revealing the whole heading list at once — "only show the dots close to
  // the mouse" — so a long document's rail reads as a quiet hairline with a
  // few nearby markers surfacing under the cursor, not a solid dashed line
  // the moment it's hovered. Each tick's own CSS (.scroll-rail-tick) turns
  // --proximity into opacity/scale; this only computes the number.
  _onTicksPointerMove(evt) {
    if (!this._headings.length) return;
    const rect = this.dom.getBoundingClientRect();
    if (!rect.height) return;
    const y = evt.clientY - rect.top;
    for (const tick of this.ticksLayer.children) {
      const tickY = (parseFloat(tick.dataset.topPct) / 100) * rect.height;
      const proximity = Math.max(0, 1 - Math.abs(tickY - y) / _TICK_PROXIMITY_RADIUS_PX);
      tick.style.setProperty('--proximity', proximity.toFixed(3));
    }
  }
  _onTicksPointerLeave() {
    for (const tick of this.ticksLayer.children) tick.style.removeProperty('--proximity');
  }

  _onThumbPointerDown(evt) {
    evt.preventDefault();
    evt.stopPropagation();
    if (!this._lastMetrics) return;
    this._dragging = true;
    this.dom.classList.add('is-dragging');
    // Purely an enhancement (lets the drag keep tracking even once the
    // pointer strays outside the thumb's own thin hit area) — must not be
    // allowed to abort the rest of setup below if it throws. Confirmed live
    // that it does: setPointerCapture() throws NotFoundError for a pointerId
    // with no currently-active real pointer, which a plain try/catch-less
    // call here turned into a stuck drag — is-dragging added, but every line
    // after this one (including the pointermove/pointerup listeners that are
    // the only way to ever clear it again) never ran.
    try { this.thumb.setPointerCapture(evt.pointerId); } catch { /* best-effort */ }
    this._dragStartClientY = evt.clientY;
    this._dragStartThumbTop = this._lastMetrics.maxThumbTop > 0
      ? (this.adapter.getMetrics().scrollTop / this._lastMetrics.maxScroll) * this._lastMetrics.maxThumbTop
      : 0;
    this.thumb.addEventListener('pointermove', this._onThumbPointerMove);
    this.thumb.addEventListener('pointerup', this._onThumbPointerUp);
    this.thumb.addEventListener('pointercancel', this._onThumbPointerUp);
  }

  _onThumbPointerMove(evt) {
    if (!this._dragging || !this._lastMetrics) return;
    const { maxThumbTop, maxScroll } = this._lastMetrics;
    const dy = evt.clientY - this._dragStartClientY;
    const thumbTop = Math.min(maxThumbTop, Math.max(0, this._dragStartThumbTop + dy));
    const ratio = maxThumbTop > 0 ? thumbTop / maxThumbTop : 0;
    this.thumb.style.transform = `translateY(${thumbTop}px)`;
    this.adapter.setScrollTop(ratio * maxScroll);
  }

  _onThumbPointerUp(evt) {
    this._dragging = false;
    this.dom.classList.remove('is-dragging');
    this.thumb.removeEventListener('pointermove', this._onThumbPointerMove);
    this.thumb.removeEventListener('pointerup', this._onThumbPointerUp);
    this.thumb.removeEventListener('pointercancel', this._onThumbPointerUp);
    this.updateMetrics();
  }

  destroy() {
    this._resizeObserver.disconnect();
    this.thumb.removeEventListener('pointerdown', this._onThumbPointerDown);
    this.dom.removeEventListener('pointerdown', this._onTrackPointerDown);
    this.dom.removeEventListener('mousemove', this._onTicksPointerMove);
    this.dom.removeEventListener('mouseleave', this._onTicksPointerLeave);
    this._onThumbPointerUp();
    this.dom.remove();
  }
}

// ── Plain-text (Write-mode textarea) heading + pixel-position support ──────
// CM6's own heading collection (live-editor.js's _collectHeadings) walks a
// real parsed syntax tree, which only exists for the CM6 surface. The
// textarea has no parser at all, so headings here are found with a plain
// line scan — deliberately skipping ATX-looking lines inside fenced code
// blocks (```/~~~) so a commented-out "# heading" in a code sample doesn't
// produce a bogus tick, the one correctness gap a naive regex-per-line scan
// would otherwise have.
export function collectPlainTextHeadings(text) {
  const headings = [];
  let offset = 0;
  let fenceMarker = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fenceMatch) {
      if (!fenceMarker) fenceMarker = fenceMatch[1][0];
      else if (trimmed[0] === fenceMarker) fenceMarker = null;
      offset += line.length + 1;
      continue;
    }
    if (!fenceMarker) {
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        headings.push({
          level: m[1].length,
          text: m[2].replace(/[*_`~=]/g, '').trim(),
          offset,
        });
      }
    }
    offset += line.length + 1;
  }
  return headings;
}

// Measures the pixel top of each heading's line inside `textarea`, honoring
// soft-wrap (a naive lineIndex * lineHeight guess breaks the moment any line
// wraps). Standard "shadow mirror" technique: an offscreen div cloned with
// every layout-affecting style property from the textarea, fed the same
// text, with a marker element inserted at each heading's character offset
// whose offsetTop is then the real, wrap-accurate answer.
const _MIRROR_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'tabSize', 'textIndent', 'wordSpacing',
];

export function measureTextareaHeadingTops(textarea, headings) {
  if (headings.length === 0) return [];
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.height = 'auto';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  for (const prop of _MIRROR_PROPS) mirror.style[prop] = style[prop];
  document.body.appendChild(mirror);

  const text = textarea.value;
  const tops = [];
  try {
    for (const h of headings) {
      mirror.textContent = text.slice(0, h.offset);
      const marker = document.createElement('span');
      marker.textContent = '​';
      mirror.appendChild(marker);
      tops.push(marker.offsetTop);
    }
  } finally {
    mirror.remove();
  }
  return tops;
}
