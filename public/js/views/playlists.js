// Vue « Bibliothèque » : grille de playlists (2 colonnes sur mobile) + accès
// à « Ma bibliothèque » (tous mes titres).
import { state, refreshPlaylists } from '../state.js';
import { h, cover, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { openEditPlaylist } from './playlist.js';

export async function playlistsView(root) {
  if (!state.playlists.length) await refreshPlaylists().catch(() => {});

  root.append(
    h('div', { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Bibliothèque'),
      h('button', { class: 'btn-icon', 'aria-label': 'Nouvelle playlist', title: 'Nouvelle playlist',
        html: icon('plus', 22), onclick: () => openEditPlaylist(null) })));

  const grid = h('div', { class: 'lib-grid' });

  // Tuile fixe « Ma bibliothèque » (tous mes titres).
  grid.append(h('a', { class: 'lib-tile lib-tile-library', href: '#/library' },
    h('span', { class: 'lib-tile-cover', html: icon('library', 28) }),
    h('span', { class: 'lib-tile-body' },
      h('span', { class: 'lib-tile-name' }, 'Ma bibliothèque'),
      h('span', { class: 'lib-tile-sub' }, 'Tous mes titres'))));

  for (const p of state.playlists) {
    grid.append(h('a', { class: 'lib-tile', href: `#/playlist/${p.id}` },
      cover(p.cover_url, 0, 24),
      h('span', { class: 'lib-tile-body' },
        h('span', { class: 'lib-tile-name' }, p.name),
        h('span', { class: 'lib-tile-sub' },
          p.role === 'owner' ? `${p.track_count} titre${p.track_count > 1 ? 's' : ''}` : `de ${p.owner_name}`))));
  }

  root.append(grid);

  if (!state.playlists.length) {
    root.append(emptyState('list-music', 'Aucune playlist pour l’instant.',
      h('button', { class: 'btn btn-secondary', onclick: () => openEditPlaylist(null) }, 'Créer une playlist')));
  }
}
