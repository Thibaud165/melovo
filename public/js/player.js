// Lecteur audio : un seul <audio> persistant dans le shell, file d'attente,
// shuffle / repeat (one & all), seek via HTTP Range, barre fixe en bas.
import { h, fmtTime, cover } from './ui.js';
import { icon } from './icons.js';

const audio = () => document.getElementById('audio');

const player = {
  context: [],      // liste de chansons du contexte lancé (ordre d'origine)
  queue: [],        // ordre de lecture effectif (mélangé si shuffle)
  index: -1,
  shuffle: false,
  repeat: 'off',    // 'off' | 'all' | 'one'
  song: null,
};

let els = null; // références DOM de la barre (après render)

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

function loadCurrent(autoplay) {
  const song = player.queue[player.index];
  if (!song) return;
  player.song = song;
  const a = audio();
  a.src = song.audio_url;
  if (autoplay) a.play().catch(() => {});
  updateBar();
  updateMediaSession(song);
  document.dispatchEvent(new CustomEvent('melovo:trackchange'));
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
    else { player.song = null; player.index = -1; updateBar(); }
  }
}

// ------------------------------------------------------------------ Rendu
/** Construit la barre de lecture (appelé une fois par le shell). */
export function renderPlayer(root) {
  root.innerHTML = '';
  const bar = h('div', { class: 'player' },
    // Gauche : pochette + titre + artiste + indicateur bibliothèque
    h('div', { class: 'player-left' },
      h('div', { class: 'player-cover' }),
      h('div', { class: 'player-meta' },
        h('div', { class: 'player-title' }, '—'),
        h('div', { class: 'player-artist' }, '')),
      h('span', { class: 'player-saved', title: 'Dans votre bibliothèque', html: icon('check-circle-2', 16) })),
    // Centre : contrôles
    h('div', { class: 'player-center' },
      ctrl('shuffle', 'shuffle', 'Lecture aléatoire', toggleShuffle),
      ctrl('prev', 'skip-back', 'Précédent', prev),
      h('button', { class: 'player-play', 'aria-label': 'Lecture / pause', onclick: togglePlay, html: icon('play', 20) }),
      ctrl('next', 'skip-forward', 'Suivant', () => next(false)),
      ctrl('repeat', 'repeat', 'Répéter', cycleRepeat)),
    // Droite : progression + volume
    h('div', { class: 'player-right' },
      h('span', { class: 'player-time mono' }, '0:00'),
      h('div', { class: 'slider progress', onclick: onSeek, onmousedown: dragSeek },
        h('div', { class: 'slider-fill' }, h('span', { class: 'slider-thumb' }))),
      h('span', { class: 'player-duration mono' }, '0:00'),
      h('button', { class: 'btn-icon player-mute', 'aria-label': 'Couper le son', onclick: toggleMute, html: icon('volume-2', 18) }),
      h('div', { class: 'slider volume', onclick: onVolume, onmousedown: dragVolume },
        h('div', { class: 'slider-fill' }, h('span', { class: 'slider-thumb' })))));
  root.append(bar);

  els = {
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

  const a = audio();
  a.volume = Number(localStorage.getItem('melovo.volume') ?? 1);
  a.addEventListener('timeupdate', updateProgress);
  a.addEventListener('durationchange', updateProgress);
  // play/pause : rafraîchit la barre ET notifie les lignes (surlignage + égaliseur
  // qui s'arrête à la pause).
  const onPlayState = () => {
    updateBar();
    document.dispatchEvent(new CustomEvent('melovo:trackchange'));
  };
  a.addEventListener('play', onPlayState);
  a.addEventListener('pause', onPlayState);
  a.addEventListener('ended', () => next(true));
  a.addEventListener('error', () => {
    if (player.song) document.dispatchEvent(new CustomEvent('melovo:playerror'));
  });

  // Raccourci espace = play/pause (hors champs de saisie)
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

  updateBar();
}

function ctrl(name, iconName, label, onclick) {
  return h('button', {
    class: 'btn-icon player-ctrl', 'data-ctrl': name, 'aria-label': label, title: label,
    onclick, html: icon(iconName, 18),
  });
}

function updateBar() {
  if (!els) return;
  const s = player.song;
  els.title.textContent = s ? s.title : '—';
  els.artist.textContent = s?.artist ?? '';
  els.saved.style.display = s?.in_library ? '' : 'none';
  els.cover.innerHTML = '';
  els.cover.append(cover(s?.cover_url ?? null, 56, 24));
  els.play.innerHTML = icon(isPlaying() ? 'pause' : 'play', 20);
  els.shuffle.classList.toggle('active', player.shuffle);
  els.repeat.classList.toggle('active', player.repeat !== 'off');
  els.repeat.innerHTML = icon(player.repeat === 'one' ? 'repeat-1' : 'repeat', 18);
  updateVolumeUI();
}

function updateProgress() {
  if (!els) return;
  const a = audio();
  const dur = Number.isFinite(a.duration) ? a.duration : (player.song?.duration_seconds ?? 0);
  els.time.textContent = fmtTime(a.currentTime);
  els.duration.textContent = fmtTime(dur);
  els.progressFill.style.width = dur ? `${(a.currentTime / dur) * 100}%` : '0%';
}

function updateVolumeUI() {
  const a = audio();
  els.volumeFill.style.width = `${(a.muted ? 0 : a.volume) * 100}%`;
  els.mute.innerHTML = icon(a.muted || a.volume === 0 ? 'volume-x' : a.volume < 0.5 ? 'volume-1' : 'volume-2', 18);
}

// ---- interactions barre de progression / volume (clic + glissement) ----
function ratioFromEvent(e, el) {
  const r = el.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
}

function onSeek(e) {
  const a = audio();
  const dur = Number.isFinite(a.duration) ? a.duration : (player.song?.duration_seconds ?? 0);
  if (dur) a.currentTime = ratioFromEvent(e, els.progress) * dur;
}

function dragSeek(e) { dragSlider(e, onSeek); }

function onVolume(e) {
  const a = audio();
  a.muted = false;
  a.volume = ratioFromEvent(e, els.volume);
  localStorage.setItem('melovo.volume', String(a.volume));
  updateVolumeUI();
}

function dragVolume(e) { dragSlider(e, onVolume); }

function dragSlider(e, apply) {
  e.preventDefault();
  apply(e);
  const move = (ev) => apply(ev);
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
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
