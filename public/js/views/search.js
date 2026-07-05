// Recherche : mes titres (titre / artiste) + playlists accessibles (nom).
import { api } from '../api.js';
import { h, cover, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { trackTable } from '../components.js';

export function searchView(root) {
  const input = h('input', {
    class: 'input search-input', type: 'search',
    placeholder: 'Titre, artiste ou playlist…', 'aria-label': 'Recherche',
  });
  const results = h('div', { class: 'search-results' });
  root.append(
    h('h1', { class: 'page-title' }, 'Recherche'),
    h('div', { class: 'search-bar' }, h('span', { class: 'search-icon', html: icon('search', 20) }), input),
    results);
  input.focus();

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value.trim()), 250);
  });

  async function run(q) {
    results.innerHTML = '';
    if (!q) return;
    const { songs, playlists } = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
    if (!songs.length && !playlists.length) {
      results.append(emptyState('search', `Aucun résultat pour « ${q} ».`));
      return;
    }
    if (playlists.length) {
      results.append(h('h2', { class: 'section-title' }, 'Playlists'),
        h('div', { class: 'search-playlists' },
          playlists.map((p) => h('a', { class: 'search-playlist-item', href: `#/playlist/${p.id}` },
            cover(p.cover_url, 48, 20),
            h('span', { class: 'pick-name' }, p.name),
            h('span', { class: 'pick-count' }, `${p.track_count} titre${p.track_count > 1 ? 's' : ''} · ${p.owner_name}`)))));
    }
    if (songs.length) {
      results.append(h('h2', { class: 'section-title' }, 'Titres'),
        trackTable(songs.map((song) => ({ song })), { onChanged: () => run(q) }));
    }
  }
}
