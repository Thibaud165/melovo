// Helpers partagés autour des chansons : sérialisation et contrôle d'accès.
import db from '../db.js';

/**
 * Un utilisateur peut voir/écouter une chanson s'il en est propriétaire
 * ou si elle figure dans une playlist qu'il possède ou qu'on lui a partagée.
 */
export function canAccessSong(songId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM songs s
    WHERE s.id = @songId AND (
      s.owner_id = @userId
      OR EXISTS (
        SELECT 1 FROM playlist_tracks pt
        JOIN playlists p ON p.id = pt.playlist_id
        LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.user_id = @userId
        WHERE pt.song_id = s.id AND (p.owner_id = @userId OR ps.user_id IS NOT NULL)
      )
    )
  `).get({ songId, userId });
}

/**
 * Sérialise une ligne `songs` (jointe avec le pseudo du propriétaire) pour l'API.
 * `in_library` : je possède ce titre, ou une copie exacte (même titre/artiste/durée)
 * — utile après « Enregistrer dans ma bibliothèque ».
 */
export function serializeSong(row, userId) {
  const inLibrary = row.owner_id === userId || !!db.prepare(`
    SELECT 1 FROM songs WHERE owner_id = ? AND title = ? AND artist IS ?
      AND ABS(duration_seconds - ?) < 1
  `).get(userId, row.title, row.artist, row.duration_seconds);
  return {
    id: row.id,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    title: row.title,
    artist: row.artist,
    cover_url: row.cover_path ? `/media/covers/${row.cover_path}` : null,
    audio_url: `/api/songs/${row.id}/audio`,
    duration_seconds: row.duration_seconds,
    source: row.source,
    created_at: row.created_at,
    in_library: inLibrary,
    is_mine: row.owner_id === userId,
  };
}

export const SONG_SELECT = `
  SELECT s.*, u.username AS owner_name
  FROM songs s JOIN users u ON u.id = s.owner_id
`;
