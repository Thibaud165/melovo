// Lecteur audio : un seul <audio> persistant dans le shell, file d'attente,
// shuffle / repeat (one & all), seek via HTTP Range.
// Deux surfaces : barre fixe (desktop) et mini-lecteur + plein écran (mobile).
import { h, fmtTime, cover } from './ui.js';
import { icon } from './icons.js';
import { isMobile, recordPlay } from './state.js';

const audio = () => document.getElementById('audio');

const player = {
  context: [],      // liste de chansons du contexte lancé (ordre d'origine)
  queue: [],        // ordre de lecture effectif (mélangé si shuffle)
  index: -1,
  shuffle: false,
  repeat: 'off',    // 'off' | 'all' | 'one'
  song: null,
};

let els = null;     // références DOM de la surface active (barre ou mini-lecteur)
let npEls = null;   // références du plein écran « Lecture en cours » (si ouvert)
let wired = false;  // câblage audio/clavier/mediaSession fait une seule fois

// Volume : le curseur représente une position linéaire (0→1), mais le volume
// réel suit une courbe exponentielle (l'oreille est logarithmique) : ça monte
// doucement en bas et de plus en plus fort vers le haut.
const VOL_EXP = 2.5;
let volumePos = clamp01(Number(localStorage.getItem('melovo.volume') ?? 1));
function clamp01(v) { return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1; }
function applyVolume() { audio().volume = Math.pow(volumePos, VOL_EXP); }

export function currentSongId() { return player.song?.id ?? null; }
export function isPlaying() { return player.song && !audio().paused; }

/** Lance un contexte de lecture (bibliothèque, playlist, résultat…). */
export function playContext(songs, startIndex = 0, { shuffle = null } = {}) {
  if (!songs.length) return;
  player.context = [...songs];
  if (shuffle !== null) player.shuffle = shuffle;
  buildQueue(songs[startIndex]?.id);
  loadCurrent(true);
}

/** Reconstruit la file selon le mode shuffle, en gardant `keepId` comme piste courante. */
function buildQueue(keepId) {
  if (player.shuffle) {
    const rest = player.context.filter((s) => s.id !== keepId);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const current = player.context.find((s) => s.id === keepId);
    player.queue = current ? [current, ...rest] : rest;
    player.index = 0;
  } else {
    player.queue = [...player.context];
    player.index = Math.max(0, player.queue.findIndex((s) => s.id === keepId));
  }
}

function loadCurrent(autoplay, { record = true } = {}) {
  const song = player.queue[player.index];
  if (!song) return;
  player.song = song;
  const a = audio();
  a.src = song.audio_url;
  if (autoplay) a.play().catch(() => {});
  if (record) recordPlay('song', song.id);
  updateBar();
  updateMediaSession(song);
  document.dispatchEvent(new CustomEvent('melovo:trackchange'));
  savePlayback();
}

export function togglePlay() {
  const a = audio();
  if (!player.song) return;
  if (a.paused) a.play().catch(() => {}); else a.pause();
}

export function next(auto = false) {
  if (!player.queue.length) return;
  if (auto && player.repeat === 'one') {
    const a = audio(); a.currentTime = 0; a.play().catch(() => {});
    return;
  }
  if (player.index + 1 < player.queue.length) {
    player.index += 1;
  } else if (player.repeat === 'all' || !auto) {
    // Fin de file : on boucle (repeat-all) ou l'utilisateur force le passage.
    if (player.shuffle) buildQueue(null); // nouvelle passe mélangée
    player.index = 0;
  } else {
    return; // fin de file, pas de boucle
  }
  loadCurrent(true);
}

export function prev() {
  const a = audio();
  // Comme Spotify : au-delà de 3 s on revient au début du titre.
  if (a.currentTime > 3 || player.index === 0) { a.currentTime = 0; return; }
  player.index -= 1;
  loadCurrent(true);
}

export function toggleShuffle() {
  player.shuffle = !player.shuffle;
  if (player.song) buildQueue(player.song.id);
  updateBar();
}

