// Chansons : bibliothèque générale, streaming (HTTP Range), édition,
// suppression, duplication « Enregistrer dans ma bibliothèque ».
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import multer from 'multer';
import db from '../db.js';
import { ah, requireAuth, cleanText } from '../lib/util.js';
import { AUDIO_DIR, COVERS_DIR, TMP_DIR, processCover, safeUnlink, randomName } from '../lib/media.js';
import { canAccessSong, serializeSong, SONG_SELECT } from '../lib/songs.js';

const router = Router();
router.use(requireAuth);

const coverUpload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// Ma bibliothèque générale = tous les sons dont je suis propriétaire.
router.get('/library', (req, res) => {
  const rows = db.prepare(`${SONG_SELECT} WHERE s.owner_id = ? ORDER BY s.created_at DESC, s.id DESC`)
    .all(req.session.userId);
  res.json({ songs: rows.map((r) => serializeSong(r, req.session.userId)) });
});

// Streaming audio avec support des HTTP Range requests (seek dans le lecteur).
router.get('/:id/audio', (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song || !canAccessSong(song.id, req.session.userId)) {
    return res.status(404).json({ error: 'Titre introuvable.' });
  }
  const filePath = path.join(AUDIO_DIR, song.audio_path);
  let stat;
  try { stat = fs.statSync(filePath); } catch {
    return res.status(404).json({ error: 'Fichier audio manquant sur le disque.' });
  }

  const size = stat.size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');

  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : size - 1;
    if (Number.isNaN(start) || start >= size) {
      return res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    }
    end = Math.min(end, size - 1);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', size);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Modification des métadonnées (titre / artiste / pochette) — propriétaire uniquement.
router.put('/:id', coverUpload.single('cover'), ah(async (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  const cleanup = () => req.file && safeUnlink(req.file.path);
  if (!song || song.owner_id !== req.session.userId) {
    await cleanup();
    return res.status(song ? 403 : 404).json({ error: song ? 'Seul le propriétaire peut modifier ce titre.' : 'Titre introuvable.' });
  }
  const title = cleanText(req.body?.title);
  if (!title) { await cleanup(); return res.status(400).json({ error: 'Le titre est obligatoire.' }); }
  const artist = cleanText(req.body?.artist, 120);

  let coverPath = song.cover_path;
  if (req.file) {
    try {
      coverPath = await processCover(req.file.path);
    } catch {
      await cleanup();
      return res.status(400).json({ error: 'Image de pochette illisible.' });
    }
    await cleanup();
    if (song.cover_path) await safeUnlink(path.join(COVERS_DIR, song.cover_path));
  }
  db.prepare('UPDATE songs SET title = ?, artist = ?, cover_path = ? WHERE id = ?')
    .run(title, artist, coverPath, song.id);
  const row = db.prepare(`${SONG_SELECT} WHERE s.id = ?`).get(song.id);
  res.json({ song: serializeSong(row, req.session.userId) });
}));

// Suppression : fichier audio + pochette + ligne + références dans les playlists (cascade).
router.delete('/:id', ah(async (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song || song.owner_id !== req.session.userId) {
    return res.status(song ? 403 : 404).json({ error: song ? 'Seul le propriétaire peut supprimer ce titre.' : 'Titre introuvable.' });
  }
  db.prepare('DELETE FROM songs WHERE id = ?').run(song.id);
  await safeUnlink(path.join(AUDIO_DIR, song.audio_path));
  if (song.cover_path) await safeUnlink(path.join(COVERS_DIR, song.cover_path));
  res.json({ ok: true });
}));

// « Enregistrer dans ma bibliothèque » : duplique le fichier + la ligne
// (owner = moi). Ma copie survit si l'original est supprimé.
router.post('/:id/save', ah(async (req, res) => {
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song || !canAccessSong(song.id, req.session.userId)) {
    return res.status(404).json({ error: 'Titre introuvable.' });
  }
  if (song.owner_id === req.session.userId) {
    return res.status(400).json({ error: 'Ce titre est déjà dans votre bibliothèque.' });
  }
  const newAudio = randomName('.mp3');
  await fsp.copyFile(path.join(AUDIO_DIR, song.audio_path), path.join(AUDIO_DIR, newAudio));
  let newCover = null;
  if (song.cover_path) {
    newCover = randomName('.jpg');
    await fsp.copyFile(path.join(COVERS_DIR, song.cover_path), path.join(COVERS_DIR, newCover))
      .catch(() => { newCover = null; });
  }
  const info = db.prepare(`
    INSERT INTO songs (owner_id, title, artist, cover_path, audio_path, duration_seconds, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.session.userId, song.title, song.artist, newCover, newAudio, song.duration_seconds, song.source);
  const row = db.prepare(`${SONG_SELECT} WHERE s.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ song: serializeSong(row, req.session.userId) });
}));

export default router;
