// Point d'entrée Melovo : Express + sessions SQLite + API REST + SPA statique.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import session from 'express-session';

// Charge un éventuel fichier .env (utile hors Docker ; dans Docker, compose fournit l'env).
try {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
} catch { /* pas de .env : on utilise l'environnement tel quel */ }

const { PORT, SESSION_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD, PUBLIC_DIR, DATA_DIR } =
  await import('./config.js');
const { default: db, seedAdmin } = await import('./db.js');
const { SqliteSessionStore } = await import('./lib/sessionStore.js');
const { requireAuth } = await import('./lib/util.js');

if (!SESSION_SECRET) {
  console.error('SESSION_SECRET manquant : définissez-le dans .env avant de démarrer.');
  process.exit(1);
}

await seedAdmin(ADMIN_USERNAME, ADMIN_PASSWORD);

const app = express();
app.disable('x-powered-by');
// Un seul proxy devant nous (tunnel Cloudflare -> melovo:8080) : on lui fait
// confiance pour X-Forwarded-Proto (HTTPS) et X-Forwarded-For (IP réelle).
app.set('trust proxy', 1);

// En-têtes de sécurité (léger, sans dépendance). CSP adaptée à l'app :
// scripts/styles internes, pochettes locales + miniatures YouTube, audio local.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // HSTS uniquement en HTTPS (derrière le tunnel).
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https://i.ytimg.com https://*.ytimg.com",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: 'melovo.sid',
  secret: SESSION_SECRET,
  store: new SqliteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',       // protège du CSRF cross-site sur les POST
    secure: 'auto',        // cookie sécurisé en HTTPS (public), toléré en HTTP LAN
    maxAge: 30 * 86_400_000, // 30 jours
  },
}));

// --- API ---------------------------------------------------------------
app.use('/api/auth', (await import('./routes/auth.js')).default);
app.use('/api/admin', (await import('./routes/admin.js')).default);
app.use('/api/songs', (await import('./routes/songs.js')).default);
app.use('/api/import', (await import('./routes/imports.js')).default);
app.use('/api/playlists', (await import('./routes/playlists.js')).default);
app.use('/api/history', (await import('./routes/history.js')).default);
app.use('/api/stats', (await import('./routes/stats.js')).default);
app.use('/api', (await import('./routes/search.js')).default);

// Pochettes servies statiquement, derrière l'authentification.
app.use('/media/covers', requireAuth, express.static(path.join(DATA_DIR, 'covers'), { maxAge: '7d', immutable: true }));
app.use('/media/playlist-covers', requireAuth, express.static(path.join(DATA_DIR, 'playlist-covers'), { maxAge: '7d', immutable: true }));

// --- SPA ---------------------------------------------------------------
// Assets non versionnés (pas de build) : revalidation par ETag plutôt que
// cache long, sinon un déploiement ne s'applique qu'après vidage du cache.
// Sur réseau local / Tailscale, le coût de revalidation est négligeable.
app.use(express.static(PUBLIC_DIR, { etag: true, maxAge: 0, lastModified: true }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 404 API + gestionnaire d'erreurs central (jamais de stack trace côté client).
app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue.' }));
app.use((err, req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop volumineux.' });
  }
  console.error('[erreur]', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// Nettoyage du dossier tmp au démarrage (brouillons/jobs orphelins d'un arrêt brutal).
const tmpDir = path.join(DATA_DIR, 'tmp');
for (const entry of fs.readdirSync(tmpDir)) {
  fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Melovo à l'écoute sur http://0.0.0.0:${PORT}`);
});
