// Vue playlist : en-tête coloré, pistes, drag & drop, partage, édition.
import { api } from '../api.js';
import { state, refreshPlaylists, recordPlay } from '../state.js';
import { h, fmtTotal, toast, modal, confirmDialog, openMenu, emptyState, avatar } from '../ui.js';
import { icon } from '../icons.js';
import { trackTable, collectionHeader, coverPicker, colorPicker } from '../components.js';
import * as player from '../player.js';

export async function playlistView(root, id) {
  let data;
  try {
    data = await api.get(`/api/playlists/${id}`);
  } catch (ex) {
    root.append(emptyState('list-music', ex.message));
    return;
  }
  const { playlist, tracks, shares } = data;
  const songs = tracks.map((t) => t.song);
  const canEdit = playlist.role === 'owner' || playlist.role === 'edit';
  const isOwner = playlist.role === 'owner';

  const rerender = async () => { root.innerHTML = ''; await playlistView(root, id); };

  // Recharge si un titre est ajouté depuis un menu ailleurs dans la page.
  // Un seul écouteur par conteneur : les re-rendus remplacent le précédent
  // (sinon chaque re-rendu empilerait un écouteur -> rendus dupliqués).
  const onExternalChange = (e) => {
    if (!root.isConnected) return document.removeEventListener('melovo:playlist-changed', onExternalChange);
    if (e.detail.id === playlist.id) rerender();
  };
  if (root._onPlaylistChange) document.removeEventListener('melovo:playlist-changed', root._onPlaylistChange);
  root._onPlaylistChange = onExternalChange;
  document.addEventListener('melovo:playlist-changed', onExternalChange);

  const play = h('button', { class: 'play-hero', 'aria-label': 'Lire', html: icon('play', 24),
    onclick: () => { player.playContext(songs, 0); recordPlay('playlist', playlist.id); } });
  const shuffleBtn = h('button', { class: 'btn-icon action-lg', title: 'Lecture aléatoire', html: icon('shuffle', 22),
    onclick: () => { player.playContext(songs, Math.floor(Math.random() * songs.length), { shuffle: true }); recordPlay('playlist', playlist.id); } });
  if (!songs.length) { play.disabled = true; shuffleBtn.disabled = true; }

  const menuBtn = h('button', { class: 'btn-icon action-lg', title: 'Options', html: icon('more-horizontal', 22),
    onclick: (e) => openMenu(e.currentTarget, [
      isOwner && { label: 'Modifier la playlist', icon: 'pencil', onClick: () => openEditPlaylist(playlist, rerender) },
      isOwner && { label: 'Partager', icon: 'share-2', onClick: () => openShare(playlist, shares, rerender) },
      isOwner && { label: 'Supprimer la playlist', icon: 'trash-2', danger: true, onClick: async () => {
        const ok = await confirmDialog(`Supprimer la playlist « ${playlist.name} » ? Les titres restent dans les bibliothèques.`,
          { confirmLabel: 'Supprimer', danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/playlists/${playlist.id}`);
          await refreshPlaylists();
          toast('Playlist supprimée.', 'success');
          location.hash = '#/library';
        } catch (ex) { toast(ex.message, 'error'); }
      } },
      !isOwner && { label: playlist.role === 'edit' ? 'Partagée avec vous (édition)' : 'Partagée avec vous (lecture)',
        icon: 'users', onClick: () => {} },
    ]) });

  root.append(collectionHeader({
    label: 'Playlist',
    title: playlist.name,
    coverUrl: playlist.cover_url,
    color: playlist.bg_color ?? state.me.accent_color,
    meta: [
      avatar(playlist.owner_name, 20),
      h('span', {}, playlist.owner_name),
      h('span', { class: 'dot' }, '·'),
      h('span', {}, `${tracks.length} titre${tracks.length > 1 ? 's' : ''}`),
      tracks.length ? h('span', { class: 'dot' }, '·') : null,
      tracks.length ? h('span', { class: 'mono' }, fmtTotal(playlist.total_duration)) : null,
    ],
    actions: [play, shuffleBtn, menuBtn],
  }));

  if (!tracks.length) {
    root.append(emptyState('list-music', 'Cette playlist est vide. Ajoutez des titres depuis votre bibliothèque.',
      h('a', { class: 'btn btn-secondary', href: '#/library' }, 'Ouvrir ma bibliothèque')));
    return;
  }

  root.append(trackTable(tracks, {
    canReorder: canEdit,
    canRemove: canEdit,
    onChanged: rerender,
    onRemove: async (trackId) => {
      try {
        await api.del(`/api/playlists/${playlist.id}/tracks/${trackId}`);
        toast('Titre retiré de la playlist.', 'success');
        rerender();
      } catch (ex) { toast(ex.message, 'error'); }
    },
    onReorder: async (trackIds) => {
      try { await api.put(`/api/playlists/${playlist.id}/order`, { track_ids: trackIds }); }
      catch (ex) { toast(ex.message, 'error'); rerender(); }
    },
  }));
}

// ---------------------------------------------------------------- Modales
/** Création (playlist=null) ou édition d'une playlist. */
export function openEditPlaylist(playlist, onSaved) {
  const isNew = !playlist;
  const picker = coverPicker(playlist?.cover_url ?? null);
  const colors = colorPicker(playlist?.bg_color ?? null);
  const name = h('input', { class: 'input', value: playlist?.name ?? '', maxlength: '120',
    placeholder: 'Ma playlist' });
  const err = h('p', { class: 'form-error' });

  const form = h('form', { class: 'form' },
    h('div', { class: 'form-row' },
      picker.el,
      h('div', { class: 'form-fields' },
        h('label', { class: 'label' }, 'Nom'), name,
        h('label', { class: 'label' }, 'Couleur de fond'), colors.el)),
    err,
    h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close() }, 'Annuler'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, isNew ? 'Créer' : 'Enregistrer')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const fd = new FormData();
    fd.append('name', name.value);
    fd.append('bg_color', colors.getValue() ?? '');
    if (picker.getFile()) fd.append('cover', picker.getFile());
    try {
      const res = isNew
        ? await api.post('/api/playlists', fd)
        : await api.put(`/api/playlists/${playlist.id}`, fd);
      await refreshPlaylists();
      close();
      toast(isNew ? 'Playlist créée.' : 'Playlist modifiée.', 'success');
      if (isNew) location.hash = `#/playlist/${res.playlist.id}`;
      else onSaved?.();
    } catch (ex) { err.textContent = ex.message; }
  });

  const close = modal({ title: isNew ? 'Nouvelle playlist' : 'Modifier la playlist', content: form });
  name.focus();
}

/** Gestion du partage (propriétaire uniquement). */
async function openShare(playlist, shares, onChanged) {
  const { users } = await api.get('/api/users');
  const available = users.filter((u) => !shares.some((s) => s.user_id === u.id));

  const list = h('div', { class: 'share-list' },
    shares.length
      ? shares.map((s) => h('div', { class: 'share-item' },
          avatar(s.username, 28),
          h('span', { class: 'share-name' }, s.username),
          h('span', { class: 'share-mode' }, s.can_edit ? 'Peut modifier' : 'Lecture seule'),
          h('button', { class: 'btn-icon', title: 'Retirer l’accès', html: icon('x', 16),
            onclick: async () => {
              try {
                await api.del(`/api/playlists/${playlist.id}/shares/${s.id}`);
                close(); onChanged();
                toast(`Accès retiré à ${s.username}.`, 'success');
              } catch (ex) { toast(ex.message, 'error'); }
            } })))
      : h('p', { class: 'modal-text' }, 'Cette playlist n’est partagée avec personne.'));

  const select = h('select', { class: 'input' },
    h('option', { value: '' }, available.length ? 'Choisir un compte…' : 'Aucun autre compte disponible'),
    available.map((u) => h('option', { value: String(u.id) }, u.username)));
  if (!available.length) select.disabled = true;
  const canEdit = h('input', { type: 'checkbox', id: 'share-edit' });
  const err = h('p', { class: 'form-error' });

  const form = h('form', { class: 'form share-form' },
    h('label', { class: 'label' }, 'Partager avec'),
    select,
    h('label', { class: 'check-label', for: 'share-edit' }, canEdit, 'Autoriser la modification (ajouter, retirer, réordonner)'),
    err,
    h('div', { class: 'modal-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary', disabled: !available.length }, 'Partager')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = available.find((u) => String(u.id) === select.value);
    if (!user) { err.textContent = 'Choisissez un compte.'; return; }
    try {
      await api.post(`/api/playlists/${playlist.id}/shares`, { username: user.username, can_edit: canEdit.checked });
      close(); onChanged();
      toast(`Playlist partagée avec ${user.username}.`, 'success');
    } catch (ex) { err.textContent = ex.message; }
  });

  const close = modal({ title: `Partager « ${playlist.name} »`, content: h('div', {}, list, h('hr', { class: 'sep' }), form) });
}
