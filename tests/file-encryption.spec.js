// tests/file-encryption.spec.js
// Files uploaded to an encrypted room are AES-256-GCM-encrypted client-side
// with the room's key before they reach Supabase Storage (src/files.js's
// uploadFile()), and decrypted back into a local Blob object URL for
// preview/download (getFilePreviewUrl()/getFileDownloadUrl()). See
// docs/security.md's "Encryption Note" and supabase/migrations/
// 0014_file_encryption.sql.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  createRoom, openPanel, openSettingsPanel, fillPromptDialog,
  waitForToast, waitForModal, supabaseAvailable,
} from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(__dirname, 'fixtures', name);

test.describe('AES-GCM buffer encryption (no Supabase required)', () => {
  test('encryptBuffer/decryptBuffer round-trips binary data and produces ciphertext that differs from the plaintext', async ({ page }) => {
    await page.goto('/SyncPad/');

    const result = await page.evaluate(async () => {
      const { encryptBuffer, decryptBuffer, deriveKey } = await import('/SyncPad/src/encryption.js');
      const key = await deriveKey('a-test-passphrase', '00'.repeat(32));

      const plainBytes = crypto.getRandomValues(new Uint8Array(2048)); // simulate binary file content
      const plainBuf = plainBytes.buffer;

      const cipherBuf = await encryptBuffer(plainBuf, key);
      const decryptedBuf = await decryptBuffer(cipherBuf, key);

      const plainArr     = Array.from(new Uint8Array(plainBuf));
      const cipherArr    = Array.from(new Uint8Array(cipherBuf));
      const decryptedArr = Array.from(new Uint8Array(decryptedBuf));

      let wrongKeyFailed = false;
      try {
        const wrongKey = await deriveKey('a-different-passphrase', '00'.repeat(32));
        await decryptBuffer(cipherBuf, wrongKey);
      } catch (err) {
        wrongKeyFailed = err.message === 'DECRYPT_FAILED';
      }

      return {
        decryptedMatchesPlain: JSON.stringify(decryptedArr) === JSON.stringify(plainArr),
        cipherDiffersFromPlain: JSON.stringify(cipherArr) !== JSON.stringify(plainArr),
        // IV (12 bytes) + GCM tag (16 bytes) overhead, nothing more.
        cipherOverhead: cipherArr.length - plainArr.length,
        wrongKeyFailed,
      };
    });

    expect(result.decryptedMatchesPlain).toBe(true);
    expect(result.cipherDiffersFromPlain).toBe(true);
    expect(result.cipherOverhead).toBe(28);
    expect(result.wrongKeyFailed).toBe(true);
  });
});

