import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// "Ask AI" — proxies a small text-transform request (selected note text +
// a user instruction) to Google's Gemini API, so the app can offer an AI
// assist without any end user needing their own API key. The Gemini key
// lives only in this function's environment (GEMINI_API_KEY), never in
// shipped client JS — same shape as syncpad-cleanup's service-role secret,
// see that function's own header comment for the CORS rationale reused
// here verbatim (the browser calls this function directly, cross-origin).
//
// Deliberately selection-only: the client only ever sends the user's
// current text selection, not the whole note (see src/app/ask-ai.js) —
// TEXT_MAX below is a hard server-side backstop for that, independent of
// src/templates.js's much larger BODY_MAX.

const TEXT_MAX = 8000;
const INSTRUCTION_MAX = 500;
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Best-effort caller identity for rate-limiting only — not an auth
// boundary (this function has none; see the README's "Anonymous & shared
// key" section for why that's consistent with the rest of the app). Falls
// back to null (never blocks) exactly like the existing rate-limit helper
// already does for a null identifier — see 0010_anonymous_write_rate_limiting.sql.
function callerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}

// Reuses the same syncpad_rate_limit_log table / syncpad_rate_limit_exceeded()
// helper the room-create and room-report triggers already use (see
// supabase/migrations/0010_anonymous_write_rate_limiting.sql) rather than
// inventing a second abuse-protection mechanism — just a new `action` value
// on the same shared log. This is an extra guard on top of Gemini's own
// free-tier quota, protecting the shared key from a single client hammering
// this endpoint directly (nothing stops a request that bypasses the app's
// UI entirely, since this function has no auth check of its own).
async function checkAndLogRateLimit(sb: SupabaseAdminClient, ip: string | null): Promise<boolean> {
  if (!ip) return true; // no identifiable caller — fail open, matching the SQL helper's own null-identifier behavior
  const identifier = `ip:${ip}`;
  const { data: exceeded } = await sb.rpc('syncpad_rate_limit_exceeded', {
    p_action: 'ask_ai',
    p_identifier: identifier,
    p_max_count: 20,
    p_window_minutes: 15,
  });
  if (exceeded) return false;
  await sb.from('syncpad_rate_limit_log').insert({ action: 'ask_ai', identifier });
  return true;
}

type SupabaseAdminClient = SupabaseClient<any, 'public', 'public', any, any>;

async function callGemini(text: string, instruction: string): Promise<string> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const prompt = [
    'You are a writing assistant embedded in a plain-text/Markdown notepad.',
    'Apply the instruction to the selected text and reply with ONLY the resulting',
    'text/Markdown — no preamble, no explanation, no surrounding quotes or code fences',
    'unless the result is itself a code block.',
    '',
    `Instruction: ${instruction}`,
    '',
    'Selected text:',
    text,
  ].join('\n');

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    },
  );

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Gemini API error (${resp.status}): ${detail.slice(0, 300)}`);
  }

  const data = await resp.json();
  const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ?? '';
  if (!out.trim()) throw new Error('Gemini returned an empty response.');
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  try {
    const body = await req.json().catch(() => ({})) as { text?: string; instruction?: string };
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    const instruction = typeof body.instruction === 'string' && body.instruction.trim()
      ? body.instruction.trim()
      : 'Improve the clarity and correctness of this text without changing its meaning.';

    if (!text) return json({ error: 'text is required' }, 400);
    if (text.length > TEXT_MAX) return json({ error: `text exceeds the ${TEXT_MAX}-character selection limit` }, 400);
    if (instruction.length > INSTRUCTION_MAX) return json({ error: `instruction exceeds ${INSTRUCTION_MAX} characters` }, 400);

    const sb = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    if (!(await checkAndLogRateLimit(sb, callerIp(req)))) {
      return json({ error: 'Too many AI requests — please wait a few minutes and try again.' }, 429);
    }

    const result = await callGemini(text, instruction);
    return json({ result });
  } catch (err) {
    console.error('[ask-ai]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
