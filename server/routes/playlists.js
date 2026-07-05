// Playlists : CRUD, pistes (ajout/retrait/réordonnancement), partage.
import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import db from '../db.js';
import { ah, requireAuth, cleanText, parseHexColor } from '../lib/util.js';
import { PLAYLIST_COVERS_DIR, TMP_DIR, processCover, safeUnlink } from '../lib/media.js';
import { canAccessSong, serializeSong } from '../lib/songs.js';

const router = Router();
router.use(requireAuth);

const coverUpload = multer({ dest: TMP_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

/** Rôle de l'utilisateur sur une playlist : 'owner' | 'edit' | 'view' | null. */
function getAccess(playlistId, userId) {
  const playlist = db.prepare(`
    SELECT p.*, u.username AS owner_name FROM playlists p
    JOIN users u ON u.id = p.owner_id WHERE p.id = ?
  `).get(playlistId);
  if (!playlist) return { playlist: null, role: null };
  if (playlist.owner_id === userId) return { playlist, role: 'owner' };
  const share = db.prepare('SELECT can_edit FROM playlist_shares WHERE playlist_id = ? AND user_id = ?')
    .get(playlistId, userId);
  if (!share) return { playlist, role: null };
  return { playlist, role: share.can_edit ? 'edit' : 'view' };
}

function serializePlaylist(p, role, userId) {
  const stats = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(s.duration_seconds), 0) AS total
    FROM playlist_tracks pt JOIN songs s ON s.id = pt.song_id WHERE pt.playlist_id = ?
  `).get(p.id);
  return {
    id: p.id,
    name: p.name,
    owner_id: p.owner_id,
    owner_name: p.owner_name,
    cover_url: p.cover_path ? `/media/playlist-covers/${p.cover_path}` : null,
    bg_color: p.bg_color,
    created_at: p.created_at,
    role: role ?? (p.owner_id === userId ? 'owner' : null),
    track_count: stats.count,
    total_duration: stats.total,
  };
}

// Mes playlists + celles partagées avec moi (pour la sidebar).
router.get('/', (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`
    SELECT p.*, u.username AS owner_name,
           CASE WHEN p.owner_id = @uid THEN 'owner'
                WHEN ps.can_edit = 1 THEN 'edit' ELSE 'view' END AS role
    FROM playlists p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN playlist_shares ps ON ps.playlist_id = p.id AND ps.user_id = @uid
    WHERE p.owner_id = @uid OR ps.user_id IS NOT NULL
    ORDER BY p.created_at DESC
  `).all({ uid });
  res.json({ playlists: rows.map((p) => serializePlaylist(p, p.role, uid)) });
});

// Création (nom obligatoire, pochette et couleur optionnelles).
router.post('/', coverUpload.single('cover'), ah(async (req, res) => {
  const name = cleanText(req.body?.name, 120);
  const bgColor = parseHexColor(req.body?.bg_color);
  if (!name) { if (req.file) await safeUnlink(req.file.path); return res.status(400).json({ error: 'Le nom est obligatoire.' }); }
  if (bgColor === undefined) { if (req.file) await safeUnlink(req.file.path); return res.status(400).json({ error: 'Couleur invalide.' }); }

  let coverPath = null;
  if (req.file) {
    try { coverPath = await processCover(req.file.path, PLAYLIST_COVERS_DIR); }
    catch { await safeUnlink(req.file.path); return res.status(400).json({ error: 'Image illisible.' }); }
    await safeUnlink(req.file.path);
  }
  const info = db.prepare('INSERT INTO playlists (owner_id, name, cover_path, bg_color) VALUES (?, ?, ?, ?)')
    .run(req.session.userId, name, coverPath, bgColor);
  const { playlist, role } = getAccess(info.lastInsertRowid, req.session.userId);
  res.status(201).json({ playlist: serializePlaylist(playlist, role, req.session.userId) });
}));

// Détail : playlist + pistes ordonnées (+ partages si propriétaire).
router.get('/:id', (req, res) => {
  const uid = req.session.userId;
  const { playlist, role } = getAccess(req.params.id, uid);
  if (!playlist || !role) return res.status(404).json({ error: 'Playlist introuvable.' });

  const tracks = db.prepare(`
    SELECT pt.id AS track_id, pt.position, pt.added_at,
           au.username AS added_by_name,
           s.*, ou.username AS owner_name
    FROM playlist_tracks pt
    JOIN songs s ON s.id = pt.song_id
    JOIN users ou ON ou.id = s.owner_id
    LEFT JOIN users au ON au.id = pt.added_by
    WHERE pt.playlist_id = ?
    ORDER BY pt.position, pt.id
  `).all(playlist.id).map((row) => ({
    track_id: row.track_id,
    added_at: row.added_at,
    added_by_name: row.added_by_name,
    song: serializeSong(row, uid),
  }));

  let shares = null;
  if (role === 'owner') {
    shares = db.prepare(`
      SELECT ps.id, ps.user_id, ps.can_edit, u.username
      FROM playlist_shares ps JOIN users u ON u.id = ps.user_id
      WHERE ps.playlist_id = ? ORDER BY u.username
    `).all(playlist.id);
  }
  res.json({ playlist: serializePlaylist(playlist, role, uid), tracks, shares });
});

// Modification nom / couleur / pochette — propriétaire uniquement.
router.put('/:id', coverUpload.single('cover'), ah(async (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  const cleanup = () => req.file && safeUnlink(req.file.path);
  if (!playlist || role !== 'owner') {
    await cleanup();
    return res.status(playlist ? 403 : 404).json({ error: playlist ? 'Seul le propriétaire peut modifier la playlist.' : 'Playlist introuvable.' });
  }
  const name = cleanText(req.body?.name, 120) ?? playlist.name;
  const bgColor = req.body?.bg_color !== undefined ? parseHexColor(req.body.bg_color) : playlist.bg_color;
  if (bgColor === undefined) { await cleanup(); return res.status(400).json({ error: 'Couleur invalide.' }); }

  let coverPath = playlist.cover_path;
  if (req.file) {
    try { coverPath = await processCover(req.file.path, PLAYLIST_COVERS_DIR); }
    catch { await cleanup(); return res.status(400).json({ error: 'Image illisible.' }); }
    await cleanup();
    if (playlist.cover_path) await safeUnlink(path.join(PLAYLIST_COVERS_DIR, playlist.cover_path));
  }
  db.prepare('UPDATE playlists SET name = ?, bg_color = ?, cover_path = ? WHERE id = ?')
    .run(name, bgColor, coverPath, playlist.id);
  const updated = getAccess(playlist.id, req.session.userId);
  res.json({ playlist: serializePlaylist(updated.playlist, 'owner', req.session.userId) });
}));

// Suppression — propriétaire uniquement. Les fichiers audio ne bougent pas.
router.delete('/:id', ah(async (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  if (!playlist || role !== 'owner') {
    return res.status(playlist ? 403 : 404).json({ error: playlist ? 'Seul le propriétaire peut supprimer la playlist.' : 'Playlist introuvable.' });
  }
  db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id);
  if (playlist.cover_path) await safeUnlink(path.join(PLAYLIST_COVERS_DIR, playlist.cover_path));
  res.json({ ok: true });
}));

// Ajout d'une piste (propriétaire ou collaborateur avec édition).
router.post('/:id/tracks', (req, res) => {
  const uid = req.session.userId;
  const { playlist, role } = getAccess(req.params.id, uid);
  if (!playlist || !role) return res.status(404).json({ error: 'Playlist introuvable.' });
  if (role === 'view') return res.status(403).json({ error: 'Vous n’avez pas le droit de modifier cette playlist.' });

  const songId = Number(req.body?.song_id);
  if (!songId || !canAccessSong(songId, uid)) return res.status(404).json({ error: 'Titre introuvable.' });
  const dup = db.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? AND song_id = ?')
    .get(playlist.id, songId);
  if (dup) return res.status(409).json({ error: 'Ce titre est déjà dans la playlist.' });

  const next = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM playlist_tracks WHERE playlist_id = ?')
    .get(playlist.id).p;
  db.prepare('INSERT INTO playlist_tracks (playlist_id, song_id, position, added_by) VALUES (?, ?, ?, ?)')
    .run(playlist.id, songId, next, uid);
  res.status(201).json({ ok: true });
});

// Retrait d'une piste (référence uniquement, le fichier reste chez son propriétaire).
router.delete('/:id/tracks/:trackId', (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  if (!playlist || !role) return res.status(404).json({ error: 'Playlist introuvable.' });
  if (role === 'view') return res.status(403).json({ error: 'Vous n’avez pas le droit de modifier cette playlist.' });
  const info = db.prepare('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?')
    .run(req.params.trackId, playlist.id);
  if (!info.changes) return res.status(404).json({ error: 'Piste introuvable.' });
  res.json({ ok: true });
});

// Réordonnancement complet (drag & drop) : liste des track_ids dans le nouvel ordre.
router.put('/:id/order', (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  if (!playlist || !role) return res.status(404).json({ error: 'Playlist introuvable.' });
  if (role === 'view') return res.status(403).json({ error: 'Vous n’avez pas le droit de modifier cette playlist.' });

  const ids = req.body?.track_ids;
  if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
    return res.status(400).json({ error: 'Ordre invalide.' });
  }
  const update = db.prepare('UPDATE playlist_tracks SET position = ? WHERE id = ? AND playlist_id = ?');
  db.transaction(() => {
    ids.forEach((trackId, i) => update.run(i + 1, trackId, playlist.id));
  })();
  res.json({ ok: true });
});

// ------------------------------------------------------------------- Partage
router.post('/:id/shares', (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  if (!playlist || role !== 'owner') {
    return res.status(playlist ? 403 : 404).json({ error: playlist ? 'Seul le propriétaire peut partager la playlist.' : 'Playlist introuvable.' });
  }
  const username = cleanText(req.body?.username, 60);
  const target = username && db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  if (target.id === req.session.userId) return res.status(400).json({ error: 'Vous êtes déjà propriétaire de cette playlist.' });
  const canEdit = req.body?.can_edit ? 1 : 0;
  db.prepare(`
    INSERT INTO playlist_shares (playlist_id, user_id, can_edit) VALUES (?, ?, ?)
    ON CONFLICT(playlist_id, user_id) DO UPDATE SET can_edit = excluded.can_edit
  `).run(playlist.id, target.id, canEdit);
  res.status(201).json({ ok: true });
});

router.delete('/:id/shares/:shareId', (req, res) => {
  const { playlist, role } = getAccess(req.params.id, req.session.userId);
  if (!playlist || role !== 'owner') {
    return res.status(playlist ? 403 : 404).json({ error: playlist ? 'Seul le propriétaire peut gérer les partages.' : 'Playlist introuvable.' });
  }
  db.prepare('DELETE FROM playlist_shares WHERE id = ? AND playlist_id = ?')
    .run(req.params.shareId, playlist.id);
  res.json({ ok: true });
});

export default router;
