// Migration d'une playlist depuis un lien :
//  - YouTube / YouTube Music : téléchargement direct (vrai audio, bon ordre).
//  - Deezer (playlist publique) : lecture des métadonnées via l'API publique,
//    puis chaque titre est retrouvé et téléchargé depuis YouTube.
// Job en mémoire avec progression (interrogé par polling).
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import db from '../db.js';
import {
  AUDIO_DIR, PLAYLIST_COVERS_DIR, TMP_DIR, probe, processCover, safeUnlink, randomName,
} from './media.js';
import { searchYoutube } from './ytdlp.js';

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jobs = new Map();
const JOB_TTL = 30 * 60_000;
export function getMigrateJob(id) { return jobs.get(id) ?? null; }

/** Détecte la source d'un lien de playlist. */
export function detectPlaylistSource(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (['youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    return (u.searchParams.get('list') || u.pathname.includes('playlist')) ? 'youtube' : null;
  }
  if (host === 'deezer.com' || host.endsWith('.deezer.com') || host === 'dzr.page.link' || host === 'deezer.page.link') {
    return 'deezer';
  }
  return null;
}

export function startPlaylistImport(url, userId) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id, userId, url, status: 'resolving',
    total: 0, done: 0, failed: 0, error: null, playlistId: null, name: null,
  };
  jobs.set(id, job);

  (async () => {
    const src = detectPlaylistSource(url);
    const resolved = src === 'youtube' ? await resolveYoutube(url)
      : src === 'deezer' ? await resolveDeezer(url)
      : null;
    if (!resolved) throw new Error('Lien non reconnu (playlist YouTube/YouTube Music ou Deezer publique).');
    if (!resolved.tracks.length) throw new Error('Playlist vide ou illisible (est-elle bien publique ?).');

    job.total = resolved.tracks.length;
    job.name = resolved.name;
    job.status = 'downloading';

    // Crée la playlist Melovo avec la pochette de la source.
    let coverPath = null;
    if (resolved.coverUrl) { try { coverPath = await coverFromUrl(resolved.coverUrl); } catch { /* sans pochette */ } }
    const plInfo = db.prepare('INSERT INTO playlists (owner_id, name, cover_path) VALUES (?, ?, ?)')
      .run(userId, resolved.name || 'Playlist importée', coverPath);
    job.playlistId = plInfo.lastInsertRowid;

    const addTrack = db.prepare(
      'INSERT INTO playlist_tracks (playlist_id, song_id, position, added_by) VALUES (?, ?, ?, ?)'
    );
    let pos = 1;
    for (const t of resolved.tracks) {
      try {
        const songId = await importTrack(t, userId);
        addTrack.run(job.playlistId, songId, pos++, userId);
      } catch (err) {
        console.warn('[migrate] titre ignoré :', err.message);
        job.failed += 1;
      }
      job.done += 1;
    }
    job.status = 'done';
    scheduleCleanup(id);
  })().catch((err) => {
    console.error('[migrate] échec :', err);
    job.status = 'error';
    job.error = friendlyError(err);
    scheduleCleanup(id);
  });

  return job;
}

// Messages clairs (on n'expose jamais la commande yt-dlp brute).
function friendlyError(err) {
  const msg = String(err?.message || '');
  const low = msg.toLowerCase();
  if (low.includes('404') || low.includes('does not exist') || low.includes('not found')) {
    return 'Playlist introuvable. Vérifiez le lien (et qu’elle est bien publique).';
  }
  if (low.includes('private') || low.includes('privée')) {
    return 'Cette playlist est privée. Mettez-la en public puis réessayez.';
  }
  // Messages déjà « propres » qu'on a nous-mêmes levés.
  if (msg && !low.includes('command failed') && !low.includes('yt-dlp')) return msg;
  return 'Impossible de lire cette playlist. Vérifiez le lien (playlist publique attendue).';
}

function scheduleCleanup(id) { setTimeout(() => jobs.delete(id), JOB_TTL).unref(); }

