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
    await import(`/SyncPad/src/keyboard-viewport.js?test=${Date.now()}`);
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
      const LiveEditor = await import('/SyncPad/src/live-editor.js');
      LiveEditor.scrollCaretIntoView(); // nothing mounted yet
      return 'ok';
    });
    expect(unmountedResult).toBe('ok');

    const mountedResult = await page.evaluate(async () => {
      const LiveEditor = await import('/SyncPad/src/live-editor.js');
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
