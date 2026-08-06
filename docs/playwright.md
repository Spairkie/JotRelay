# SyncPad Playwright Test Guide

This document covers everything you need to run, understand, and extend the SyncPad Playwright test suite.

---

## 1. Prerequisites & Quick Start

**Requirements**

- Node.js 18 or later
- npm

**First-time setup**

```bash
# 1. Install dependencies (includes @playwright/test)
npm install

# 2. Install Playwright browser binaries
npx playwright install

# 3. Run the full test suite — this alone is enough; Playwright starts
#    tests/spa-server.js on port 5555 automatically if nothing is
#    already listening there (see webServer in playwright.config.js)
npm test
```

You don't need to manually start a server first — `npm test` does it for you. If you want a server running yourself (e.g. to poke around in the app between test runs), either `npm run serve` or `node tests/spa-server.js` in a separate terminal both work — `reuseExistingServer` is enabled locally, so Playwright will attach to whichever is already running on port 5555 instead of spawning its own. Both give `/SyncPad/*` routes SPA fallback to `index.html` (`npm run serve`'s `npx serve .` picks up the rewrite rule in `serve.json`); a plain `npx serve .` run from somewhere that rewrite isn't visible (a different working directory, or the file deleted) won't have it, and will 404 on every route but the bare landing screen.

---

## 2. Running Tests

| Command | Description |
|---|---|
| `npm test` | Run all tests against the active browser project(s) — Chromium only by default, headless |
| `npm run test:chrome` | Run all tests in Chromium only |
| `npm run test:headed` | Run tests with the browser window visible |
| `npm run test:ui` | Launch Playwright's interactive UI mode |
| `npm run test:report` | Open the last HTML report in your browser |
| `npm run serve` (or `node tests/spa-server.js`) | Start a server on port 5555 manually (optional — `npm test` starts one automatically) |

You can also pass Playwright flags directly through `npx`:

```bash
# Run a single spec file
npx playwright test tests/editor.spec.js

# Run tests matching a title substring
npx playwright test -g "word count"

# Run only webkit
npx playwright test --project=webkit
```

---

## 3. Browser Projects

`playwright.config.js` defines four browser configurations, but **only `chromium` is active by default** — `npm test`/`npm run test:chrome` both currently mean "Chromium only." The other three are present but commented out in the `projects` array so `npm test` works out of the box without a full Playwright browser download (`npx playwright install` only fetches Chromium by default). Uncomment the ones you want in `playwright.config.js` and run `npx playwright install` again to pull their binaries before using `--project=firefox`/`webkit`/`mobile-chrome` — passing one of those flags while its project is still commented out fails with "no tests found," not a browser-not-installed error, which is the confusing part if you haven't looked at the config first.

| Project | Device preset | Notes |
|---|---|---|
| `chromium` | Desktop Chrome | Primary desktop target — active by default |
| `firefox` | Desktop Firefox | Gecko engine coverage — commented out by default |
| `webkit` | Desktop Safari | WebKit engine coverage — commented out by default |
| `mobile-chrome` | Pixel 5 | Mobile viewport and touch behaviour — commented out by default |

**CI behaviour:** When `process.env.CI` is set, Playwright enables `retries: 2` (each failing test is retried up to twice before being marked as failed) and limits workers to 1 to avoid resource contention. `forbidOnly` is also enabled in CI so accidentally committed `test.only` calls cause the run to fail immediately.

`fullyParallel: true` means individual spec files run in parallel with each other. Tests within a single file run serially by default.

---

## 4. Test File Overview

All spec files live in `tests/`. Each file is focused on a single area of the application. There are 28 spec files today.

