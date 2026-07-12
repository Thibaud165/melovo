// Import YouTube : exécution de yt-dlp avec suivi de progression.
// Les jobs vivent en mémoire (Map) et sont interrogés par polling côté client.
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { TMP_DIR } from './media.js';

const jobs = new Map();
const JOB_TTL = 10 * 60_000; // un job terminé reste consultable 10 min

/**
 * Recherche sur YouTube (contenu identique à YouTube Music) via yt-dlp.
 * `--flat-playlist` : résultats rapides sans extraire chaque vidéo.
 * Retourne [{ id, url, title, artist, duration, thumbnail }].
 */
export function searchYoutube(query, limit = 12) {
  const q = String(query).trim().slice(0, 120).replace(/[\r\n]/g, ' ');
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', [
      '--dump-json', '--flat-playlist', '--no-warnings',
      `ytsearch${limit}:${q}`,
    ], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const results = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (!e.id) continue;
        // L'artiste exact sera extrait à l'import ; ici on affiche la chaîne
        // (« … - Topic » pour la musique), nettoyée du suffixe « - Topic ».
        const channel = (e.uploader || e.channel || '').replace(/\s*-\s*Topic$/i, '') || null;
        results.push({
          id: e.id,
          url: `https://www.youtube.com/watch?v=${e.id}`,
          title: e.title || 'Sans titre',
          artist: channel,
          duration: Number(e.duration) || null,
          thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
        });
      }
      resolve(results);
    });
  });
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

/** Vérification minimale : on n'accepte que des URLs YouTube / YouTube Music. */
export function isYoutubeUrl(raw) {
  try {
    const u = new URL(raw);
    return ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']
      .includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Lance un téléchargement yt-dlp (audio MP3 + miniature + métadonnées).
 * `onDone(job, files)` est appelé une fois les fichiers prêts, pour créer la ligne en DB.
 */
export function startJob(url, userId, onDone) {
  const id = crypto.randomBytes(8).toString('hex');
  const workDir = path.join(TMP_DIR, `yt-${id}`);
  const job = {
    id, userId, url,
    status: 'downloading', // downloading | processing | done | error
    progress: 0,
    error: null,
    song: null,
  };
  jobs.set(id, job);

  // YouTube renvoie régulièrement des erreurs transitoires (throttling de
  // l'extraction, 403 sur un fragment…) qui passent au 2ᵉ essai. On retente
  // donc automatiquement ; on n'échoue tout de suite que sur une erreur
  // permanente (vidéo indispo, privée, lien invalide…).
  const MAX_ATTEMPTS = 3;
  (async () => {
    let lastStderr = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      await fs.mkdir(workDir, { recursive: true });
      job.status = 'downloading';
      job.progress = 0;

      const { code, stderr } = await runYtDlp(job, workDir, url);
      lastStderr = stderr;

      if (code === 0) {
        // Succès : post-traitement (création du son en DB via onDone).
        try {
          job.status = 'processing';
          const files = await fs.readdir(workDir);
          const audio = files.find((f) => f.endsWith('.mp3'));
          if (!audio) throw new Error('Aucun fichier MP3 produit par yt-dlp.');
          const thumb = files.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)) ?? null;
          await onDone(job, {
            audioPath: path.join(workDir, audio),
            thumbPath: thumb ? path.join(workDir, thumb) : null,
          });
          job.status = 'done';
          job.progress = 100;
        } catch (err) {
          console.error('[yt-dlp] post-traitement échoué :', err);
          job.status = 'error';
          job.error = 'Le traitement du fichier téléchargé a échoué.';
        }
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
        scheduleCleanup(id);
        return;
      }

      // Échec : on abandonne si c'est permanent ou si c'était le dernier essai.
      if (isPermanentError(stderr) || attempt === MAX_ATTEMPTS) {
        return finishError(job, workDir, humanYtError(lastStderr));
      }
      console.warn(`[yt-dlp] essai ${attempt}/${MAX_ATTEMPTS} échoué (transitoire), nouvelle tentative…`);
      job.status = 'downloading';
      await sleep(1200 * attempt);
    }
  })().catch(async (err) => {
    console.error('[yt-dlp] lancement échoué :', err);
    finishError(job, workDir, 'Impossible de lancer le téléchargement.');
  });

  return job;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance une fois yt-dlp ; met à jour la progression ; résout {code, stderr}. */
function runYtDlp(job, workDir, url) {
  // --retries / --extractor-retries : yt-dlp retente lui-même en interne.
  const args = [
    '--no-playlist',
    '-x', '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--embed-thumbnail', '--embed-metadata',
    '--write-thumbnail',
    '--newline', '--progress', '--no-warnings',
    '--no-mtime',
    '--retries', '5', '--fragment-retries', '10', '--extractor-retries', '3',
    '-o', path.join(workDir, 'audio.%(ext)s'),
    url,
  ];
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) job.progress = Math.min(99, Number(m[1]));
        if (line.includes('[ExtractAudio]')) { job.status = 'processing'; job.progress = 99; }
      }
    });
    proc.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-4000); });
    proc.on('error', () => resolve({ code: -1, stderr: 'spawn-error' }));
    proc.on('close', (code) => resolve({ code, stderr: stderrTail }));
  });
}

/** Erreurs pour lesquelles réessayer ne sert à rien (échec immédiat). */
function isPermanentError(stderr) {
  const s = stderr.toLowerCase();
  return s.includes('video unavailable')
    || s.includes('this video is not available')
    || s.includes('private video')
    || s.includes('members-only')
    || s.includes('removed by the uploader')
    || s.includes('unsupported url')
    || s.includes('is not a valid url')
    || s.includes('requested format is not available')
    || (s.includes('sign in') && s.includes('age'));
}

async function finishError(job, workDir, message) {
  job.status = 'error';
  job.error = message;
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  scheduleCleanup(job.id);
}

function scheduleCleanup(id) {
  setTimeout(() => jobs.delete(id), JOB_TTL).unref();
}

/** Traduit les erreurs yt-dlp les plus courantes en message clair. */
function humanYtError(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes('video unavailable') || s.includes('this video is not available')) {
    return 'Vidéo indisponible (supprimée ou bloquée dans votre région).';
  }
  if (s.includes('private video')) return 'Cette vidéo est privée.';
  if (s.includes('sign in') || s.includes('age')) return 'Vidéo inaccessible (restriction d’âge ou connexion requise).';
  if (s.includes('unsupported url') || s.includes('is not a valid url')) return 'Lien YouTube invalide.';
  if (s.includes('name resolution') || s.includes('network') || s.includes('timed out')) {
    return 'Téléchargement impossible : pas d’accès à Internet depuis le serveur.';
  }
  // Après plusieurs tentatives : probablement un souci temporaire côté YouTube.
  return 'Le téléchargement a échoué après plusieurs tentatives. Réessayez dans un instant.';
}