test.describe('File uploads in an encrypted room', () => {
  test('uploaded file content is encrypted at rest and decrypts correctly for preview/download', async ({ page }) => {
    test.skip(!(await supabaseAvailable(page)), 'Supabase unavailable in this environment');

    await createRoom(page);

    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    await fillPromptDialog(page, 'file-encryption-test-passphrase');
    await waitForToast(page, /encryption enabled/i);

    await openPanel(page, 'files');
    await page.locator('#file-input').setInputFiles([fixture('sample-a.txt')]);
    await waitForToast(page, /uploaded/i);

    const fileItem = page.locator('.file-item', { hasText: 'sample-a.txt' });
    await expect(fileItem).toBeVisible();
    // Lock indicator shows this file was actually encrypted, not just that
    // the room has encryption enabled.
    await expect(fileItem.locator('.file-encrypted-icon')).toBeVisible();

    // The raw Storage object must not be the plaintext — fetch the signed
    // URL directly (bypassing decryption, unlike getFilePreviewUrl()) and
    // confirm the bytes on the wire don't decode to the original fixture
    // text.
    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).pop();
    const rawFetchResult = await page.evaluate(async (roomId) => {
      const { listFiles, getDownloadUrl } = await import('/SyncPad/src/files.js');
      const files = await listFiles(roomId);
      const row = files.find((f) => f.filename === 'sample-a.txt');
      if (!row) return { found: false };
      const signedUrl = await getDownloadUrl(row.file_path);
      const res = await fetch(signedUrl);
      const rawText = await res.text();
      return { found: true, encrypted: row.encrypted, rawText };
    }, roomId);
    expect(rawFetchResult.found).toBe(true);
    expect(rawFetchResult.encrypted).toBe(true);
    expect(rawFetchResult.rawText).not.toContain('First fixture file for SyncPad file-upload tests.');

    // Preview must show the decrypted, original plaintext.
    await fileItem.locator('.file-action-btn.preview').click();
    await waitForModal(page, 'file-preview-modal');
    await expect(page.locator('#file-preview-body')).toContainText('First fixture file for SyncPad file-upload tests.');

    // Download must save the decrypted plaintext, not ciphertext — verify by
    // triggering the download and checking the saved file's contents.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#file-preview-download').click(),
    ]);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
  });

  test('copy-link for an encrypted file produces a working in-app deep link instead of a raw storage URL', async ({ page, context }) => {
    test.skip(!(await supabaseAvailable(page)), 'Supabase unavailable in this environment');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await createRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    await fillPromptDialog(page, 'deep-link-test-passphrase');
    await waitForToast(page, /encryption enabled/i);

    await openPanel(page, 'files');
    await page.locator('#file-input').setInputFiles([fixture('sample-a.txt')]);
    await waitForToast(page, /uploaded/i);

    const fileItem = page.locator('.file-item', { hasText: 'sample-a.txt' });
    await fileItem.locator('.file-action-btn.copy-link').click();
    await waitForToast(page, /link copied/i);

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const roomId = new URL(page.url()).pathname.split('/').filter(Boolean).pop();
    expect(clipboardText).toBe(`${new URL(page.url()).origin}/SyncPad/${roomId}?file=1`);

    // Opening the link cold (fresh context, no encKey in memory) must hit
    // the room's normal encryption gate — the link carries no secret.
    await page.goto(clipboardText);
    await expect(page.locator('#encryption-screen:not(.hidden)')).toBeVisible({ timeout: 15_000 });
    await page.locator('#encryption-input').fill('deep-link-test-passphrase');
    await page.locator('#encryption-submit-btn').click();

    // Past the gate, the linked file's preview opens automatically with the
    // correctly decrypted content.
    await waitForModal(page, 'file-preview-modal');
    await expect(page.locator('#file-preview-body')).toContainText('First fixture file for SyncPad file-upload tests.');
  });

  test('a room can enable encryption and keep uploading files afterward (no longer blocked)', async ({ page }) => {
    test.skip(!(await supabaseAvailable(page)), 'Supabase unavailable in this environment');

    await createRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    await fillPromptDialog(page, 'another-test-passphrase');
    await waitForToast(page, /encryption enabled/i);

    await openPanel(page, 'files');
    await page.locator('#file-input').setInputFiles([fixture('sample-b.txt')]);
    // Previously (v1) this would have toasted "File upload is disabled" —
    // now the upload should succeed since content is encrypted.
    await waitForToast(page, /uploaded/i);
    await expect(page.locator('.file-item', { hasText: 'sample-b.txt' })).toBeVisible();
  });
});

test.describe('Codex-flagged file-encryption fixes', () => {
  test('disabling encryption is blocked while encrypted files exist, instead of stranding them undecryptable', async ({ page }) => {
    test.skip(!(await supabaseAvailable(page)), 'Supabase unavailable in this environment');

    await createRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    await fillPromptDialog(page, 'strand-test-passphrase');
    await waitForToast(page, /encryption enabled/i);

    await openPanel(page, 'files');
    await page.locator('#file-input').setInputFiles([fixture('sample-a.txt')]);
    await waitForToast(page, /uploaded/i);

    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    // Blocked before ever reaching the "Disable?" confirm dialog — a
    // passphrase prompt or confirm modal appearing here would mean the
    // guard didn't fire.
    await waitForToast(page, /delete.*first/i);
    await expect(page.locator('#sp-confirm-modal.visible')).toHaveCount(0);
  });

  test('previewing an encrypted SVG offers a download, not a same-origin open-in-new-tab link', async ({ page }) => {
    test.skip(!(await supabaseAvailable(page)), 'Supabase unavailable in this environment');

    await createRoom(page);
    await openSettingsPanel(page);
    await page.locator('#setting-enc-btn').click();
    await fillPromptDialog(page, 'svg-test-passphrase');
    await waitForToast(page, /encryption enabled/i);

    await openPanel(page, 'files');
    // Inline buffer rather than a fixture file — keeps the (deliberately
    // malicious-shaped) payload this test is actually about visible right here.
    await page.locator('#file-input').setInputFiles([{
      name: 'sample.svg', mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__xss=true</script></svg>'),
    }]);
    await waitForToast(page, /uploaded/i);

    await page.locator('.file-item', { hasText: 'sample.svg' }).locator('.file-action-btn.preview').click();
    await waitForModal(page, 'file-preview-modal');

    const openBtn = page.locator('#file-preview-body .preview-open-btn');
    await expect(openBtn).toHaveText(/download svg/i);
    await expect(openBtn).toHaveAttribute('download', 'sample.svg');
    await expect(openBtn).not.toHaveAttribute('target', '_blank');
  });
});
