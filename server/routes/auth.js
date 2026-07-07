// Authentification : login (rate-limité), logout, session courante,
// changement de mot de passe (dont le changement forcé) et couleur d'accent.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import argon2 from 'argon2';
import db from '../db.js';
import { ah, requireAuth, parseHexColor } from '../lib/util.js';

const router = Router();

// Anti brute-force : 10 tentatives / 15 min par IP sur le login.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans quelques minutes.' },
});

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    is_admin: !!u.is_admin,
    must_change_password: !!u.must_change_password,
    accent_color: u.accent_color,
    theme_color: u.theme_color ?? null,
  };
}

router.post('/login', loginLimiter, ah(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  // Message identique que le compte existe ou non (pas d'énumération d'utilisateurs).
  const fail = () => res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  if (!user) return fail();
  const ok = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!ok) return fail();

  // Nouvelle session (protection contre la fixation de session).
  await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.userId = user.id;
  req.session.isAdmin = !!user.is_admin;
  res.json({ user: publicUser(user) });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return req.session.destroy(() => res.status(401).json({ error: 'Non connecté.' }));
  res.json({ user: publicUser(user) });
});

// Changement de mot de passe. Si le compte est en `must_change_password`
// (première connexion ou reset admin), l'ancien mot de passe n'est pas redemandé.
router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { current_password, new_password } = req.body ?? {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user.must_change_password) {
    const ok = typeof current_password === 'string' &&
      await argon2.verify(user.password_hash, current_password).catch(() => false);
    if (!ok) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  }
  const hash = await argon2.hash(new_password, { type: argon2.argon2id });
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, reset_code = NULL WHERE id = ?')
    .run(hash, user.id);
  res.json({ ok: true });
}));

// Couleur d'accent du compte (thème).
router.put('/accent', requireAuth, (req, res) => {
  const color = parseHexColor(req.body?.accent_color);
  if (color === undefined || color === null) {
    return res.status(400).json({ error: 'Couleur invalide (format attendu : #RRGGBB).' });
  }
  db.prepare('UPDATE users SET accent_color = ? WHERE id = ?').run(color, req.session.userId);
  res.json({ ok: true, accent_color: color });
});

// Couleur de fond du thème (null / vide = retour à la base espresso par défaut).
router.put('/theme', requireAuth, (req, res) => {
  const color = parseHexColor(req.body?.theme_color); // null accepté = défaut
  if (color === undefined) {
    return res.status(400).json({ error: 'Couleur invalide (format attendu : #RRGGBB).' });
  }
  db.prepare('UPDATE users SET theme_color = ? WHERE id = ?').run(color, req.session.userId);
  res.json({ ok: true, theme_color: color });
});

export default router;
