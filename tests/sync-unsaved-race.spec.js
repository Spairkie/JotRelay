// tests/sync-unsaved-race.spec.js
// Two Codex-flagged races in sync.js's save-status tracking (hasUnsavedChanges(),
// which drives app/pwa.js's beforeunload warning):
//   1. onLocalInput() awaited saveDraft()'s async encryption BEFORE marking
//      the edit unsaved — a tab closed during that window read as "saved"
//      despite a real in-flight edit.
//   2. A save already in flight when a newer edit arrives could complete
//      LATER and unconditionally overwrite the newer edit's 'saving' status
//      back to 'saved' (and clear its newer local draft), since debounce()
//      only guards the timer, not an already-running async body.
// Both exercised directly against the module — no real room/Supabase
// needed (see tests/comments.spec.js's "Comment threads" block for the
// same standalone-import pattern); saveContent() itself will fail (no
// reachable Supabase in this sandbox), which is fine — these tests only
// care about the synchronous status-tracking behavior around it.

import { test, expect } from '@playwright/test';

test('a generation bump mid-save prevents a stale completion from clobbering newer unsaved state', async ({ page }) => {
  await page.goto('/SyncPad/');
  const result = await page.evaluate(async () => {
    const Sync = await import('/SyncPad/src/sync.js');
    let value = 'first edit';
    Sync.initSync({
      roomId: 'test-room-race-check',
      getEditorVal: () => value,
      setEditorVal: (v) => { value = v; },
      onStatusChange: () => {},
    });

    // Edit 1: schedules a debounced save.
    await Sync.onLocalInput();
    const afterEdit1 = Sync.hasUnsavedChanges();

    // Force edit 1's debounced save to start executing NOW (synchronously
    // enters the async body and captures its own generation) — its
    // returned promise won't settle until the (failing, unreachable)
    // network call rejects, which is exactly the "still in flight" window
    // this test needs.
    const save1 = Sync.flushSave();

    // Edit 2 arrives while save 1 is still in flight — same tick, before
    // save 1's promise has had a chance to resolve/reject.
    value = 'second edit, newer than the in-flight save';
    await Sync.onLocalInput();
    const afterEdit2 = Sync.hasUnsavedChanges();

    // Let save 1 finish (it will fail — no reachable Supabase here).
    await save1;
    const afterStaleSaveSettles = Sync.hasUnsavedChanges();

    Sync.destroySync();
    return { afterEdit1, afterEdit2, afterStaleSaveSettles };
  });

  expect(result.afterEdit1).toBe(true);
  expect(result.afterEdit2).toBe(true);
  // The critical assertion: edit 1's stale completion must NOT have reset
  // the status to "saved" out from under edit 2, which is still genuinely
  // unsaved.
  expect(result.afterStaleSaveSettles).toBe(true);
});

test('hasUnsavedChanges() is already true mid-draft-save, before the debounced DB save is even scheduled', async ({ page }) => {
  await page.goto('/SyncPad/');
  const result = await page.evaluate(async () => {
    const Sync = await import('/SyncPad/src/sync.js');
    let value = 'x';
    Sync.initSync({
      roomId: 'test-room-encrypt-timing',
      getEditorVal: () => value,
      setEditorVal: (v) => { value = v; },
      onStatusChange: () => {},
    });

    const before = Sync.hasUnsavedChanges();
    // Don't await — checking hasUnsavedChanges() synchronously right after
    // calling onLocalInput() (before its internal saveDraft() await has
    // resolved) is exactly the "tab closes mid-encryption" scenario. If the
    // unsaved flag were still set AFTER that internal await (the pre-fix
    // ordering), this would read false here.
    const call = Sync.onLocalInput();
    const duringCall = Sync.hasUnsavedChanges();

    await call;
    Sync.destroySync();
    return { before, duringCall };
  });

  expect(result.before).toBe(false);
  expect(result.duringCall).toBe(true);
});

test('cancelPendingSave() resets hasUnsavedChanges() — a discarded room (remote clear/expiry/view-once) has nothing left to warn about', async ({ page }) => {
  await page.goto('/SyncPad/');
  const result = await page.evaluate(async () => {
    const Sync = await import('/SyncPad/src/sync.js');
    let value = 'content about to be discarded';
    Sync.initSync({
      roomId: 'test-room-cancel-reset',
      getEditorVal: () => value,
      setEditorVal: (v) => { value = v; },
      onStatusChange: () => {},
    });

    await Sync.onLocalInput();
    const beforeCancel = Sync.hasUnsavedChanges();

    // Every real call site (room-lifecycle.js's remote clear/expiry/
    // view-once/device-limit/encrypted-no-key handlers) pairs this with
    // wiping the content — nothing is actually left to save afterward.
    Sync.cancelPendingSave();
    const afterCancel = Sync.hasUnsavedChanges();

    Sync.destroySync();
    return { beforeCancel, afterCancel };
  });

  expect(result.beforeCancel).toBe(true);
  expect(result.afterCancel).toBe(false);
});
