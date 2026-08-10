// JotRelay – comments.js
// Ephemeral comments anchored to a text range in a room's note
// (syncpad_room_comments, see supabase/migrations/0003_room_comments.sql).
//
// `text` and `anchor_text` here are exactly what would be written for an
// encrypted room's content — ciphertext, encrypted by the caller with the
// same room key — so this module has no separate encryption handling of
// its own, same as revisions.js. anchor_text is a snapshot of the anchored
// text at creation time, used by the caller to detect and auto-delete a
// comment whose anchored text has since been removed (see
// app/comments-preview.js's _pruneDeletedCommentAnchors()).

import { getSupabaseClient } from './supabase.js';
import { logSupabaseError, getDeviceId, getDeviceName } from './utils.js';

const TABLE = 'syncpad_room_comments';

// "Column doesn't exist" — thrown when a project has run
// 0003_room_comments.sql but not yet the later, separate
// 0013_comment_anchor_text.sql. Falling back to the pre-0013 column set
// keeps the base comments feature (view/add/delete/thread) working on such
// a project instead of breaking it outright the moment the client updates;
// only the auto-delete-on-text-removal enhancement stays inert until the
// migration is run, matching every other optional-migration feature's
// "silently no-op until its migration runs" convention (see DEPLOYMENT.md).
//
// Two different codes for the same underlying problem, depending on which
// operation hits it: a SELECT naming an unknown column reaches Postgres
// itself, which reports its own "undefined_column" code, 42703. An INSERT
// naming an unknown column in the payload is instead rejected by
// PostgREST's own schema-cache validation *before* any SQL runs, which
// reports its own, differently-coded error, PGRST204 ("Could not find the
// '<col>' column ... in the schema cache") — confirmed against this
// project's live database, where listComments()'s SELECT fallback below
// was already correctly triggering on 42703 while addComment()'s INSERT
// silently failed every time because it only ever saw PGRST204.
function _isMissingColumnError(error) {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

/** List comments for a room, oldest first (matches reading order in the note). */
export async function listComments(roomId) {
  const sb = getSupabaseClient();
  let { data, error } = await sb.from(TABLE)
    .select('id, anchor_from, anchor_to, text, anchor_text, device_id, device_name, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (_isMissingColumnError(error)) {
    ({ data, error } = await sb.from(TABLE)
      .select('id, anchor_from, anchor_to, text, device_id, device_name, created_at')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true }));
  }
  if (error) { logSupabaseError('listComments', error, { room_id: roomId }); throw error; }
  return data || [];
}

/**
 * @param {string} roomId
 * @param {{ anchorFrom: number, anchorTo: number, text: string, anchorText?: string }} comment
 */
export async function addComment(roomId, { anchorFrom, anchorTo, text, anchorText }) {
  const sb = getSupabaseClient();
  const base = {
    room_id:     roomId,
    anchor_from: Math.max(0, anchorFrom | 0),
    anchor_to:   Math.max(anchorFrom | 0, anchorTo | 0),
    text:        text || '',
    device_id:   getDeviceId(),
    device_name: getDeviceName(),
  };
  let { error } = await sb.from(TABLE).insert({ ...base, anchor_text: anchorText ?? null });
  if (_isMissingColumnError(error)) {
    ({ error } = await sb.from(TABLE).insert(base));
  }
  if (error) { logSupabaseError('addComment', error, { room_id: roomId }); throw error; }
}

export async function deleteComment(commentId) {
  const sb = getSupabaseClient();
  const { error } = await sb.from(TABLE).delete().eq('id', commentId);
  if (error) { logSupabaseError('deleteComment', error, { id: commentId }); throw error; }
}

export function subscribeToComments(roomId, onCommentsChange) {
  const sb = getSupabaseClient();
  const ch = sb.channel(`db-comments-${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE,
        filter: `room_id=eq.${roomId}` }, () => onCommentsChange())
    .subscribe();
  return () => sb.removeChannel(ch);
}
