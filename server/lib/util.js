// Petits utilitaires partagés par les routes.

/** Enveloppe async -> les erreurs remontent au middleware d'erreur d'Express. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Middleware : utilisateur connecté requis. */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté.' });
  next();
}

/** Middleware : admin requis. */
export function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté.' });
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Réservé à l’administrateur.' });
  next();
}

/** Valide une couleur hex du type #A1B2C3 (ou null/vide -> null). */
export function parseHexColor(value) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : undefined; // undefined = invalide
}

/** Nettoie une chaîne courte de formulaire (trim + longueur max). */
export function cleanText(value, maxLen = 200) {
  if (value == null) return null;
  const v = String(value).trim().slice(0, maxLen);
  return v.length ? v : null;
}
