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
// once, side by side, so a single shared instance can't work. Both instances
// mount as siblings of their surface inside the shared `.editor-wrap` card
// (never inside the surface's own scrolling DOM) and share one positioning
// algorithm — see mountWriteScrollRail() (ui/editor.js) and _RailPlugin
// (live-editor.js) for where each is created, and this class's own
// _reposition() for the shared geometry.
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

// ── Shared smooth-scroll tracking ───────────────────────────────────────────
// Every *deliberate* jump on either surface (a rail tick/track click, [TOC]/
// anchor navigation, CM6's own off-screen heading correction) goes through
// runSmoothScroll() rather than calling el.scrollTo({behavior:'smooth'})
// directly, so that isProgrammaticSmoothScroll(el) can tell a Split-mode
// proportional-sync handler "this element is mid deliberate animation right
// now" — see wireProportionalScrollSync() below for why that matters: a
// script-driven scrollTop write cancels any native smooth scroll already in
// flight on that same element, so a sync handler must skip exactly that one
// write (without disabling sync altogether) whenever its target is animating.
const _pendingScrolls = new WeakMap(); // el -> { token, cancel() }
let _scrollTokenSeq = 0;

export function isProgrammaticSmoothScroll(el) {
  return _pendingScrolls.has(el);
}

/**
 * Smoothly scroll `el` to `top` (or jump instantly under
 * prefers-reduced-motion), tracking `el` via isProgrammaticSmoothScroll()
 * until the browser reports the scroll has settled. Calling this again for
 * the same `el` before the previous call settled supersedes its tracking —
 * el.scrollTo({behavior:'smooth'}) naturally retargets an in-flight native
 * smooth scroll toward the new destination, so the newer call always wins
 * visually; this only makes sure stale tracking can't outlive it (a correction
 * from an old CM6 heading jump, say, can't be mistaken for the new one's).
 */
export function runSmoothScroll(el, top) {
  _pendingScrolls.get(el)?.cancel();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    el.scrollTop = top;
    return;
  }
  const token = ++_scrollTokenSeq;
  el.scrollTo({ top, behavior: 'smooth' });

  // `scrollend` (Chrome 114+, Firefox 109+, Safari 17.4+) is the real
  // signal, but isn't universal yet and — per spec ambiguity confirmed live
  // — isn't guaranteed to fire at all for a zero-distance scrollTo. A
  // bounded rAF poll runs alongside it unconditionally as a safety net:
  // "stable" requires a couple of quiet frames (not just one) so a
  // not-yet-started animation isn't mistaken for an already-finished one,
  // and a hard frame cap means a pane that gets hidden/removed mid-animation
  // can't wedge the tracking on forever.
  let frame = 0;
  let stableFrames = 0;
  let lastTop = el.scrollTop;
  let framesLeft = 180; // ~3s at 60fps
  let rafId = null;
  const finish = () => {
    el.removeEventListener('scrollend', finish);
    if (rafId != null) cancelAnimationFrame(rafId);
    if (_pendingScrolls.get(el)?.token === token) _pendingScrolls.delete(el);
  };
  const poll = () => {
    if (_pendingScrolls.get(el)?.token !== token) return; // superseded
    frame++;
    if (Math.abs(el.scrollTop - lastTop) < 0.5) {
      if (frame > 2 && ++stableFrames >= 3) { finish(); return; }
    } else {
      stableFrames = 0;
      lastTop = el.scrollTop;
    }
    if (--framesLeft <= 0) { finish(); return; }
    rafId = requestAnimationFrame(poll);
  };
  el.addEventListener('scrollend', finish);
  rafId = requestAnimationFrame(poll);
  _pendingScrolls.set(el, { token, cancel: finish });
}

/**
 * Wire bidirectional proportional (percent-of-scrollable-range) scroll sync
 * between two panes — shared by both Split-mode implementations (the plain
 * textarea against either the static rendered preview or the CM6 Live
 * surface) so the "don't fight a deliberate smooth scroll" fix lives in one
 * place instead of two nearly-identical copies.
 *
 * Skips a write into `to` (rather than disabling sync altogether) whenever
 * `to` is currently mid-runSmoothScroll() — assigning scrollTop into it would
 * cancel that animation — while still reading and propagating `from`'s live
 * position on every scroll event, in both directions. Also skips a write
 * that's already within a hair of the target so an echo from the last write
 * can't bounce back and forth forever.
 *
 * @returns {() => void} unwire
 */
