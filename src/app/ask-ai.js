// JotRelay – app/ask-ai.js
// "Ask AI": sends the current text selection — and only the selection,
// never the rest of the note — plus a short user instruction to the ask-ai
// Edge Function (src/ask-ai.js), then adds the result as an anchored
// comment on that selection (same pipeline as the regular comments
// feature) rather than replacing the selected text. A one-time consent
// notice is shown before the first call in this browser, since selected
// text leaves the device to a third-party service.

import * as UI from '../ui.js';
import { canEdit, editBlockedReason } from '../permissions.js';
import { askAi } from '../ask-ai.js';
import { _currentSelectionRange, _submitComment } from './comments-preview.js';
import { state } from './state.js';

const CONSENT_KEY = 'syncpad_ai_consent_ack';

// A soft pre-trim only — keeps an absurdly long AI answer from becoming an
// enormous comment. _submitComment() (comments-preview.js) owns the actual
// guarantee against syncpad_room_comments_text_len_check (it re-checks the
// real post-encryption stored length and shrinks further if needed), since
// a plaintext character count here can't reliably predict that: AES-GCM's
// IV/tag + base64 overhead, and non-ASCII text's larger UTF-8-bytes-per-
// character ratio, both inflate the stored value unpredictably.
const COMMENT_TEXT_SAFE_MAX = 2500;
const AI_COMMENT_PREFIX = '✨ Ask AI:\n\n';

function _hasConsented() {
  try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; }
}
function _recordConsent() {
  try { localStorage.setItem(CONSENT_KEY, '1'); } catch {}
}

export async function _runAskAi() {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }

  // _currentSelectionRange() (comments-preview.js) already handles "which
  // surface is actually active" (plain textarea vs. the CM6 live proxy) —
  // reused rather than duplicated here, same as the regular "Add comment"
  // context-menu action does. UI.getEditorValue() is always the canonical,
  // up-to-date text regardless of which surface is visibly mounted (the
  // live surface only ever mirrors it).
  const range = _currentSelectionRange();
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) {
    UI.showToast('Select some text first, then Ask AI.', 'warning');
    return;
  }
  const selectedText = UI.getEditorValue().slice(range.from, range.to);
  if (!selectedText.trim()) {
    UI.showToast('Select some text first, then Ask AI.', 'warning');
    return;
  }
  // Captured before the consent dialog / instruction prompt / network round
  // trip below — a long chain of awaits a user can sit through while
  // navigating away (this is a live collaborative editor: switching rooms
  // mid-request is one click). `range` is meaningless outside the room it
  // was captured in, so if state.roomId has moved on by the time we're
  // about to write, the result must be discarded rather than landing an
  // out-of-context comment (wrong anchor offsets, wrong document) in
  // whatever room the user has since navigated to.
  const roomAtSelection = state.roomId;

  if (!_hasConsented()) {
    const ok = await UI.showConfirm(
      'Ask AI sends your selected text to a third-party AI service (Google Gemini) for processing. Its response is added as a comment on that selection — your note text is never changed. It never sends the rest of your note. Continue?',
      { confirmLabel: 'Continue', cancelLabel: 'Cancel' },
    );
    if (!ok) return;
    _recordConsent();
  }

  const instruction = await UI.showPrompt('What should AI do with the selected text?', {
    placeholder: 'e.g. Fix grammar, Summarize, Make more concise…',
    confirmLabel: 'Ask AI',
  });
  if (!instruction?.trim()) return;

  UI.showToast('Asking AI…', 'info');
  try {
    const result = await askAi(selectedText, instruction.trim());
    if (state.roomId !== roomAtSelection) {
      UI.showToast('You switched rooms — AI result discarded.', 'warning', 5000);
      return;
    }
    let commentText = AI_COMMENT_PREFIX + result;
    if (commentText.length > COMMENT_TEXT_SAFE_MAX) {
      commentText = commentText.slice(0, COMMENT_TEXT_SAFE_MAX);
      UI.showToast(`AI response trimmed to fit a comment (${COMMENT_TEXT_SAFE_MAX.toLocaleString()} characters).`, 'warning', 5000);
    }
    // _submitComment() (comments-preview.js) owns encryption, the
    // anchor-text snapshot, the actual insert, refreshing every comment
    // surface (panel/margin dots/floating bubble), and its own success/
    // failure toast — the same single entry point the Comments panel and
    // the right-click "Add comment" action already use.
    await _submitComment(commentText, range);
  } catch (err) {
    UI.showToast(err?.message || 'Ask AI failed. Please try again.', 'error', 5000);
  }
}