| File | What it tests |
|---|---|
| `accessibility.spec.js` | Keyboard navigation, ARIA roles, focus management, and the custom confirm dialog |
| `admin.spec.js` | Admin dashboard: route, login form, unauthenticated access denial, pagination, stats |
| `command-palette.spec.js` | Command palette open/close, filtering, keyboard navigation, and the `Ctrl+K` context split between "insert link" (in the editor) and "open the palette" (elsewhere) |
| `comments.spec.js` | Comments — the merged cursor-chat + comments feature: the Comments panel composer, the floating add-comment composer, margin dots, the floating bubble, and Prev/Next comment navigation |
| `dialogs.spec.js` | `showPrompt()`, focus trapping in modals, and other dialog-related keyboard/accessibility improvements |
| `editor-context-menu.spec.js` | Right-click context menu: clipboard (Cut/Copy/Paste), selection (Select all/Delete), Add comment, and read-only viewers' reduced item set |
| `editor-modes.spec.js` | Editor mode switching (Source/Live/Split) and CSS class correctness — note Live is the default for fresh rooms, not Source |
| `editor.spec.js` | Core editor: textarea input, word count, Source/Live/Split mode switching, the CM6 live surface, auto-pair, smart punctuation, Focus mode, Typewriter mode, export actions |
| `export.spec.js` | Export and copy behavior: empty-note warning toasts, file downloads, copy to clipboard |
| `files.spec.js` | File attachments: multi-file upload, bulk select/delete, and download-filename correctness |
| `history.spec.js` | Version history: opening the panel, the empty state, the snapshot-before-Clear-note → Restore round trip, and the scrubber slider |
| `landing-demo.spec.js` | The coded interactive hero demo on the landing page: scene navigation, autoplay pause/resume, reduced motion, offscreen/hidden-tab pausing, no backend calls |
| `landing.spec.js` | Landing page: rendering, "New room" navigation, "Join room" navigation, recent-rooms list, active-section nav highlighting |
| `live-editor-rendering.spec.js` | The CM6-backed Live/Split surface's own rendering path (separate from `markdown.js`'s static renderer): GFM tables, GitHub-style alerts, footnotes, fenced-code syntax highlighting |
| `markdown.spec.js` | The static `renderMarkdown()` renderer: headings, bold, italic, code, links, checklists, tables of contents, highlight/`==mark==`, XSS safety |
| `read-only.spec.js` | Read-only share link behavior: `?mode=read` and `/share/:token`, editor disabled, no upload/delete, unlocking passcode/encrypted rooms while staying read-only |
| `remote-selection.spec.js` | A remote collaborator's selection renders as a highlighted span (not just a caret) in the CM6 live surface, and Devices panel "Follow" mode |
| `room-errors.spec.js` | Room load error states, the retry button, multi-room navigation, and offline reconnect reconciliation |
| `room-title.spec.js` | Inline room-title editing |
| `routing.spec.js` | URL routing: `/`, `/admin`, `/contact`, `/privacy`, `/terms`, arbitrary room IDs, single screen visible at a time, browser Back/Forward |
| `search.spec.js` | Find & Replace panel: `Ctrl+F` to open, match count, Next/Prev cycling, Replace/Replace All, case-sensitive toggle |
| `settings.spec.js` | Settings panel: expiration presets, theme picker, paste-stripping toggle, view-once, device limit, editing lock, file sort |
| `short-room-code.spec.js` | Short, human-typeable/speakable room codes — an alternate spelling of the editable room link, generated on demand in the Share modal |
| `shortcuts.spec.js` | Keyboard shortcuts, verified in both the plain Write textarea and the CM6 live surface, including the `Alt+Shift` combos |
| `slash-menu.spec.js` | The `/`-triggered quick-insert menu in Source mode |
| `templates-custom.spec.js` | Custom template CRUD — save, rename (`showPrompt`), delete (`showConfirm`) |
| `templates.spec.js` | Templates modal: open, tab switching, insert, search/filter, save-as-template |
| `utils.spec.js` | Unit tests via `inBrowser()`: `escapeHtml`, `formatFileSize`, `countWords`, `TEMPLATES`/`BODY_MAX`, `getTemplate`, `importCustomTemplates`/`exportCustomTemplates`, `renderMarkdown` XSS safety, `toggleChecklistItem` |

---

