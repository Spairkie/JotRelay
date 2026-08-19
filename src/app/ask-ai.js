// JotRelay – app/ask-ai.js
// "Ask AI": sends the current text selection — and only the selection,
// never the rest of the note — plus a short user instruction to the ask-ai
// Edge Function (src/ask-ai.js), then replaces the selection with the
// result. A one-time consent notice is shown before the first call in this
// browser, since selected text leaves the device to a third-party service.

import * as UI from '../ui.js';
import * as LiveEditor from '../live-editor.js';
import { canEdit, editBlockedReason } from '../permissions.js';
import { askAi } from '../ask-ai.js';
import { BODY_MAX } from '../templates.js';
import { state } from './state.js';

const CONSENT_KEY = 'syncpad_ai_consent_ack';

function _hasConsented() {
  try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; }
}
function _recordConsent() {
  try { localStorage.setItem(CONSENT_KEY, '1'); } catch {}
}

// Mirrors _applyFormatToActiveSurface()'s (editor-behavior.js) surface
// resolution — Preview mode targets the CM6 live proxy, otherwise the plain
// textarea — but returns the current selection plus a replace() closure
// instead of applying a fixed formatting action, since Ask AI's replacement
// text isn't known until the network call returns.
function _activeSelection() {
  const useLive = LiveEditor.isMounted() && (state.markdownMode === 'preview' || LiveEditor.hasFocus());
  if (useLive) {
    const proxy = LiveEditor.asEditorProxy();
    if (!proxy) return null;
    const start = proxy.selectionStart ?? 0;
    const end   = proxy.selectionEnd ?? 0;
    return {
      text: proxy.value.slice(start, end),
      replace: (text) => {
        proxy.value = proxy.value.slice(0, start) + text + proxy.value.slice(end);
        proxy.selectionStart = start;
        proxy.selectionEnd   = start + text.length;
        proxy.dispatchEvent();
      },
    };
  }
  const editor = document.getElementById('note-editor');
  if (!editor) return null;
  const start = editor.selectionStart;
  const end   = editor.selectionEnd;
  return {
    text: editor.value.slice(start, end),
    replace: (text) => UI.replaceEditorRange(start, end, text, start, start + text.length),
  };
}

export async function _runAskAi() {
  if (!canEdit()) { UI.showToast(editBlockedReason() || 'Editing is disabled.', 'warning'); return; }

  const selection = _activeSelection();
  if (!selection || !selection.text.trim()) {
    UI.showToast('Select some text first, then Ask AI.', 'warning');
    return;
  }

  if (!_hasConsented()) {
    const ok = await UI.showConfirm(
      'Ask AI sends your selected text to a third-party AI service (Google Gemini) for processing. It never sends the rest of your note. Continue?',
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
    let text = await askAi(selection.text, instruction.trim());
    if (text.length > BODY_MAX) {
      text = text.slice(0, BODY_MAX);
      UI.showToast(`AI result trimmed to the ${BODY_MAX.toLocaleString()}-character limit.`, 'warning', 5000);
    }
    selection.replace(text);
    UI.showToast('AI result inserted.', 'success');
  } catch (err) {
    UI.showToast(err?.message || 'Ask AI failed. Please try again.', 'error', 5000);
  }
}
