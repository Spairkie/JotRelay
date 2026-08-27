// JotRelay – ask-ai.js
// Thin client for the ask-ai Supabase Edge Function (see
// supabase/functions/ask-ai/README.md) — proxies a text-transform request
// to Gemini's free tier so the app can offer AI assistance without any end
// user needing their own API key. No DOM here; src/app/ask-ai.js owns the
// selection/consent/UI flow and calls into this.

import { getSupabaseClient } from './supabase.js';

/**
 * @param {string} text        the user's current selection — never the whole note
 * @param {string} instruction short freeform instruction, e.g. "Fix grammar"
 * @returns {Promise<string>}  the AI's plain-text/Markdown result
 */
export async function askAi(text, instruction) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.functions.invoke('ask-ai', { body: { text, instruction } });

  if (error) {
    // Mirrors admin/cleanup-tab.js's own FunctionsFetchError handling — the
    // most common failure mode for an optional Edge Function is simply that
    // it was never deployed to this Supabase project.
    const isUnreachable = error?.name === 'FunctionsFetchError'
      || /failed to send a request/i.test(error?.message || '');
    if (isUnreachable) {
      throw new Error('Ask AI isn\'t set up for this JotRelay instance yet (the ask-ai Edge Function hasn\'t been deployed).');
    }
    // A non-2xx response comes back as a FunctionsHttpError whose own
    // .message is just the generic "Edge Function returned a non-2xx status
    // code" — not the actual reason. supabase-js attaches the raw Response
    // as .context, which is exactly the JSON body ask-ai/index.ts sent
    // ({ error: "..." } — e.g. a missing GEMINI_API_KEY secret, the rate
    // limit, or Gemini's own error) — read that instead of surfacing the
    // generic wrapper text to the user.
    if (error?.context && typeof error.context.json === 'function') {
      let detail = null;
      try { detail = (await error.context.clone().json())?.error || null; } catch {}
      if (detail) throw new Error(detail);
    }
    throw new Error(error.message || 'Ask AI request failed.');
  }
  if (data?.error) throw new Error(data.error);
  if (typeof data?.result !== 'string' || !data.result.trim()) throw new Error('Ask AI returned an empty result.');
  return data.result;
}