export function cycleRepeat() {
  player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat];
  updateBar();
}

/** Si la chanson en cours a été modifiée ailleurs dans l'app. */
export function patchSong(song) {
  for (const list of [player.context, player.queue]) {
    const i = list.findIndex((s) => s.id === song.id);
    if (i !== -1) list[i] = song;
  }
  if (player.song?.id === song.id) { player.song = song; updateBar(); }
}

export function removeSong(songId) {
  player.context = player.context.filter((s) => s.id !== songId);
  const inQueue = player.queue.findIndex((s) => s.id === songId);
  if (inQueue === -1) return;
  const wasCurrent = player.song?.id === songId;
  player.queue.splice(inQueue, 1);
  if (inQueue < player.index) player.index -= 1;
  if (wasCurrent) {
    audio().pause();
    if (player.queue.length) { player.index = Math.min(player.index, player.queue.length - 1); loadCurrent(true); }
    else { player.song = null; player.index = -1; updateBar(); savePlayback(); }
  } else {
    savePlayback();
  }
}

// ------------------------------------------------------------------ Rendu
/** Construit la surface de lecture adaptée (barre desktop ou mini mobile). */
export function renderPlayer(root) {
  root.innerHTML = '';
  els = isMobile() ? renderMini(root) : renderDesktopBar(root);
  wireAudioOnce();
  updateBar();
}

function renderDesktopBar(root) {
  const bar = h('div', { class: 'player' },
    h('div', { class: 'player-left' },
      h('div', { class: 'player-cover' }),
      h('div', { class: 'player-meta' },
        h('div', { class: 'player-title' }, '—'),
        h('div', { class: 'player-artist' }, '')),
      h('span', { class: 'player-saved', title: 'Dans votre bibliothèque', html: icon('check-circle-2', 16) })),
    h('div', { class: 'player-center' },
      ctrl('shuffle', 'shuffle', 'Lecture aléatoire', toggleShuffle),
      ctrl('prev', 'skip-back', 'Précédent', prev),
      h('button', { class: 'player-play', 'aria-label': 'Lecture / pause', onclick: togglePlay, html: icon('play', 20) }),
      ctrl('next', 'skip-forward', 'Suivant', () => next(false)),
      ctrl('repeat', 'repeat', 'Répéter', cycleRepeat)),
    h('div', { class: 'player-right' },
      h('span', { class: 'player-time mono' }, '0:00'),
      h('div', { class: 'slider progress', onpointerdown: seekPointer },
        h('div', { class: 'slider-fill' }, h('span', { class: 'slider-thumb' }))),
      h('span', { class: 'player-duration mono' }, '0:00'),
      h('button', { class: 'btn-icon player-mute', 'aria-label': 'Couper le son', onclick: toggleMute, html: icon('volume-2', 18) }),
      h('div', { class: 'slider volume', onpointerdown: volumePointer },
        h('div', { class: 'slider-fill' }, h('span', { class: 'slider-thumb' })))));
  root.append(bar);
  return {
    kind: 'desktop',
    cover: bar.querySelector('.player-cover'),
    title: bar.querySelector('.player-title'),
    artist: bar.querySelector('.player-artist'),
    saved: bar.querySelector('.player-saved'),
    play: bar.querySelector('.player-play'),
    shuffle: bar.querySelector('[data-ctrl=shuffle]'),
    repeat: bar.querySelector('[data-ctrl=repeat]'),
    time: bar.querySelector('.player-time'),
    duration: bar.querySelector('.player-duration'),
    progress: bar.querySelector('.progress'),
    progressFill: bar.querySelector('.progress .slider-fill'),
    volume: bar.querySelector('.volume'),
    volumeFill: bar.querySelector('.volume .slider-fill'),
    mute: bar.querySelector('.player-mute'),
  };
}

