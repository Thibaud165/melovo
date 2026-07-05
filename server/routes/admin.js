// Panneau admin : gestion des comptes (création, reset de mot de passe, suppression).
import { Router } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import db from '../db.js';
import { ah, requireAdmin, cleanText } from '../lib/util.js';
import { AUDIO_DIR, COVERS_DIR, PLAYLIST_COVERS_DIR, safeUnlink } from '../lib/media.js';

const router = Router();
router.use(requireAdmin);

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.is_admin, u.must_change_password, u.reset_code, u.created_at,
           (SELECT COUNT(*) FROM songs s WHERE s.owner_id = u.id) AS song_count,
           (SELECT COUNT(*) FROM playlists p WHERE p.owner_id = u.id) AS playlist_count
    FROM users u ORDER BY u.created_at
  `).all();
  res.json({ users });
});

// Création d'un compte avec mot de passe provisoire -> changement forcé à la 1ère connexion.
router.post('/users', ah(async (req, res) => {
  const username = cleanText(req.body?.username, 60);
  const password = req.body?.password;
  if (!username || !/^[a-zA-Z0-9._-]{3,60}$/.test(username)) {
    return res.status(400).json({ error: 'Identifiant invalide (3–60 caractères : lettres, chiffres, . _ -).' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Le mot de passe provisoire doit faire au moins 8 caractères.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Cet identifiant existe déjà.' });
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)'
  ).run(username, hash);
  res.status(201).json({ id: info.lastInsertRowid, username });
}));

// Réinitialisation : génère un code provisoire (affiché à l'admin une seule fois côté UI),
// qui sert de mot de passe temporaire jusqu'au changement forcé.
router.post('/users/:id/reset', ah(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
  // Code lisible : 4 groupes de 4 caractères sans ambiguïté (pas de O/0, I/1…).
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const code = Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length])
    .join('').match(/.{1,4}/g).join('-');
  const hash = await argon2.hash(code, { type: argon2.argon2id });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, reset_code = ? WHERE id = ?')
    .run(hash, code, user.id);
  res.json({ code });
}));

// Suppression d'un compte : la DB cascade (songs, playlists, partages, pistes),
// mais il faut supprimer les fichiers nous-mêmes.
router.delete('/users/:id', ah(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
  if (user.id === req.session.userId) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  }
  const songs = db.prepare('SELECT audio_path, cover_path FROM songs WHERE owner_id = ?').all(user.id);
  const playlists = db.prepare('SELECT cover_path FROM playlists WHERE owner_id = ?').all(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  for (const s of songs) {
    await safeUnlink(path.join(AUDIO_DIR, s.audio_path));
    if (s.cover_path) await safeUnlink(path.join(COVERS_DIR, s.cover_path));
  }
  for (const p of playlists) {
    if (p.cover_path) await safeUnlink(path.join(PLAYLIST_COVERS_DIR, p.cover_path));
  }
  res.json({ ok: true });
}));

export default router;
