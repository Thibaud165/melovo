// Import de musique : upload de fichier (MP3/MP4, en deux temps avec brouillon
// éditable) et lien YouTube / YouTube Music (job yt-dlp avec progression).
import { Router } from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { ah, requireAuth, cleanText } from '../lib/util.js';
import {
  AUDIO_DIR, TMP_DIR, probe, toMp3, extractEmbeddedCover, processCover, safeUnlink, randomName,
} from '../lib/media.js';
import { startJob, getJob, isYoutubeUrl, searchYoutube } from '../lib/ytdlp.js';
import { startPlaylistImport, getMigrateJob, detectPlaylistSource } from '../lib/migrate.js';
import { serializeSong, SONG_SELECT } from '../lib/songs.js';

const router = Router();
router.use(requireAuth);

// Anti-abus : les opérations lourdes (téléchargement / streaming / recherche
// yt-dlp) sont plafonnées par IP. Généreux pour un usage normal, mais borne un
// compte qui voudrait saturer le Pi.
const heavyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Patientez un instant.' },
});
router.use(['/preview', '/search', '/youtube', '/upload'], heavyLimiter);

// Aperçu audio d'un résultat : le Pi diffuse le son en direct (yt-dlp -> ffmpeg
// -> MP3 en streaming). Transcodé en MP3 pour être lisible partout (dont iOS),
// et proxifié par le serveur pour marcher via Tailscale sans internet côté client.
router.get('/preview/:id', (req, res) => {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(400).end();
  const url = `https://www.youtube.com/watch?v=${id}`;

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');

  const yt = spawn('yt-dlp', [
    '-f', 'bestaudio/best', '-o', '-', '--no-playlist', '--quiet', '--no-warnings', url,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
    '-vn', '-codec:a', 'libmp3lame', '-q:a', '5', '-f', 'mp3', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  yt.stdout.pipe(ff.stdin);
  ff.stdout.pipe(res);

  let killed = false;
  const kill = () => {
    if (killed) return; killed = true;
    yt.kill('SIGKILL'); ff.kill('SIGKILL');
    clearTimeout(guard);
  };
  // EPIPE quand un côté se ferme avant l'autre : on ignore.
  ff.stdin.on('error', () => {});
  yt.on('error', kill);
  ff.on('error', kill);
  res.on('close', kill);           // client parti / lecture stoppée
  const guard = setTimeout(kill, 12 * 60_000); // sécurité anti-processus zombie
  guard.unref?.();
});

// Migration : importe une playlist entière depuis un lien (YouTube/YT Music
// direct, ou Deezer public via matching YouTube).
function publicMigrateJob(j) {
  return {
    id: j.id, status: j.status, total: j.total, done: j.done, failed: j.failed,
    error: j.error, playlist_id: j.playlistId, name: j.name,
  };
}
router.post('/playlist', (req, res) => {
  const url = cleanText(req.body?.url, 500);
  if (!url || !detectPlaylistSource(url)) {
    return res.status(400).json({
      error: 'Collez le lien d’une playlist YouTube / YouTube Music, ou d’une playlist Deezer publique.',
    });
  }
  const job = startPlaylistImport(url, req.session.userId);
  res.status(202).json({ job: publicMigrateJob(job) });
});
router.get('/playlist/:id', (req, res) => {
  const job = getMigrateJob(req.params.id);
  if (!job || job.userId !== req.session.userId) {
    return res.status(404).json({ error: 'Import introuvable (expiré ?).' });
  }
  res.json({ job: publicMigrateJob(job) });
});

// Recherche YouTube Music : renvoie une liste de titres à importer en un clic.
router.get('/search', ah(async (req, res) => {
  const q = cleanText(req.query?.q, 120);
  if (!q) return res.json({ results: [] });
  try {
    const results = await searchYoutube(q, 12);
    res.json({ results });
  } catch (err) {
    console.error('[recherche yt] échec :', err.message);
    res.status(502).json({ error: 'Recherche impossible (pas d’accès à YouTube depuis le serveur ?).' });
  }
}));

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 300 * 1024 * 1024 }, // MP4 vidéo possible -> limite large
});

// ---------------------------------------------------------------- Upload fichier
// Brouillons en mémoire : le fichier est analysé/converti, l'utilisateur ajuste
// titre/artiste/pochette dans le formulaire, puis valide (ou annule).
const drafts = new Map();
const DRAFT_TTL = 30 * 60_000;

async function dropDraft(id) {
  const d = drafts.get(id);
  if (!d) return;
  drafts.delete(id);
  await safeUnlink(d.audioTmp);
  await safeUnlink(d.coverTmp);
}

