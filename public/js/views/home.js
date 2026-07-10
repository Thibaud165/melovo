// Accueil : salutation, playlists récentes (tuiles), titres écoutés récemment.
import { api } from '../api.js';
import { state } from '../state.js';
import { h, cover, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { openEditPlaylist } from './playlist.js';
import * as player from '../player.js';

export async function homeView(root) {
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  root.append(h('h1', { class: 'page-title' }, `${greeting}, ${state.me.username.split('.')[0]}`));

  // Récents (historique) + ajouts récents en repli.
  const [{ songs: recentSongs, playlists: recentPlaylists }, { songs: librarySongs }] = await Promise.all([
    api.get('/api/history/recent').catch(() => ({ songs: [], playlists: [] })),
    api.get('/api/songs/library').catch(() => ({ songs: [] })),
  ]);

  // --- Tuiles playlists : 6 dernières jouées (sinon playlists de la sidebar). ---
  const tiles = (recentPlaylists.length ? recentPlaylists : state.playlists).slice(0, 6);
  if (tiles.length) {
    root.append(h('div', { class: 'quick-tiles' }, tiles.map((p) => quickTile(p))));
  } else {
    root.append(emptyState('list-music', 'Aucune playlist pour l’instant.',
      h('button', { class: 'btn btn-secondary', onclick: () => openEditPlaylist(null) }, 'Créer une playlist')));
  }

  // --- Titres : écoutés récemment (5), sinon ajouts récents. ---
  const cards = recentSongs.length ? recentSongs : librarySongs.slice(0, 12);
  root.append(h('h2', { class: 'section-title' }, recentSongs.length ? 'Écoutés récemment' : 'Ajouts récents'));
  if (cards.length) {
    // Cartes compactes (plus petites, façon tuiles).
    root.append(h('div', { class: 'card-grid card-grid-sm' },
      cards.map((s, i) => songCard(s, () => player.playContext(cards, i)))));
  } else {
    root.append(emptyState('music', 'Votre bibliothèque est vide. Importez votre premier titre !',
      h('a', { class: 'btn btn-primary', href: '#/import' }, 'Importer un titre')));
  }
}

// Tuile compacte (façon Spotify) : mini-pochette + nom + bouton lire.
function quickTile(p) {
  return h('a', { class: 'quick-tile', href: `#/playlist/${p.id}` },
    cover(p.cover_url, 0, 18),
    h('span', { class: 'quick-tile-name' }, p.name),
    h('button', { class: 'quick-tile-play', 'aria-label': 'Lire', html: icon('play', 16),
      onclick: async (e) => {
        e.preventDefault(); e.stopPropagation();
        const { tracks } = await api.get(`/api/playlists/${p.id}`);
        if (tracks.length) {
          player.playContext(tracks.map((t) => t.song), 0);
          api.post('/api/history', { kind: 'playlist', id: p.id }).catch(() => {});
        }
      } }));
}

function songCard(s, onPlay) {
  return h('div', { class: 'card', ondblclick: onPlay },
    h('div', { class: 'card-cover' },
      cover(s.cover_url, 0, 40),
      h('button', { class: 'card-play', 'aria-label': 'Lire', html: icon('play', 18),
        onclick: (e) => { e.stopPropagation(); onPlay(); } })),
    h('span', { class: 'card-name' }, s.title),
    h('span', { class: 'card-sub' }, s.artist ?? 'Artiste inconnu'));
}
