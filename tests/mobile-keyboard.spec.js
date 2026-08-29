// tests/mobile-keyboard.spec.js
// src/keyboard-viewport.js tracks the gap between window.innerHeight and
// window.visualViewport (the on-screen keyboard, on platforms like iOS
// Safari where innerHeight never shrinks for it) as a --kb-inset CSS custom
// property, so the app's bottom-anchored fixed bars stay above the keyboard
// instead of hiding behind it. No real headless browser ever opens an
// on-screen keyboard, so this stubs window.visualViewport with a fake
// EventTarget-like object before importing the module, then dispatches
// synthetic resize/scroll events to drive it.

import { test, expect } from '@playwright/test';
import { goToLanding } from './helpers.js';

async function stubVisualViewportAndImport(page) {
  return page.evaluate(async () => {
    const listeners = { resize: [], scroll: [] };
    const fakeVV = {
      height: window.innerHeight,
      offsetTop: 0,
      scale: 1,
      addEventListener: (type, fn) => listeners[type].push(fn),
      removeEventListener: (type, fn) => {
        listeners[type] = listeners[type].filter((f) => f !== fn);
      },
    };
    Object.defineProperty(window, 'visualViewport', { value: fakeVV, configurable: true });
    window.__fakeVV = fakeVV;
    window.__fakeVVListeners = listeners;
    // Cache-bust so this always re-executes the module's top-level side
    // effect against the freshly-stubbed visualViewport, rather than
    // reusing the already-evaluated real import from the page's own boot.
    await import(`/JotRelay/src/keyboard-viewport.js?test=${Date.now()}`);
  });
}

function getKbInset(page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim()
  );
}

async function simulateKeyboard(page, { heightDelta = 0, offsetTop = 0, scale = 1, via = 'resize' } = {}) {
  await page.evaluate(({ heightDelta, offsetTop, scale, via }) => {
    window.__fakeVV.height = window.innerHeight - heightDelta;
    window.__fakeVV.offsetTop = offsetTop;
    window.__fakeVV.scale = scale;
    window.__fakeVVListeners[via].forEach((fn) => fn());
  }, { heightDelta, offsetTop, scale, via });
}

test.describe('Mobile keyboard viewport tracking', () => {
  test('--kb-inset starts at 0px and reflects the visualViewport/innerHeight gap', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);
    expect(await getKbInset(page)).toBe('0px');

    await simulateKeyboard(page, { heightDelta: 300 });
    expect(await getKbInset(page)).toBe('300px');

    await simulateKeyboard(page, { heightDelta: 0 });
    expect(await getKbInset(page)).toBe('0px');
  });

  test('--kb-inset accounts for visualViewport.offsetTop on scroll events too', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    await simulateKeyboard(page, { heightDelta: 300, offsetTop: 20, via: 'scroll' });
    expect(await getKbInset(page)).toBe('280px');
  });

  test('--kb-inset ignores pinch-zoom (non-1 visualViewport.scale)', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    // Pinch-zooming in also shrinks visualViewport.height/shifts offsetTop —
    // indistinguishable from a keyboard using those two values alone. Must
    // report 0px rather than misreading the zoom as a keyboard and
    // reflowing the editor under a zoomed-in user's fingers.
    await simulateKeyboard(page, { heightDelta: 300, scale: 2 });
    expect(await getKbInset(page)).toBe('0px');

    // Zooming back out to 1:1 with the same height gap now present (e.g. a
    // real keyboard actually is open) should resume reporting it normally.
    await simulateKeyboard(page, { heightDelta: 300, scale: 1 });
    expect(await getKbInset(page)).toBe('300px');
  });

  test('--kb-inset never goes negative', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    // A visualViewport taller than innerHeight shouldn't happen in practice,
    // but the source clamps with Math.max(0, ...) defensively — verify it.
    await simulateKeyboard(page, { heightDelta: -50 });
    expect(await getKbInset(page)).toBe('0px');
  });

  test('bottom-anchored bars consume --kb-inset in their bottom offset', async ({ page }) => {
    await goToLanding(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '300px'));
    // Allow the bars' own `transition: bottom` to settle so the computed
    // value reflects the new custom property rather than a mid-animation
    // interpolated one.
    await page.waitForTimeout(250);

    const toastBottom = await page.evaluate(
      () => getComputedStyle(document.getElementById('toast-container')).bottom
    );
    expect(toastBottom).toBe('324px');
  });

  test('#app-screen reserves bottom space for the raised mobile action bar', async ({ page }) => {
    // padding-bottom on #app-screen only applies under the mobile
    // (max-width: 639px) breakpoint — without a matching viewport, this
    // regression (the editor's last lines rendering under the bar once it
    // rises for the keyboard) can't be observed at all.
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--kb-inset', '300px'));
    await page.waitForTimeout(250);

    const paddingBottom = await page.evaluate(
      () => getComputedStyle(document.getElementById('app-screen')).paddingBottom
    );
    expect(paddingBottom).toBe('360px'); // 60px base bar height + 300px keyboard inset
  });
});