router.post('/upload', upload.single('file'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!['.mp3', '.mp4', '.m4a'].includes(ext)) {
    await safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Format non pris en charge : envoyez un fichier MP3 ou MP4.' });
  }

  let audioTmp = req.file.path;
  try {
    if (ext !== '.mp3') {
      // MP4/M4A -> MP3 via ffmpeg, puis on jette l'original.
      const converted = await toMp3(audioTmp);
      await safeUnlink(audioTmp);
      audioTmp = converted;
    }
    const meta = await probe(audioTmp);
    if (!meta.duration) throw new Error('duration=0');

    const coverTmp = meta.hasCover ? await extractEmbeddedCover(audioTmp) : null;
    const id = crypto.randomBytes(8).toString('hex');
    const draft = {
      id,
      userId: req.session.userId,
      audioTmp,
      coverTmp,
      duration: meta.duration,
      expire: setTimeout(() => dropDraft(id), DRAFT_TTL),
    };
    draft.expire.unref();
    drafts.set(id, draft);

    res.json({
      draft: {
        id,
        title: meta.title || path.basename(req.file.originalname, ext),
        artist: meta.artist || null,
        duration_seconds: meta.duration,
        cover_url: coverTmp ? `/api/import/drafts/${id}/cover` : null,
      },
    });
  } catch (err) {
    console.error('[upload] analyse échouée :', err.message);
    await safeUnlink(audioTmp);
    res.status(400).json({ error: 'Fichier illisible ou corrompu (MP3/MP4 attendu).' });
  }
}));

// Aperçu de la pochette embarquée d'un brouillon.
router.get('/drafts/:id/cover', (req, res) => {
  const d = drafts.get(req.params.id);
  if (!d || d.userId !== req.session.userId || !d.coverTmp) return res.status(404).end();
  res.sendFile(d.coverTmp);
});

// Validation du brouillon -> création du titre dans MA bibliothèque.
const coverField = multer({ dest: TMP_DIR, limits: { fileSize: 15 * 1024 * 1024 } });
router.post('/drafts/:id', coverField.single('cover'), ah(async (req, res) => {
  const d = drafts.get(req.params.id);
  if (!d || d.userId !== req.session.userId) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(404).json({ error: 'Brouillon expiré : relancez l’import.' });
  }
  const title = cleanText(req.body?.title);
  if (!title) {
    if (req.file) await safeUnlink(req.file.path);
    return res.status(400).json({ error: 'Le titre est obligatoire.' });
  }
  const artist = cleanText(req.body?.artist, 120);

  // Pochette : celle envoyée par l'utilisateur, sinon celle embarquée dans le fichier.
  let coverPath = null;
  const coverSource = req.file?.path ?? d.coverTmp;
  if (coverSource) {
    try { coverPath = await processCover(coverSource); }
    catch { /* image illisible -> pas de pochette, on n'échoue pas l'import */ }
  }
  if (req.file) await safeUnlink(req.file.path);

  const audioName = randomName('.mp3');
  await fsp.rename(d.audioTmp, path.join(AUDIO_DIR, audioName))
    .catch(async () => { // rename échoue entre volumes -> copie
      await fsp.copyFile(d.audioTmp, path.join(AUDIO_DIR, audioName));
      await safeUnlink(d.audioTmp);
    });

  const info = db.prepare(`
    INSERT INTO songs (owner_id, title, artist, cover_path, audio_path, duration_seconds, source)
    VALUES (?, ?, ?, ?, ?, ?, 'upload')
  `).run(d.userId, title, artist, coverPath, audioName, d.duration);

  clearTimeout(d.expire);
  d.audioTmp = null; // déjà déplacé
  await dropDraft(d.id);

  const row = db.prepare(`${SONG_SELECT} WHERE s.id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ song: serializeSong(row, req.session.userId) });
}));

// Annulation du brouillon.
router.delete('/drafts/:id', ah(async (req, res) => {
  const d = drafts.get(req.params.id);
  if (d && d.userId === req.session.userId) { clearTimeout(d.expire); await dropDraft(d.id); }
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Import YouTube
router.post('/youtube', (req, res) => {
  const url = cleanText(req.body?.url, 500);
  if (!url || !isYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Lien invalide : collez une URL YouTube ou YouTube Music.' });
  }
  const job = startJob(url, req.session.userId, async (j, files) => {
    // Fichiers prêts : on lit les métadonnées embarquées puis on range le titre.
    const meta = await probe(files.audioPath);
    const audioName = randomName('.mp3');
    await fsp.copyFile(files.audioPath, path.join(AUDIO_DIR, audioName));
    let coverPath = null;
    if (files.thumbPath) {
      try { coverPath = await processCover(files.thumbPath); } catch { /* sans pochette */ }
    }
    const info = db.prepare(`
      INSERT INTO songs (owner_id, title, artist, cover_path, audio_path, duration_seconds, source)
      VALUES (?, ?, ?, ?, ?, ?, 'youtube')
    `).run(j.userId, meta.title || 'Titre sans nom', meta.artist, coverPath, audioName, meta.duration);
    const row = db.prepare(`${SONG_SELECT} WHERE s.id = ?`).get(info.lastInsertRowid);
    j.song = serializeSong(row, j.userId);
  });
  res.status(202).json({ job: { id: job.id, status: job.status, progress: job.progress } });
});

// Polling de l'état d'un job YouTube.
router.get('/youtube/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job || job.userId !== req.session.userId) {
    return res.status(404).json({ error: 'Import introuvable (expiré ?).' });
  }
  res.json({ job: { id: job.id, status: job.status, progress: job.progress, error: job.error, song: job.song } });
});

export default router;
