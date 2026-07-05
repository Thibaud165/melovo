// Import YouTube : exécution de yt-dlp avec suivi de progression.
// Les jobs vivent en mémoire (Map) et sont interrogés par polling côté client.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { TMP_DIR } from './media.js';

const jobs = new Map();
const JOB_TTL = 10 * 60_000; // un job terminé reste consultable 10 min

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

  (async () => {
    await fs.mkdir(workDir, { recursive: true });
    // Équivalent de : yt-dlp -x --audio-format mp3 --embed-thumbnail --embed-metadata
    // + --write-thumbnail pour disposer d'un fichier image exploitable par sharp.
    const args = [
      '--no-playlist',
      '-x', '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-thumbnail', '--embed-metadata',
      '--write-thumbnail',
      '--newline', '--progress',
      '--no-mtime',
      '-o', path.join(workDir, 'audio.%(ext)s'),
      url,
    ];
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';

    proc.stdout.on('data', (chunk) => {
      // Lignes de progression du type : "[download]  42.3% of 3.52MiB at ..."
      for (const line of chunk.toString().split('\n')) {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) job.progress = Math.min(99, Number(m[1]));
        if (line.includes('[ExtractAudio]')) { job.status = 'processing'; job.progress = 99; }
      }
    });
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });

    proc.on('error', () => finishError(job, workDir, 'yt-dlp est introuvable sur le serveur.'));
    proc.on('close', async (code) => {
      if (code !== 0) {
        return finishError(job, workDir, humanYtError(stderrTail));
      }
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
      } finally {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
        scheduleCleanup(id);
      }
    });
  })().catch(async (err) => {
    console.error('[yt-dlp] lancement échoué :', err);
    finishError(job, workDir, 'Impossible de lancer le téléchargement.');
  });

  return job;
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
  return 'Le téléchargement a échoué (yt-dlp). Vérifiez le lien ou mettez à jour yt-dlp.';
}