// Mini-lecteur mobile : pochette + titre + play/pause + suivant + fine barre.
// Un appui (hors boutons) ouvre le plein écran « Lecture en cours ».
function renderMini(root) {
  const bar = h('div', { class: 'miniplayer', role: 'button', 'aria-label': 'Ouvrir le lecteur',
    onclick: (e) => { if (!e.target.closest('button')) openNowPlaying(); } },
    h('div', { class: 'mini-cover' }),
    h('div', { class: 'mini-meta' },
      h('div', { class: 'mini-title' }, '—'),
      h('div', { class: 'mini-artist' }, '')),
    h('button', { class: 'mini-btn', 'aria-label': 'Lecture / pause', onclick: togglePlay, html: icon('play', 22) }),
    h('button', { class: 'mini-btn', 'aria-label': 'Suivant', onclick: () => next(false), html: icon('skip-forward', 20) }),
    h('div', { class: 'mini-progress' }, h('div', { class: 'mini-progress-fill' })));
  root.append(bar);
  return {
    kind: 'mini',
    cover: bar.querySelector('.mini-cover'),
    title: bar.querySelector('.mini-title'),
    artist: bar.querySelector('.mini-artist'),
    play: bar.querySelector('.mini-btn'),
    progressFill: bar.querySelector('.mini-progress-fill'),
  };
}

// Plein écran « Lecture en cours » (mobile) : grande pochette, seek, contrôles.
function openNowPlaying() {
  if (!player.song || npEls) return;
  const sheet = h('div', { class: 'nowplaying' },
    h('header', { class: 'np-head' },
      h('button', { class: 'btn-icon', 'aria-label': 'Fermer', html: icon('arrow-left', 22),
        onclick: closeNowPlaying }),
      h('span', { class: 'np-label' }, 'Lecture en cours'),
      h('span', { style: 'width:32px' })),
    // Un appui sur la pochette réduit le plein écran (comme la flèche « < »).
    h('div', { class: 'np-cover', role: 'button', 'aria-label': 'Réduire', onclick: closeNowPlaying }),
    h('div', { class: 'np-meta' },
      h('div', { class: 'np-title' }),
      h('div', { class: 'np-artist' })),
    h('div', { class: 'np-seek' },
      h('div', { class: 'slider np-progress', onpointerdown: seekPointer },
        h('div', { class: 'slider-fill' }, h('span', { class: 'slider-thumb' }))),
      h('div', { class: 'np-times' },
        h('span', { class: 'np-time mono' }, '0:00'),
        h('span', { class: 'np-duration mono' }, '0:00'))),
    h('div', { class: 'np-controls' },
      ctrl('shuffle', 'shuffle', 'Lecture aléatoire', toggleShuffle, 24),
      h('button', { class: 'btn-icon np-ctrl', 'aria-label': 'Précédent', onclick: prev, html: icon('skip-back', 30) }),
      h('button', { class: 'np-play', 'aria-label': 'Lecture / pause', onclick: togglePlay, html: icon('play', 30) }),
      h('button', { class: 'btn-icon np-ctrl', 'aria-label': 'Suivant', onclick: () => next(false), html: icon('skip-forward', 30) }),
      ctrl('repeat', 'repeat', 'Répéter', cycleRepeat, 24)));
  document.getElementById('modal-root').append(sheet);

  npEls = {
    sheet,
    cover: sheet.querySelector('.np-cover'),
    title: sheet.querySelector('.np-title'),
    artist: sheet.querySelector('.np-artist'),
    play: sheet.querySelector('.np-play'),
    shuffle: sheet.querySelector('[data-ctrl=shuffle]'),
    repeat: sheet.querySelector('[data-ctrl=repeat]'),
    time: sheet.querySelector('.np-time'),
    duration: sheet.querySelector('.np-duration'),
    progress: sheet.querySelector('.np-progress'),
    progressFill: sheet.querySelector('.np-progress .slider-fill'),
  };
  updateNowPlaying();
  updateNpProgress();
  document.addEventListener('melovo:trackchange', updateNowPlaying);
}