// The --kb-inset CSS reflow above shrinks the editor's own box to stay
// above the keyboard, but neither a plain <textarea> nor CodeMirror 6
// re-scrolls to keep the *caret* visible just because their container got
// shorter out from under them (that only happens on an actual selection/
// content change) — this is the second half of the fix: re-trigger each
// surface's own native caret-visibility scroll shortly after the resize
// settles. Exercised against standalone elements/a directly-mounted CM6
// instance rather than a real room, the same technique remote-selection.spec.js
// uses for LiveEditor — no Supabase/network dependency either way.
test.describe('Keyboard resize re-scrolls the caret into view', () => {
  test('a focused #note-editor textarea gets its selection re-applied (re-triggering the browser\'s own caret-follow scroll)', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    const calls = await page.evaluate(async () => {
      const ta = document.createElement('textarea');
      ta.id = 'note-editor';
      ta.value = 'line one\nline two\nline three';
      document.body.appendChild(ta);
      ta.focus();
      ta.setSelectionRange(4, 8, 'forward');

      const seen = [];
      const orig = ta.setSelectionRange.bind(ta);
      ta.setSelectionRange = (...args) => { seen.push(args); orig(...args); };

      window.__fakeVV.height = window.innerHeight - 300;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      // The reflow is debounced ~180ms after the resize settles.
      await new Promise((r) => setTimeout(r, 400));

      ta.remove();
      return seen;
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual([4, 8, 'forward']);
  });

  test('an unrelated focused input is left alone (no selection nudge)', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    const calls = await page.evaluate(async () => {
      const input = document.createElement('input');
      input.id = 'some-other-input';
      document.body.appendChild(input);
      input.focus();

      const seen = [];
      const orig = input.setSelectionRange.bind(input);
      input.setSelectionRange = (...args) => { seen.push(args); orig(...args); };

      window.__fakeVV.height = window.innerHeight - 300;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      await new Promise((r) => setTimeout(r, 400));

      input.remove();
      return seen;
    });

    expect(calls.length).toBe(0);
  });

  test('the CM6 live surface re-scrolls its own selection into view when focused, and is a no-op when not', async ({ page }) => {
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    // Reaching the final return at all (page.evaluate rejects on any
    // uncaught error inside it, which Playwright surfaces as a test
    // failure) is the assertion for both the not-yet-mounted no-op and the
    // focused-and-mounted path through keyboard-viewport.js's real debounced
    // resize → scrollCaretIntoView() integration.
    const unmountedResult = await page.evaluate(async () => {
      const LiveEditor = await import('/JotRelay/src/live-editor.js');
      LiveEditor.scrollCaretIntoView(); // nothing mounted yet
      return 'ok';
    });
    expect(unmountedResult).toBe('ok');

    const mountedResult = await page.evaluate(async () => {
      const LiveEditor = await import('/JotRelay/src/live-editor.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      LiveEditor.mount(container, 'a\nb\nc\nd\ne\nf\ng\nh', {});
      container.querySelector('.cm-content').focus();

      window.__fakeVV.height = window.innerHeight - 300;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      await new Promise((r) => setTimeout(r, 400));

      LiveEditor.destroy();
      container.remove();
      return 'ok';
    });
    expect(mountedResult).toBe('ok');
  });
});

// body.keyboard-open reclaims the bottom action bar's footprint the moment
// ANY text surface is focused on mobile — a separate, focus-driven signal
// from --kb-inset above (see keyboard-viewport.js's own comment for why
// --kb-inset alone can't detect this on every platform).
test.describe('body.keyboard-open — bottom action bar reclaim', () => {
  test('focusing a textarea on a mobile viewport adds keyboard-open; blurring removes it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);

    const ta = page.locator('#kb-open-test-textarea');
    await page.evaluate(() => {
      const el = document.createElement('textarea');
      el.id = 'kb-open-test-textarea';
      document.body.appendChild(el);
    });
    await ta.focus();
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);

    await page.evaluate(() => document.getElementById('kb-open-test-textarea')?.blur());
    // The removal is deliberately deferred one tick (see the file's own
    // comment) so a focus hop between two text surfaces doesn't flash it.
    await expect(page.locator('body')).not.toHaveClass(/keyboard-open/, { timeout: 2000 });

    await page.evaluate(() => document.getElementById('kb-open-test-textarea')?.remove());
  });

  test('does not add keyboard-open on a desktop-width viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await goToLanding(page);

    await page.evaluate(() => {
      const el = document.createElement('textarea');
      el.id = 'kb-open-test-textarea-desktop';
      document.body.appendChild(el);
    });
    await page.locator('#kb-open-test-textarea-desktop').focus();
    await expect(page.locator('body')).not.toHaveClass(/keyboard-open/);

    await page.evaluate(() => document.getElementById('kb-open-test-textarea-desktop')?.remove());
  });

  test('a focused contenteditable also triggers it (CM6 Live surface)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);

    await page.evaluate(() => {
      const el = document.createElement('div');
      el.id = 'kb-open-test-ce';
      el.contentEditable = 'true';
      document.body.appendChild(el);
    });
    await page.locator('#kb-open-test-ce').focus();
    await expect(page.locator('body')).toHaveClass(/keyboard-open/);

    await page.evaluate(() => document.getElementById('kb-open-test-ce')?.remove());
  });

  test('the mobile action bar is actually hidden while keyboard-open is set', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);

    // .mobile-action-bar lives inside #app-screen, only shown once a real
    // room is joined (needs Supabase — unreachable in this sandbox). Force
    // it visible directly rather than joining a room, since this test only
    // cares about the keyboard-open CSS rule in isolation, not routing.
    await page.evaluate(() => document.getElementById('app-screen').classList.remove('hidden'));

    const displayWithout = await page.evaluate(
      () => getComputedStyle(document.querySelector('.mobile-action-bar')).display
    );
    expect(displayWithout).toBe('flex'); // sanity check: visible by default at this viewport

    await page.evaluate(() => document.body.classList.add('keyboard-open'));
    const displayWith = await page.evaluate(
      () => getComputedStyle(document.querySelector('.mobile-action-bar')).display
    );
    expect(displayWith).toBe('none');

    await page.evaluate(() => {
      document.body.classList.remove('keyboard-open');
      document.getElementById('app-screen').classList.add('hidden');
    });
  });

  test('closing the floating comment composer (which removes its still-focused input directly) does not leave keyboard-open stuck', async ({ page }) => {
    // Regression test: closeFloatingCommentComposer() (ui/collab.js) removes
    // its <input> from the DOM while it's still focused, rather than
    // blurring first — removal alone isn't guaranteed to fire blur/focusout
    // on every browser (notably mobile Safari), which is the ONLY cleanup
    // path for body.keyboard-open. Without the explicit blur() the fix
    // added, this class — and the hidden action bar/reclaimed padding that
    // comes with it — would stay stuck after the keyboard actually closes.
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);

    const result = await page.evaluate(async () => {
      const UI = await import('/JotRelay/src/ui.js');
      UI.openFloatingCommentComposer({ x: 100, y: 400 }, () => {});
      await new Promise((r) => setTimeout(r, 20));
      const hadClass = document.body.classList.contains('keyboard-open');

      // Escape closes the composer via closeFloatingCommentComposer(),
      // which removes the still-focused input directly.
      document.querySelector('.comment-floating-composer input')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 100));

      return { hadClass, stillHasClass: document.body.classList.contains('keyboard-open'), composerGone: !document.querySelector('.comment-floating-composer') };
    });

    expect(result.hadClass).toBe(true);
    expect(result.composerGone).toBe(true);
    expect(result.stillHasClass).toBe(false);
  });

  test('a keyboard-open stuck by a path that never fires focusout (e.g. Android back-button dismissal) self-heals once the viewport geometry actually recovers', async ({ page }) => {
    // focusout is keyboard-open's only OTHER cleanup path, and removing a
    // focused element isn't guaranteed to fire it on every browser (see the
    // previous test) — Android's back-button/gesture keyboard dismissal is
    // a second, broader case with the same symptom: it's well documented
    // that this closes the keyboard WITHOUT blurring the focused input at
    // all, so no focusout fires there either, on any browser. Simulate that
    // directly (force the class stuck with no focus event behind it) and
    // confirm the geometry-based fallback in keyboard-viewport.js still
    // clears it once the real viewport height recovers.
    await page.setViewportSize({ width: 390, height: 844 });
    await goToLanding(page);
    await stubVisualViewportAndImport(page);

    const result = await page.evaluate(async () => {
      // Seed the "no keyboard" baseline the same way the module's own
      // initial call does at load — before anything opens the keyboard.
      window.__fakeVV.height = window.innerHeight;
      window.__fakeVVListeners.resize.forEach((fn) => fn());

      // Force the class on with nothing behind it — no textarea, no focus
      // event — the same end state a missed focusout would leave behind.
      document.body.classList.add('keyboard-open');

      // The keyboard "opens" (shrinks the viewport) — should stay stuck,
      // same as it would while genuinely still open.
      window.__fakeVV.height = window.innerHeight - 300;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      const stillOpenWhileShrunk = document.body.classList.contains('keyboard-open');

      // A partial recovery that's still bigger than the margin (e.g. the
      // keyboard's own resize height briefly overshooting mid-animation)
      // must NOT be mistaken for the keyboard actually closing.
      window.__fakeVV.height = window.innerHeight - 220;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      const stillOpenAfterSmallRecovery = document.body.classList.contains('keyboard-open');

      // The keyboard actually closes (viewport recovers to baseline) with
      // no focus event of any kind — geometry alone should heal it.
      window.__fakeVV.height = window.innerHeight;
      window.__fakeVVListeners.resize.forEach((fn) => fn());
      const healedAfterRealRecovery = !document.body.classList.contains('keyboard-open');

      return { stillOpenWhileShrunk, stillOpenAfterSmallRecovery, healedAfterRealRecovery };
    });

    expect(result.stillOpenWhileShrunk).toBe(true);
    expect(result.stillOpenAfterSmallRecovery).toBe(true);
    expect(result.healedAfterRealRecovery).toBe(true);
  });
});
