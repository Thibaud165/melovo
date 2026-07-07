// Vue « Ma bibliothèque » : tous mes titres. Non supprimable, non renommable.
import { api } from '../api.js';
import { state } from '../state.js';
import { h, fmtTotal, emptyState, toast } from '../ui.js';
import { icon } from '../icons.js';
import { trackTable, collectionHeader } from '../components.js';
import * as player from '../player.js';

export async function libraryView(root) {
  const { songs } = await api.get('/api/songs/library');
  const items = songs.map((song) => ({ song }));
  const total = songs.reduce((acc, s) => acc + s.duration_seconds, 0);

  const play = h('button', { class: 'play-hero', 'aria-label': 'Tout lire', html: icon('play', 24),
    onclick: () => player.playContext(songs, 0) });
  const shuffle = h('button', { class: 'btn-icon action-lg', title: 'Lecture aléatoire', html: icon('shuffle', 22),
    onclick: () => player.playContext(songs, Math.floor(Math.random() * songs.length), { shuffle: true }) });
  if (!songs.length) { play.disabled = true; shuffle.disabled = true; }

  root.append(collectionHeader({
    label: 'Bibliothèque',
    title: 'Ma bibliothèque',
    coverUrl: null,
    color: state.me.accent_color,
    meta: [
      h('span', {}, state.me.username),
      h('span', { class: 'dot' }, '·'),
      h('span', {}, `${songs.length} titre${songs.length > 1 ? 's' : ''}`),
      songs.length ? h('span', { class: 'dot' }, '·') : null,
      songs.length ? h('span', { class: 'mono' }, fmtTotal(total)) : null,
    ],
    actions: [play, shuffle],
  }));

  if (!songs.length) {
    root.append(emptyState('music', 'Votre bibliothèque est vide. Importez votre premier titre !',
      h('a', { class: 'btn btn-primary', href: '#/import' }, 'Importer un titre')));
    return;
  }

  root.append(trackTable(items, {
    canReorder: true,          // glisser-déposer pour ranger sa bibliothèque
    reorderMode: 'song',       // on réordonne par song.id (pas de track_id ici)
    onChanged: async () => { root.innerHTML = ''; await libraryView(root); },
    onReorder: async (songIds) => {
      // Persistance silencieuse : le DOM reflète déjà le nouvel ordre.
      try { await api.put('/api/songs/library/order', { song_ids: songIds }); }
      catch (ex) { toast(ex.message, 'error'); root.innerHTML = ''; await libraryView(root); }
    },
  }));
}