function closeNowPlaying() {
  if (!npEls) return;
  npEls.sheet.remove();
  document.removeEventListener('melovo:trackchange', updateNowPlaying);
  npEls = null;
}

function wireAudioOnce() {
  if (wired) return;
  wired = true;
  const a = audio();
  applyVolume();
  a.addEventListener('timeupdate', () => { updateProgress(); updateNpProgress(); savePlaybackThrottled(); });
  a.addEventListener('durationchange', () => { updateProgress(); updateNpProgress(); });
  // play/pause : rafraîchit la surface, notifie les lignes, mémorise la position.
  const onPlayState = () => {
    updateBar();
    document.dispatchEvent(new CustomEvent('melovo:trackchange'));
    savePlayback();
  };
  // Sauvegarde finale avant fermeture de l'onglet.
  window.addEventListener('pagehide', savePlayback);
  window.addEventListener('beforeunload', savePlayback);
  a.addEventListener('play', onPlayState);
  a.addEventListener('pause', onPlayState);
  a.addEventListener('ended', () => next(true));
  a.addEventListener('error', () => { if (player.song) document.dispatchEvent(new CustomEvent('melovo:playerror')); });

  // Espace = play/pause (hors champs de saisie)
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    togglePlay();
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', togglePlay);
    navigator.mediaSession.setActionHandler('pause', togglePlay);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
    navigator.mediaSession.setActionHandler('nexttrack', () => next(false));
  }
}

function ctrl(name, iconName, label, onclick, size = 18) {
  return h('button', {
    class: 'btn-icon player-ctrl', 'data-ctrl': name, 'aria-label': label, title: label,
    onclick, html: icon(iconName, size),
  });
}

// ------------------------------------------------------------------ Mises à jour
function updateBar() {
  updateNowPlaying();
  if (!els) return;
  const s = player.song;
  const playIcon = icon(isPlaying() ? 'pause' : 'play', els.kind === 'mini' ? 22 : 20);
  if (els.title) els.title.textContent = s ? s.title : '—';
  if (els.artist) els.artist.textContent = s?.artist ?? '';
  if (els.cover) { els.cover.innerHTML = ''; els.cover.append(cover(s?.cover_url ?? null, els.kind === 'mini' ? 44 : 56, 22)); }
  if (els.play) els.play.innerHTML = playIcon;
  if (els.saved) els.saved.style.display = s?.in_library ? '' : 'none';
  if (els.shuffle) els.shuffle.classList.toggle('active', player.shuffle);
  if (els.repeat) {
    els.repeat.classList.toggle('active', player.repeat !== 'off');
    els.repeat.innerHTML = icon(player.repeat === 'one' ? 'repeat-1' : 'repeat', 18);
  }
  if (els.volume) updateVolumeUI();
}

function updateNowPlaying() {
  if (!npEls) return;
  const s = player.song;
  npEls.title.textContent = s ? s.title : '—';
  npEls.artist.textContent = s?.artist ?? '';
  npEls.cover.innerHTML = '';
  npEls.cover.append(cover(s?.cover_url ?? null, 0, 96));
  npEls.play.innerHTML = icon(isPlaying() ? 'pause' : 'play', 30);
  npEls.shuffle.classList.toggle('active', player.shuffle);
  npEls.repeat.classList.toggle('active', player.repeat !== 'off');
  npEls.repeat.innerHTML = icon(player.repeat === 'one' ? 'repeat-1' : 'repeat', 24);
}

function updateProgress() {
  if (!els) return;
  const a = audio();
  const dur = Number.isFinite(a.duration) ? a.duration : (player.song?.duration_seconds ?? 0);
  const pct = dur ? `${(a.currentTime / dur) * 100}%` : '0%';
  if (els.progressFill) els.progressFill.style.width = pct;
  if (els.time) els.time.textContent = fmtTime(a.currentTime);
  if (els.duration) els.duration.textContent = fmtTime(dur);
}

