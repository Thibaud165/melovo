// Accueil : salutation, playlists, titres récents.
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

  const { songs } = await api.get('/api/songs/library');

  // --- Playlists -------------------------------------------------------
  root.append(h('h2', { class: 'section-title' }, 'Playlists'));
  if (state.playlists.length) {
    root.append(h('div', { class: 'card-grid' },
      state.playlists.map((p) => playlistCard(p))));
  } else {
    root.append(emptyState('list-music', 'Aucune playlist pour l’instant.',
      h('button', { class: 'btn btn-secondary', onclick: () => openEditPlaylist(null) }, 'Créer une playlist')));
  }

  // --- Ajouts récents --------------------------------------------------
  root.append(h('h2', { class: 'section-title' }, 'Ajouts récents'));
  if (songs.length) {
    const recent = songs.slice(0, 12);
    root.append(h('div', { class: 'card-grid' },
      recent.map((s, i) => songCard(s, () => player.playContext(recent, i)))));
  } else {
    root.append(emptyState('music', 'Votre bibliothèque est vide. Importez votre premier titre !',
      h('a', { class: 'btn btn-primary', href: '#/import' }, 'Importer un titre')));
  }
}

function playlistCard(p) {
  return h('a', { class: 'card', href: `#/playlist/${p.id}` },
    h('div', { class: 'card-cover' },
      cover(p.cover_url, 0, 40),
      h('button', { class: 'card-play', 'aria-label': 'Lire', html: icon('play', 18),
        onclick: async (e) => {
          e.preventDefault(); e.stopPropagation();
          const { tracks } = await api.get(`/api/playlists/${p.id}`);
          if (tracks.length) player.playContext(tracks.map((t) => t.song), 0);
        } })),
    h('span', { class: 'card-name' }, p.name),
    h('span', { class: 'card-sub' },
      p.role === 'owner' ? `${p.track_count} titre${p.track_count > 1 ? 's' : ''}` : `de ${p.owner_name}`));
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