export function wireProportionalScrollSync(elA, elB) {
  const propagate = (from, to) => {
    if (isProgrammaticSmoothScroll(to)) return;
    const maxFrom = from.scrollHeight - from.clientHeight;
    const ratio = maxFrom > 0 ? from.scrollTop / maxFrom : 0;
    const target = ratio * (to.scrollHeight - to.clientHeight);
    if (Math.abs(to.scrollTop - target) < 1) return;
    to.scrollTop = target;
  };
  const onA = () => propagate(elA, elB);
  const onB = () => propagate(elB, elA);
  elA.addEventListener('scroll', onA);
  elB.addEventListener('scroll', onB);
  return () => {
    elA.removeEventListener('scroll', onA);
    elB.removeEventListener('scroll', onB);
  };
}

/**
 * Wire bidirectional scroll sync between two panes by matching *source
 * position*, not scroll percentage — "whatever's at the top of A's viewport
 * should also be at the top of B's" — the same anchor heading ticks and
 * mode-switch transfer already use, rather than a second, cruder mechanism.
 * More accurate than wireProportionalScrollSync() at every point (not just at
 * a one-shot transfer), at the cost of a real per-call computation on
 * whichever adapter's getOffsetAtTop() has to do a Write-side mirror-div
 * search.
 *
 * A single shared sequence number — not two independently-throttled ones —
 * guards every scheduled propagation, in either direction: scheduling a new
 * one immediately invalidates any earlier one still pending, whichever
 * direction it was headed. Two separate per-direction throttles (an earlier
 * version of this) can't see each other, so a delayed A->B echo scheduled a
 * frame or two ago can fire *after* A has kept moving in the meantime (a
 * fast continuous trackpad scroll produces several native 'scroll' events
 * across a few frames), writing B's stale, already-superseded position back
 * into A and visibly tugging the pane the user is actively scrolling
 * backward. Sharing one counter across both directions means a fresher
 * scroll — on *either* pane — always supersedes anything still pending, and
 * naturally reproduces the old throttle's "coalesce a burst down to one
 * call" behavior as a side effect (every scheduled call but the last one
 * scheduled before its own animation frame arrives finds itself stale).
 *
 * @param {{ el: HTMLElement, getOffsetAtTop: () => number, scrollToOffset: (offset: number) => void }} adapterA
 * @param {{ el: HTMLElement, getOffsetAtTop: () => number, scrollToOffset: (offset: number) => void }} adapterB
 * @returns {() => void} unwire
 */
export function wireOffsetScrollSync(adapterA, adapterB) {
  let seq = 0;
  const schedule = (from, to) => {
    const mySeq = ++seq;
    requestAnimationFrame(() => {
      if (seq !== mySeq) return; // superseded by a later scroll, either direction
      if (isProgrammaticSmoothScroll(to.el)) return;
      const offset = from.getOffsetAtTop();
      // Skip a write that's already correct — an echo from the last write
      // would otherwise compute back to (approximately) the same offset and
      // bounce forever between the two panes.
      if (to.getOffsetAtTop() === offset) return;
      to.scrollToOffset(offset);
    });
  };
  const onA = () => schedule(adapterA, adapterB);
  const onB = () => schedule(adapterB, adapterA);
  adapterA.el.addEventListener('scroll', onA);
  adapterB.el.addEventListener('scroll', onB);
  return () => {
    adapterA.el.removeEventListener('scroll', onA);
    adapterB.el.removeEventListener('scroll', onB);
  };
}

