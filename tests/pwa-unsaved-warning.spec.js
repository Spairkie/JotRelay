// tests/pwa-unsaved-warning.spec.js
// sync.js's hasUnsavedChanges() drives app/pwa.js's beforeunload warning —
// local drafts (offline.js) already persist every keystroke, so this is
// specifically about the durable Postgres save not having confirmed yet.
// Exercised directly against the module (no real room/Supabase — see
// tests/comments.spec.js's "Comment threads" block for the same pattern),
// since the meaningful thing to verify is the synchronous state transition,
// not an actual network round trip.

import { test, expect } from '@playwright/test';

test('hasUnsavedChanges() flips true synchronously on local input, false at rest', async ({ page }) => {
  await page.goto('/SyncPad/');
  const result = await page.evaluate(async () => {
    const Sync = await import('/SyncPad/src/sync.js');
    let value = 'hello';
    Sync.initSync({
      roomId: 'test-room-unsaved-check',
      getEditorVal: () => value,
      setEditorVal: (v) => { value = v; },
      onStatusChange: () => {},
    });

    const before = Sync.hasUnsavedChanges();
    // onLocalInput() awaits the (localStorage-only, no-network) draft save
    // before flipping _saveStatus to 'saving' and kicking off the debounced
    // DB save — awaiting it here lets that prefix actually run. The
    // debounced save itself doesn't fire for another 1000ms and needs a
    // reachable Supabase project (not available in this sandbox), which is
    // fine — that's a separate concern from whether the flag flips
    // correctly the moment local input happens.
    await Sync.onLocalInput();
    const afterSyncPrefix = Sync.hasUnsavedChanges();

    Sync.destroySync();
    const afterDestroy = Sync.hasUnsavedChanges();

    return { before, afterSyncPrefix, afterDestroy };
  });

  expect(result.before).toBe(false);
  expect(result.afterSyncPrefix).toBe(true);
  expect(result.afterDestroy).toBe(false);
});