// ------------------------------------------------------------ Résolution source
async function resolveYoutube(url) {
  const { stdout } = await execFileAsync('yt-dlp',
    ['--flat-playlist', '--dump-json', '--no-warnings', url],
    { timeout: 60_000, maxBuffer: 40 * 1024 * 1024 });
  const tracks = [];
  let name = null, coverUrl = null;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e.id) continue;
    name = name || e.playlist_title || e.playlist || null;
    if (!coverUrl) coverUrl = `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`;
    tracks.push({ youtubeUrl: `https://www.youtube.com/watch?v=${e.id}` });
  }
  return { name, coverUrl, tracks };
}

async function resolveDeezer(url) {
  const id = await deezerPlaylistId(url);
  if (!id) throw new Error('Lien Deezer invalide (lien d’une playlist publique attendu).');
  const data = await fetchJson(`https://api.deezer.com/playlist/${id}`);
  if (!data || data.error) throw new Error('Playlist Deezer introuvable ou privée (mettez-la en public).');
  const tracks = (data.tracks?.data || []).map((t) => ({
    query: `${t.artist?.name || ''} ${t.title || ''}`.trim(),
    title: t.title,
  })).filter((t) => t.query);
  return { name: data.title, coverUrl: data.picture_xl || data.picture_big || data.picture_medium || null, tracks };
}

async function deezerPlaylistId(url) {
  const m = String(url).match(/playlist\/(\d+)/);
  if (m) return m[1];
  // Liens raccourcis (dzr.page.link…) : on suit la redirection.
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const m2 = (res.url || '').match(/playlist\/(\d+)/);
    return m2 ? m2[1] : null;
  } catch { return null; }
}

// ------------------------------------------------------------ Import d'un titre
async function importTrack(t, userId) {
  let url = t.youtubeUrl;
  if (!url) {
    const results = await searchYoutube(t.query, 1);
    if (!results.length) throw new Error(`introuvable sur YouTube : ${t.query}`);
    url = results[0].url;
  }
  const workDir = path.join(TMP_DIR, `mig-${crypto.randomBytes(6).toString('hex')}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const files = await downloadYoutube(url, workDir);
    const meta = await probe(files.audioPath);
    const audioName = randomName('.mp3');
    await fs.copyFile(files.audioPath, path.join(AUDIO_DIR, audioName));
    let coverPath = null;
    if (files.thumbPath) { try { coverPath = await processCover(files.thumbPath); } catch { /* sans pochette */ } }
    const info = db.prepare(`
      INSERT INTO songs (owner_id, title, artist, cover_path, audio_path, duration_seconds, source)
      VALUES (?, ?, ?, ?, ?, ?, 'youtube')
    `).run(userId, meta.title || t.title || 'Titre sans nom', meta.artist, coverPath, audioName, meta.duration);
    return info.lastInsertRowid;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function downloadYoutube(url, workDir) {
  const args = [
    '--no-playlist', '-x', '--audio-format', 'mp3', '--audio-quality', '0',
    '--embed-thumbnail', '--embed-metadata', '--write-thumbnail', '--no-warnings', '--no-mtime',
    '--retries', '5', '--fragment-retries', '10', '--extractor-retries', '2',
    '-o', path.join(workDir, 'a.%(ext)s'), url,
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { code } = await runSpawn('yt-dlp', args);
    if (code === 0) break;
    if (attempt === 2) throw new Error('téléchargement échoué');
    await sleep(800);
  }
  const list = await fs.readdir(workDir);
  const audio = list.find((f) => f.endsWith('.mp3'));
  if (!audio) throw new Error('aucun mp3 produit');
  const thumb = list.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)) ?? null;
  return { audioPath: path.join(workDir, audio), thumbPath: thumb ? path.join(workDir, thumb) : null };
}

// ------------------------------------------------------------ Utilitaires
function runSpawn(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', () => resolve({ code: -1, stderr: 'spawn-error' }));
    p.on('close', (code) => resolve({ code, stderr: err }));
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Melovo' } });
  return res.json();
}

async function coverFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('cover fetch');
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(TMP_DIR, randomName('.img'));
  await fs.writeFile(tmp, buf);
  try { return await processCover(tmp, PLAYLIST_COVERS_DIR); }
  finally { await safeUnlink(tmp); }
}
