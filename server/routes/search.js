// Recherche simple : mes titres (titre/artiste) + playlists accessibles (nom).
// + liste des utilisateurs (pour le dialogue de partage).
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../lib/util.js';
import { serializeSong } from '../lib/songs.js';

const router = Router();
router.use(requireAuth);

router.get('/search', (req, res) => {
  const uid = req.session.userId;
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (!q) return res.json({ songs: [], playlists: [] });
  // Échappe les jokers LIKE pour une recherche littérale.
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;

  const songs = db.prepare(`
    SELECT s.*, u.username AS owner_name FROM songs s
    JOIN users u ON u.id = s.owner_id
    WHERE s.owner_id = @uid AND (s.title LIKE @like ESCAPE '\\' OR s.artist LIKE @like ESCAPE '\\')
    ORDER BY s.title LIMIT 50
  `).all({ uid, like }).map((r) => serializeSong(r, uid));

  const playlists = db.prepare(`
    SELECT p.id, p.name, p.cover_path, p.bg_color, u.username AS owner_name,
           (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
    FROM playlists p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.user_id = @uid
    WHERE (p.owner_id = @uid OR ps.user_id IS NOT NULL) AND p.name LIKE @like ESCAPE '\\'
    ORDER BY p.name LIMIT 25
  `).all({ uid, like }).map((p) => ({
    id: p.id,
    name: p.name,
    owner_name: p.owner_name,
    track_count: p.track_count,
    cover_url: p.cover_path ? `/media/playlist-covers/${p.cover_path}` : null,
    bg_color: p.bg_color,
  }));

  res.json({ songs, playlists });
});

// Pseudos de tous les comptes (partage de playlist).
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username FROM users WHERE id != ? ORDER BY username')
    .all(req.session.userId);
  res.json({ users });
});

export default router;