## 5. Helper Utilities

Shared helpers live in `tests/helpers.js` and are imported by all spec files. Use them instead of duplicating navigation or interaction logic.

| Function | Signature | Description |
|---|---|---|
| `goToLanding` | `(page) => Promise<void>` | Navigates to `/SyncPad/` and waits for `#landing-screen` to be visible. |
| `supabaseAvailable` | `(page) => Promise<boolean>` | Detects whether the Supabase JS CDN loaded (`window.supabase`). Use to skip a test cleanly in a network-blocked environment instead of timing out. |
| `createRoom` | `(page) => Promise<string>` | Calls `goToLanding`, skips the test if Supabase isn't reachable, clicks `.landing-create-btn`, waits for `#app-screen`, and returns the room ID extracted from the URL. |
| `ensureWriteMode` | `(page) => Promise<void>` | Switches to Source/Write mode if `#note-editor` is currently hidden. Fresh rooms default to Live/Preview mode (see `_resolveInitialEditorMode()` in `src/app/state.js`), where the plain textarea is hidden and Playwright's actionability checks (`.click()`, `.fill()`) will hang until timeout without this. No-ops if Write mode is already active. |
| `typeInEditor` | `(page, text, options?) => Promise<void>` | Calls `ensureWriteMode`, clicks `#note-editor`, optionally clears it (`clear: true` by default), then fills it with `text`. |
| `getEditorContent` | `(page) => Promise<string>` | Returns the current value of `#note-editor` (works regardless of which mode is active — reading `.inputValue()` doesn't require visibility). |
| `openPanel` | `(page, panelId) => Promise<void>` | Opens the side panel with the given ID if it is not already open. Tries the mobile action-bar button first, then the desktop button behind the More dropdown, then falls back to `[aria-controls]`/`[data-panel]`. |
| `openMoreMenu` | `(page) => Promise<void>` | Opens the header's "More" dropdown (parent of several desktop-only panel/action buttons: Tools, Files, Devices, Settings, Export, Share). |
| `setEditorMode` | `(page, mode) => Promise<void>` | Switches to `'write'` / `'preview'` / `'split'` via the segmented mode control and waits for `.editor-wrap` to carry the matching `mode-*` class. |
| `openSettingsPanel` | `(page) => Promise<void>` | Opens the Settings panel via the more-menu. |
| `waitForToast` | `(page, textOrPattern, options?) => Promise<void>` | Waits for a `.toast` element containing the given text or pattern to become visible. Default timeout is 5 000 ms. |
| `waitForModal` | `(page, id, timeout?) => Promise<void>` | Waits for `#<id>.visible` to appear. |
| `closeModal` | `(page, id) => Promise<void>` | Closes a modal by clicking its visible close/cancel button, trying several common selector patterns. |
| `closePanels` | `(page) => Promise<void>` | Clicks `#panel-backdrop` to dismiss any open panel, but only if the backdrop is currently visible. |
| `roomIdFromUrl` | `(url: string) => string` | Pure function. Parses a SyncPad URL and returns the room ID segment, or an empty string if the URL does not match. |
| `fillPromptDialog` | `(page, value) => Promise<void>` | Fills and confirms the app's custom `UI.showPrompt()` modal (`#sp-prompt-modal` / `#sp-prompt-input` / `#sp-prompt-ok`). **The app never uses the browser's native `window.prompt()`** — `page.once('dialog', ...)` will never fire for it. Use this instead. |
| `getShareUrl` | `(page, type?) => Promise<string>` | Opens the Share modal, reads the `'editable'` (default) or `'readonly'` link, closes the modal, and returns the URL. |

---

## 6. The `inBrowser()` Pattern

### What it does

`inBrowser()` is a local helper defined in `utils.spec.js` that lets you import a SyncPad ESM module inside the browser context and call one of its exported functions, with the result serialised back to Node.js.

```js
async function inBrowser(page, modulePath, fn) {
  return page.evaluate(
    async ({ path, fnStr }) => {
      const mod = await import(path);
      const fn = new Function('mod', `return (${fnStr})(mod)`);
      return fn(mod);
    },
    { path: modulePath, fnStr: fn.toString() }
  );
}
```

### When to use it

Use `inBrowser()` when you want to unit-test a pure utility function that lives in an ESM module. Because SyncPad's source files use `import`/`export`, they cannot be required directly in Node.js without a bundler. Running the function inside `page.evaluate` lets the browser's native ES module loader handle the import.

Do not use `inBrowser()` for tests that involve DOM interaction or real user flows — use the standard Playwright locator API for those.

### Example

```js
import { test, expect } from '@playwright/test';
import { createRoom } from './helpers.js';

async function inBrowser(page, modulePath, fn) {
  return page.evaluate(
    async ({ path, fnStr }) => {
      const mod = await import(path);
      const fn = new Function('mod', `return (${fnStr})(mod)`);
      return fn(mod);
    },
    { path: modulePath, fnStr: fn.toString() }
  );
}

test('escapeHtml escapes angle brackets', async ({ page }) => {
  // createRoom navigates to a SyncPad page so that /SyncPad/src/utils.js
  // is on the same origin and can be imported.
  await createRoom(page);

  const result = await inBrowser(page, '/SyncPad/src/utils.js', (mod) =>
    mod.escapeHtml('<b>hello</b>')
  );

  expect(result).toBe('&lt;b&gt;hello&lt;/b&gt;');
});
```

**Important:** `createRoom(page)` must be called before `inBrowser()` so that the page is on the `http://localhost:5555` origin. The dynamic `import()` inside `page.evaluate` will fail with a cross-origin error if the page is on a different origin.

The function passed to `inBrowser()` is serialised with `.toString()` and reconstructed with `new Function` inside the browser. It must therefore be a self-contained expression that takes a single argument (`mod`, the imported module object) and returns a serialisable value. Closures over outer variables will not work.

---

## 7. Writing New Tests

### Conventions

- **Always call `createRoom(page)` before interacting with the app.** Tests that navigate to the editor must start from a fresh room. Tests that only need the landing page can call `goToLanding(page)` instead.
- **Use helpers from `tests/helpers.js`** for common actions (opening panels, typing, reading editor content, waiting for toasts). This keeps tests short and avoids duplicated selectors.
- **Group related tests with `test.describe`.** Use a descriptive label that matches the feature or user action, for example `test.describe('Replace All', () => { … })`.
- **Prefer semantic selectors.** Target elements by their `id`, `role`, `aria-label`, or stable class names rather than positional CSS selectors.
- **Keep each test focused.** One logical behaviour per test makes failures easy to diagnose.

### Basic test structure

```js
import { test, expect } from '@playwright/test';
import { createRoom, typeInEditor, waitForToast } from './helpers.js';

test.describe('My Feature', () => {
  test('does something useful', async ({ page }) => {
    await createRoom(page);

    // Arrange: put the app into the required state
    await typeInEditor(page, 'Hello world');

    // Act: perform the action under test
    await page.click('#my-feature-button');

    // Assert: verify the expected outcome
    await waitForToast(page, 'Success');
    await expect(page.locator('#result')).toHaveText('Hello world');
  });
});
```

---

## 8. Adding Tests for a New Feature

Follow these steps when adding coverage for a new feature.

**Step 1 — Create the spec file**

Name the file after the feature area: `tests/<feature>.spec.js`. Import from `@playwright/test` and from `./helpers.js`.

```js
import { test, expect } from '@playwright/test';
import { createRoom, openPanel } from './helpers.js';
```

**Step 2 — Navigate to the right starting point**

Almost every test needs a room. Call `createRoom(page)` at the start of each test (or in a `test.beforeEach` block if every test in the describe group needs it).

```js
test.beforeEach(async ({ page }) => {
  await createRoom(page);
});
```

**Step 3 — Open the relevant panel or modal**

If your feature lives in a side panel, use `openPanel(page, 'panel-id')`. Check the panel's HTML `id` attribute in the application source.

```js
await openPanel(page, 'settings-panel');
```

**Step 4 — Pick locators**

Use Playwright's recommended locator strategies in this order of preference:

| Preferred | Example |
|---|---|
| `getByRole` | `page.getByRole('button', { name: 'Save' })` |
| `getByLabel` | `page.getByLabel('Room name')` |
| `getByText` | `page.getByText('No results')` |
| `locator` by id | `page.locator('#export-modal')` |
| `locator` by class | `page.locator('.toast')` |

Avoid selecting by position (`:nth-child`) or by implementation-specific class names that are likely to change.

**Step 5 — Assert with `expect`**

Use the built-in Playwright assertions which automatically retry until the condition is met or the timeout is reached:

```js
await expect(page.locator('#word-count')).toHaveText('3 words');
await expect(page.locator('#export-modal')).toBeVisible();
await expect(page.locator('#theme-toggle')).toHaveClass(/dark/);
```

**Step 6 — Run your new spec**

```bash
npx playwright test tests/myfeature.spec.js --headed
```

Review failures in the terminal or open the HTML report with `npm run test:report`.

---

## 9. CI Integration

The configuration in `playwright.config.js` detects CI automatically via `process.env.CI`:

```js
forbidOnly: !!process.env.CI,   // fail immediately if test.only is present
retries:    process.env.CI ? 2 : 1,  // 1 retry locally, up to 2 in CI
workers:    1,  // always single-worker, in CI and locally — avoids saturating shared Supabase API limits
```

The `webServer` block tells Playwright to start the SPA-aware static server before the test run:

```js
webServer: {
  command: 'node tests/spa-server.js',
  url: 'http://localhost:5555/SyncPad/',
  reuseExistingServer: !process.env.CI,
  timeout: 10_000,
}
```

`tests/spa-server.js` serves the repo at `/SyncPad/` (matching the GitHub Pages deployment path `index.html` hardcodes as `window.SYNCPAD_CONFIG.basePath`) with SPA fallback to `index.html`, so every in-app route resolves the same way it does in production — `serve.json` gives plain `npx serve .` (what `npm run serve` runs) the identical rewrite. CI uses the dedicated script rather than `npx serve` mainly so there's no dependency on `serve.json` being picked up correctly from whatever directory the CI runner invokes it from. In CI, `reuseExistingServer` is `false`, so Playwright always spawns a fresh server and tears it down after the run, preventing port conflicts from a previous failed run.

**Artifacts:** On failure, Playwright saves screenshots and videos to `test-results/` and writes a full HTML report to `playwright-report/`. Configure your CI pipeline to upload these directories as job artifacts so you can inspect failures without re-running the suite.

---

## 10. Debugging

### Headed mode

Run tests with a visible browser window to watch interactions in real time:

```bash
npm run test:headed

# Or for a single file
npx playwright test tests/editor.spec.js --headed
```

### UI mode

Playwright's interactive UI lets you step through tests, see a timeline of actions, and re-run individual tests with a click:

```bash
npm run test:ui
```

### Trace viewer

When a test fails after a retry, Playwright records a trace (configured via `trace: 'on-first-retry'` in `playwright.config.js`). Open the trace for a specific test:

```bash
npx playwright show-trace test-results/<test-folder>/trace.zip
```

The trace viewer shows a full timeline of every action, DOM snapshots, network requests, and console output.

### Screenshots and videos

The config sets `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'`. After a failed run, find these files under `test-results/`. Open the HTML report for a structured view:

```bash
npm run test:report
```

### Slowdown and pause

To slow down test execution (useful when debugging timing issues) or pause at a specific line, use Playwright's built-in helpers inside your test:

```js
// Slow every action by 500 ms — pass via CLI instead:
// npx playwright test --headed --slowmo=500

// Pause and open the Playwright inspector at this point
await page.pause();
```

`page.pause()` only works in headed or UI mode and has no effect in headless CI runs.
