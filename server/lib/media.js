// Traitement média : ffprobe (tags/durée), ffmpeg (MP4 -> MP3, extraction de
// pochette embarquée) et sharp (pochettes recadrées en carré 500x500).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { DATA_DIR } from '../config.js';

const run = promisify(execFile);

export const AUDIO_DIR = path.join(DATA_DIR, 'audio');
export const COVERS_DIR = path.join(DATA_DIR, 'covers');
export const PLAYLIST_COVERS_DIR = path.join(DATA_DIR, 'playlist-covers');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');

export function randomName(ext) {
  return `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

/** Métadonnées d'un fichier audio : durée + tags (titre, artiste) + présence d'une pochette. */
export async function probe(filePath) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:format_tags=title,artist:stream=codec_type,codec_name',
    '-of', 'json', filePath,
  ]);
  const info = JSON.parse(stdout);
  const tags = info.format?.tags ?? {};
  // ffprobe peut renvoyer les tags en majuscules/minuscules selon le conteneur
  const tag = (name) => tags[name] ?? tags[name.toUpperCase()] ?? tags[name[0].toUpperCase() + name.slice(1)] ?? null;
  return {
    duration: Number(info.format?.duration) || 0,
    title: tag('title'),
    artist: tag('artist'),
    hasCover: (info.streams ?? []).some((s) => s.codec_type === 'video'),
  };
}

/** Convertit n'importe quelle entrée (MP4, M4A…) en MP3. Retourne le chemin de sortie. */
export async function toMp3(inputPath) {
  const out = path.join(TMP_DIR, randomName('.mp3'));
  // -vn : on ignore la vidéo ; qualité V2 (~190 kbps VBR), bon compromis taille/qualité
  await run('ffmpeg', ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', out],
    { timeout: 10 * 60_000 });
  return out;
}

/** Extrait la pochette embarquée d'un fichier audio (ou null s'il n'y en a pas). */
export async function extractEmbeddedCover(audioPath) {
  const out = path.join(TMP_DIR, randomName('.jpg'));
  try {
    await run('ffmpeg', ['-y', '-i', audioPath, '-an', '-frames:v', '1', out], { timeout: 60_000 });
    return out;
  } catch {
    return null;
  }
}

/**
 * Normalise une image de pochette : recadrage carré centré + 500x500 + JPEG.
 * Retourne le nom de fichier créé dans `destDir`.
 */
export async function processCover(inputPath, destDir = COVERS_DIR) {
  const name = randomName('.jpg');
  await sharp(inputPath)
    .rotate() // respecte l'orientation EXIF
    .resize(500, 500, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toFile(path.join(destDir, name));
  return name;
}

/** Suppression silencieuse (fichier déjà absent = OK). */
export async function safeUnlink(filePath) {
  if (!filePath) return;
  try { await fs.unlink(filePath); } catch { /* ignoré */ }
}