function updateNpProgress() {
  if (!npEls) return;
  const a = audio();
  const dur = Number.isFinite(a.duration) ? a.duration : (player.song?.duration_seconds ?? 0);
  npEls.progressFill.style.width = dur ? `${(a.currentTime / dur) * 100}%` : '0%';
  npEls.time.textContent = fmtTime(a.currentTime);
  npEls.duration.textContent = fmtTime(dur);
}

function updateVolumeUI() {
  const a = audio();
  // Le remplissage suit la position linéaire du curseur (pas le volume réel).
  els.volumeFill.style.width = `${(a.muted ? 0 : volumePos) * 100}%`;
  els.mute.innerHTML = icon(a.muted || volumePos === 0 ? 'volume-x' : volumePos < 0.5 ? 'volume-1' : 'volume-2', 18);
}

// ---- interactions barre de progression / volume (pointeur : souris + tactile) ----
function ratioFromEvent(e, el) {
  const r = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

function seekTo(e, el) {
  const a = audio();
  const dur = Number.isFinite(a.duration) ? a.duration : (player.song?.duration_seconds ?? 0);
  if (dur) a.currentTime = ratioFromEvent(e, el) * dur;
}

function seekPointer(e) {
  const el = e.currentTarget;
  dragPointer(e, (ev) => seekTo(ev, el));
}

function volumePointer(e) {
  const el = e.currentTarget;
  dragPointer(e, (ev) => {
    audio().muted = false;
    volumePos = ratioFromEvent(ev, el);        // position linéaire du curseur
    applyVolume();                              // volume réel = position^2.5
    localStorage.setItem('melovo.volume', String(volumePos));
    updateVolumeUI();
  });
}

function dragPointer(e, apply) {
  e.preventDefault();
  apply(e);
  const move = (ev) => apply(ev);
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function toggleMute() {
  const a = audio();
  a.muted = !a.muted;
  updateVolumeUI();
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist ?? '',
    album: 'Melovo',
    artwork: song.cover_url ? [{ src: song.cover_url, sizes: '500x500', type: 'image/jpeg' }] : [],
  });
}

// ------------------------------------------------------------------ Persistance
// On mémorise la file, la position dans le morceau et les modes pour reprendre
// la lecture là où on en était après un rechargement de page.
const SAVE_KEY = 'melovo.playback';
let saveTimer = 0;

function savePlayback() {
  if (!player.song) { localStorage.removeItem(SAVE_KEY); return; }
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      context: player.context,
      queueIds: player.queue.map((s) => s.id),
      index: player.index,
      shuffle: player.shuffle,
      repeat: player.repeat,
      songId: player.song.id,
      time: audio().currentTime || 0,
    }));
  } catch { /* quota / mode privé : on ignore */ }
}

// Sauvegarde limitée (au fil de la lecture) pour ne pas écrire à chaque tick.
function savePlaybackThrottled() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = 0; savePlayback(); }, 4000);
}

/** Restaure la dernière session de lecture (sans relancer automatiquement). */
export function restorePlayback() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { saved = null; }
  if (!saved?.context?.length || !saved.queueIds?.length) return;

  player.context = saved.context;
  player.shuffle = !!saved.shuffle;
  player.repeat = saved.repeat ?? 'off';
  const byId = new Map(saved.context.map((s) => [s.id, s]));
  player.queue = saved.queueIds.map((id) => byId.get(id)).filter(Boolean);
  if (!player.queue.length) return;
  player.index = Math.min(Math.max(0, saved.index ?? 0), player.queue.length - 1);
  player.song = player.queue[player.index];

  const a = audio();
  a.src = player.song.audio_url;
  const seek = () => { if (saved.time) { try { a.currentTime = saved.time; } catch { /* ignore */ } } };
  a.addEventListener('loadedmetadata', seek, { once: true });
  updateBar();
  updateMediaSession(player.song);
  document.dispatchEvent(new CustomEvent('melovo:trackchange'));
}
