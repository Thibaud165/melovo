// Historique d'écoute : enregistre les lectures et renvoie les récents
// (sons + playlists) pour l'accueil mobile.
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../lib/util.js';
import { canAccessSong, serializeSong } from '../lib/songs.js';

const router = Router();
router.use(requireAuth);

// Enregistre une lecture (son ou playlist). Silencieux si accès invalide.
router.post('/', (req, res) => {
  const kind = req.body?.kind;
  const id = Number(req.body?.id);
  if (!['song', 'playlist'].includes(kind) || !Number.isInteger(id)) {
    return res.status(400).json({ error: 'Requête invalide.' });
  }
  const uid = req.session.userId;
  if (kind === 'song' && !canAccessSong(id, uid)) return res.json({ ok: true });
  db.prepare('INSERT INTO play_events (user_id, kind, ref_id) VALUES (?, ?, ?)').run(uid, kind, id);
  // On borne l'historique aux 300 derniers événements par utilisateur.
  db.prepare(`
    DELETE FROM play_events WHERE user_id = @uid AND id NOT IN (
      SELECT id FROM play_events WHERE user_id = @uid ORDER BY played_at DESC, id DESC LIMIT 300
    )`).run({ uid });
  res.json({ ok: true });
});

// Récents pour l'accueil : 5 derniers sons + 6 dernières playlists (distincts).
router.get('/recent', (req, res) => {
  const uid = req.session.userId;

  const songRows = db.prepare(`
    SELECT s.*, u.username AS owner_name, MAX(pe.played_at) AS last_played
    FROM play_events pe
    JOIN songs s ON s.id = pe.ref_id
    JOIN users u ON u.id = s.owner_id
    WHERE pe.user_id = ? AND pe.kind = 'song'
    GROUP BY s.id ORDER BY last_played DESC LIMIT 15
  `).all(uid);
  const songs = songRows
    .filter((r) => canAccessSong(r.id, uid))
    .slice(0, 5)
    .map((r) => serializeSong(r, uid));

  const plRows = db.prepare(`
    SELECT p.*, u.username AS owner_name, MAX(pe.played_at) AS last_played,
           (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
    FROM play_events pe
    JOIN playlists p ON p.id = pe.ref_id
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.user_id = @uid
    WHERE pe.user_id = @uid AND pe.kind = 'playlist'
      AND (p.owner_id = @uid OR ps.user_id IS NOT NULL)
    GROUP BY p.id ORDER BY last_played DESC LIMIT 6
  `).all({ uid });
  const playlists = plRows.map((p) => ({
    id: p.id,
    name: p.name,
    owner_name: p.owner_name,
    track_count: p.track_count,
    cover_url: p.cover_path ? `/media/playlist-covers/${p.cover_path}` : null,
    bg_color: p.bg_color,
  }));

  res.json({ songs, playlists });
});

export default router;
