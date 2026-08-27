# Ask AI Edge Function

Proxies a small text-transform request (selected note text + an instruction) to Google's Gemini API, so JotRelay can offer an "Ask AI" feature without any end user needing their own API key. The Gemini key lives only in this function's environment — never in shipped client JS.

## What It Does

- Accepts `{ text, instruction }` — `text` is the user's current **selection only** (the client never sends the whole note; see `src/ask-ai.js`), `instruction` is a short freeform instruction ("Fix grammar", "Summarize", "Make this more concise", etc.).
- Calls Gemini's `generateContent` REST API server-side and returns `{ result }`.
- Caps `text` at 8,000 characters and `instruction` at 500 characters, both enforced server-side regardless of what the client sends.

## Anonymous & Shared Key

JotRelay has no accounts for normal rooms, so this function has **no auth check of its own** — same posture as room creation and room reporting (see `supabase/migrations/0010_anonymous_write_rate_limiting.sql`). It reuses that same rate-limiting infrastructure (`syncpad_rate_limit_log` / `syncpad_rate_limit_exceeded()`, action `ask_ai`, keyed by caller IP, 20 requests / 15 minutes) as a guard against a single client hammering the shared Gemini key directly (nothing stops a request that bypasses the app's UI and calls this function's URL directly). This is an *additional* guard on top of whatever quota Gemini's own free tier enforces — it does not make the key itself secret from a determined caller, only rate-limited.

If this cost/abuse surface is a concern, treat it as a follow-up decision (e.g. requiring the request to carry a valid `room_id` that exists, or moving to authenticated-only) rather than something this function tries to solve on its own.

## Required Secrets

Supabase provides these to deployed Edge Functions automatically:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set these yourself:

```bash
supabase secrets set GEMINI_API_KEY="your-gemini-api-key"
# Optional — defaults to gemini-2.0-flash if unset. Override if Google
# renames/deprecates that model id without needing a code change.
supabase secrets set GEMINI_MODEL="gemini-2.0-flash"
```

Get a free-tier Gemini API key at https://aistudio.google.com/apikey — no credit card required for the free tier as of this writing, but verify current terms/limits before relying on it in production.

## Deploy

```bash
supabase functions deploy ask-ai --no-verify-jwt
```

## Invoke

```bash
curl -X POST "https://YOUR-PROJECT-REF.functions.supabase.co/ask-ai" \
  -H "Content-Type: application/json" \
  -d '{"text":"the note text goes here","instruction":"Summarize in one sentence."}'
```