// ── The rail itself ─────────────────────────────────────────────────────────
// Both surfaces mount their rail as a plain sibling of the surface inside the
// shared `.editor-wrap` card (never inside the surface's own scrolling DOM —
// in particular, never inside CM6's `.cm-editor`, which is CodeMirror-owned
// internal DOM) and both use this class's own _reposition() to overlay the
// rail on `surfaceEl`'s live border box. One mounting strategy, one
// positioning algorithm, for both — see mountWriteScrollRail() (ui/editor.js)
// and _RailPlugin (live-editor.js) for where each instance is created.
export class ScrollRail {
  /**
   * @param {HTMLElement} wrapEl - the shared `.editor-wrap` card; the rail is
   *   appended here and _reposition() reads offsets relative to it.
   * @param {object} adapter
   * @param {HTMLElement} [surfaceEl] - the surface this rail overlays
   *   (`#note-editor` or `#note-live`); its live getBoundingClientRect()
   *   drives top/height/right on every relevant resize.
   */
  constructor(wrapEl, adapter, surfaceEl) {
    this.adapter = adapter;
    this.surfaceEl = surfaceEl || null;
    this.dom = document.createElement('div');
    this.dom.className = 'scroll-rail';
    this.thumb = document.createElement('div');
    this.thumb.className = 'scroll-rail-thumb';
    this.dom.appendChild(this.thumb);
    this.ticksLayer = document.createElement('div');
    this.ticksLayer.className = 'scroll-rail-ticks';
    this.dom.appendChild(this.ticksLayer);
    wrapEl.appendChild(this.dom);

    this._headings = [];
    this._dragging = false;
    this._lastMetrics = null;
    this._lastClientY = null;

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
    // wiring for this. Also observing surfaceEl itself (not just the rail's
    // own already-positioned box) is what catches a hidden→visible mode
    // switch and Split's column-width changes *before* the rail has ever
    // been positioned once — a resize of the rail's own 0×0 box wouldn't
    // otherwise fire until after that first _reposition() already ran.
    this._resizeObserver = new ResizeObserver(() => { this.reposition(); this.updateMetrics(); });
    this._resizeObserver.observe(this.dom);
    if (this.surfaceEl) this._resizeObserver.observe(this.surfaceEl);
    this.reposition();

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

  // Overlay the rail on this.surfaceEl's current border box, in
  // this.dom's-parent-relative coordinates — the one positioning algorithm
  // shared by Write and Live/Preview (see this file's header comment).
  // Recomputed from live getBoundingClientRect()s rather than cached deltas:
  // correct even when the offset between the rail's wrap and its surface
  // changed for a reason that isn't a resize of either individually (e.g.
  // the toolbar row above growing taller pushes the surface down without
  // changing the surface's own width, or the wrap's height at all). No-op
  // when constructed without a surfaceEl (there is currently no such call
  // site, but nothing here requires one). Public (not just the internal
  // ResizeObserver's own callback): a mode switch's display:none <-> visible
  // flip isn't guaranteed to fire that observer in time for the very first
  // paint of a newly-revealed surface, so callers that own a mode switch
  // (ui/editor.js's setMarkdownMode, live-editor.js's _RailPlugin.rebuild)
  // call this explicitly too — confirmed live the observer alone left a
  // freshly-revealed rail at stale, usually zero-sized, geometry otherwise.
  reposition() {
    if (!this.surfaceEl) return;
    const wrap = this.dom.parentElement;
    if (!wrap) return;
    const surfaceRect = this.surfaceEl.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    this.dom.style.top = `${surfaceRect.top - wrapRect.top}px`;
    this.dom.style.height = `${surfaceRect.height}px`;
    this.dom.style.bottom = 'auto';
    this.dom.style.right = `${wrapRect.right - surfaceRect.right + 9}px`;
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
    // CM6 keeps refining its estimated heading positions for a few update
    // cycles right after a long document first mounts (see live-editor.js's
    // rebuild()), each refinement able to call this again — which, without
    // this, would silently reset any tick a real hover was actively
    // highlighting back to dim (fresh buttons start with no --proximity)
    // until the next actual pointer move. A held-still pointer gets its
    // highlight re-applied to the just-rebuilt ticks immediately instead.
    if (this._lastClientY != null) this._applyProximity(this._lastClientY);
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
    this._lastClientY = evt.clientY;
    this._applyProximity(evt.clientY);
  }
  _onTicksPointerLeave() {
    this._lastClientY = null;
    for (const tick of this.ticksLayer.children) tick.style.removeProperty('--proximity');
  }
  _applyProximity(clientY) {
    if (!this._headings.length) return;
    const rect = this.dom.getBoundingClientRect();
    if (!rect.height) return;
    const y = clientY - rect.top;
    for (const tick of this.ticksLayer.children) {
      const tickY = (parseFloat(tick.dataset.topPct) / 100) * rect.height;
      const proximity = Math.max(0, 1 - Math.abs(tickY - y) / _TICK_PROXIMITY_RADIUS_PX);
      tick.style.setProperty('--proximity', proximity.toFixed(3));
    }
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

// Sets up one mirror div for `textarea` and hands the caller a `measureTop(offset)`
// function that can be called any number of times before the mirror is torn
// down — shared setup/teardown for every offset<->pixel-top measurement below,
// so a caller needing several measurements (heading positions, a binary
// search) pays the one-time mirror-creation cost once instead of once per
// probe.
function _withTextareaMirror(textarea, fn) {
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
  const measureTop = (offset) => {
    mirror.textContent = text.slice(0, offset);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);
    return marker.offsetTop;
  };
  try {
    return fn(measureTop, text);
  } finally {
    mirror.remove();
  }
}

export function measureTextareaHeadingTops(textarea, headings) {
  if (headings.length === 0) return [];
  return _withTextareaMirror(textarea, (measureTop) => headings.map((h) => measureTop(h.offset)));
}

// Per-textarea index of each logical (unwrapped source) line's start offset
// and measured top, rebuilt only when the content or wrapping width/font
// actually changes — not on every call. getTextareaOffsetAtTop() drives a
// mirror-based binary search from Split-mode's continuous scroll sync, once
// per animation frame; without this cache, every one of the search's ~16
// probes reassigns the mirror's full textContent and forces a synchronous
// layout read, at BODY_MAX (50,000 chars) real enough to visibly jank an
// ordinary fast scroll. Caching line starts/tops turns a repeat lookup into
// a fast in-memory binary search over (typically a few hundred) lines with
// no DOM work at all — a probe only needs the mirror at all for a line
// that's demonstrably wrapped into more than one visual row (see the
// row-span check in both functions below), which is the uncommon case.
const _lineTopIndexCache = new WeakMap(); // textarea -> { text, key, lineStarts, tops, lineHeight }

function _getLineTopIndex(textarea) {
  const text = textarea.value;
  const style = getComputedStyle(textarea);
  // Width alone isn't enough to invalidate on — a font/size change (e.g.
  // the monospace toggle) reflows every line without touching clientWidth.
  const key = `${textarea.clientWidth}|${style.fontFamily}|${style.fontSize}`;
  const cached = _lineTopIndexCache.get(textarea);
  if (cached && cached.text === text && cached.key === key) return cached;

  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1); // '\n'
  }
  const tops = text.length ? _withTextareaMirror(textarea, (measureTop) => lineStarts.map((offset) => measureTop(offset))) : [0];
  const lineHeight = parseFloat(style.lineHeight) || 0;
  const index = { text, key, lineStarts, tops, lineHeight };
  _lineTopIndexCache.set(textarea, index);
  return index;
}

// True when logical line `lineIndex` rendered as more than one visual row
// (i.e. it wrapped) — the one case where every character on the line does
// *not* share the same measured top, so the cached line-start/top pair
// alone isn't precise enough and a caller needs to fall back to a real
// mirror measurement. Conservatively true for the last line (no next
// line's top to diff against) and whenever lineHeight itself couldn't be
// determined, rather than risk silently returning an imprecise answer.
function _lineIsWrapped({ lineStarts, tops, lineHeight }, lineIndex) {
  if (!lineHeight || lineIndex === lineStarts.length - 1) return true;
  return (tops[lineIndex + 1] - tops[lineIndex]) > lineHeight * 1.5;
}

/** Pixel top of a single arbitrary character offset — the same technique as
 *  measureTextareaHeadingTops(), generalized to any offset (used for mode-
 *  switch/Split-sync scroll-position transfer, not just heading ticks). */
export function measureTextareaOffsetTop(textarea, offset) {
  if (!textarea.value.length) return 0;
  const index = _getLineTopIndex(textarea);
  const { lineStarts, tops } = index;
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  if (!_lineIsWrapped(index, lo)) return tops[lo];
  return _withTextareaMirror(textarea, (measureTop) => measureTop(offset));
}

/**
 * The inverse of measureTextareaOffsetTop(): which character offset sits at
 * pixel position `targetTop` (typically the textarea's own scrollTop, i.e.
 * "what's at the top of the viewport right now"). A character's measured
 * top is monotonically non-decreasing as offset increases (text only ever
 * flows forward/downward), so this binary-searches for the largest offset
 * whose line starts at or above targetTop.
 */
export function getTextareaOffsetAtTop(textarea, targetTop) {
  const text = textarea.value;
  if (!text.length) return 0;
  const index = _getLineTopIndex(textarea);
  const { lineStarts, tops } = index;

  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tops[mid] <= targetTop) lo = mid; else hi = mid - 1;
  }
  const lineStart = lineStarts[lo];
  if (!_lineIsWrapped(index, lo)) return lineStart;

  // This line wrapped into multiple visual rows — a bounded fine search
  // within just its own character range (never the whole document) pins
  // down the exact wrapped row targetTop falls on.
  const lineEnd = lo + 1 < lineStarts.length ? lineStarts[lo + 1] - 1 : text.length;
  if (lineEnd === lineStart) return lineStart;
  return _withTextareaMirror(textarea, (measureTop) => {
    let a = lineStart, b = lineEnd;
    while (a < b) {
      const mid = Math.ceil((a + b) / 2);
      if (measureTop(mid) <= targetTop) a = mid; else b = mid - 1;
    }
    return a;
  });
}

/** Build a { el, getOffsetAtTop, scrollToOffset } adapter for a plain
 *  textarea surface — usable directly with wireOffsetScrollSync(). The
 *  Write-mode half of a sync pair; the CM6 half is built the same shape by
 *  live-editor.js itself (wireScrollSync()), since it needs that module's
 *  own view state. Shared here (rather than duplicated in both ui/editor.js
 *  and live-editor.js) so the "how do I read/set Write's top-visible-offset"
 *  logic lives in exactly one place. */
export function createTextareaOffsetAdapter(editor) {
  return {
    el: editor,
    getOffsetAtTop: () => (editor.value.length ? getTextareaOffsetAtTop(editor, editor.scrollTop) : 0),
    scrollToOffset: (offset) => { editor.scrollTop = Math.max(0, measureTextareaOffsetTop(editor, offset)); },
  };
}
