// Composants partagés : table des pistes, menus de piste, modales
// (édition de titre, ajout à une playlist), sélecteurs de pochette et de couleur.
import { api } from './api.js';
import { state, isMobile } from './state.js';
import { h, fmtTime, fmtDate, toast, modal, confirmDialog, openMenu, avatar, cover, emptyState } from './ui.js';
import { icon } from './icons.js';
import * as player from './player.js';

// ---------------------------------------------------------------- Sélecteurs
/** Zone d'upload de pochette avec aperçu. getFile() -> File | null. */
export function coverPicker(existingUrl = null) {
  let file = null;
  const input = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const preview = h('div', { class: 'cover-picker', tabindex: '0', role: 'button',
    'aria-label': 'Choisir une image de pochette' });
  const setPreview = (url) => {
    preview.innerHTML = '';
    if (url) preview.append(h('img', { src: url, alt: '' }));
    else preview.innerHTML = `${icon('image', 28)}<span>Image</span>`;
  };
  setPreview(existingUrl);
  input.addEventListener('change', () => {
    file = input.files[0] ?? null;
    if (file) setPreview(URL.createObjectURL(file));
  });
  preview.addEventListener('click', () => input.click());
  preview.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.click(); });
  return { el: h('div', {}, preview, input), getFile: () => file };
}

const PALETTE = ['#E8A13C', '#C65C3A', '#93A96B', '#7A9E9F', '#A67FB5', '#C99846', '#8B6F47', '#5F7470'];

/** Palette de pastilles + couleur libre. getValue() -> '#RRGGBB' | null (aucune). */
export function colorPicker(initial = null) {
  let value = initial;
  const swatches = [];
  const mark = () => swatches.forEach((s) => s.classList.toggle('selected', s.dataset.color === (value ?? '')));
  const custom = h('input', { type: 'color', class: 'color-custom', value: initial ?? '#E8A13C',
    title: 'Couleur personnalisée' });
  custom.addEventListener('input', () => { value = custom.value.toUpperCase(); mark(); });

  const none = h('button', { type: 'button', class: 'swatch swatch-none', 'data-color': '',
    title: 'Aucune (couleur d’accent)', html: icon('x', 14) });
  none.addEventListener('click', () => { value = null; mark(); });
  swatches.push(none);

  for (const c of PALETTE) {
    const s = h('button', { type: 'button', class: 'swatch', 'data-color': c, style: `background:${c}` });
    s.addEventListener('click', () => { value = c; mark(); });
    swatches.push(s);
  }
  mark();
  return { el: h('div', { class: 'color-picker' }, swatches, custom), getValue: () => value };
}

// ---------------------------------------------------------------- Modales chanson
/** Modale d'édition des métadonnées d'un titre (propriétaire uniquement). */
export function openEditSong(song, onSaved) {
  const picker = coverPicker(song.cover_url);
  const title = h('input', { class: 'input', value: song.title, maxlength: '200' });
  const artist = h('input', { class: 'input', value: song.artist ?? '', maxlength: '120',
    placeholder: 'Optionnel' });
  const err = h('p', { class: 'form-error' });

  const form = h('form', { class: 'form' },
    h('div', { class: 'form-row' },
      picker.el,
      h('div', { class: 'form-fields' },
        h('label', { class: 'label' }, 'Titre'), title,
        h('label', { class: 'label' }, 'Artiste'), artist)),
    err,
    h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => close() }, 'Annuler'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const fd = new FormData();
    fd.append('title', title.value);
    fd.append('artist', artist.value);
    if (picker.getFile()) fd.append('cover', picker.getFile());
    try {
      const { song: updated } = await api.put(`/api/songs/${song.id}`, fd);
      player.patchSong(updated);
      close();
      toast('Titre modifié.', 'success');
      onSaved?.(updated);
    } catch (ex) { err.textContent = ex.message; }
  });

  const close = modal({ title: 'Modifier le titre', content: form });
}

/** Modale « Ajouter à une playlist » (mes playlists + partagées en édition). */
export function openAddToPlaylist(song) {
  const editable = state.playlists.filter((p) => p.role === 'owner' || p.role === 'edit');
  const body = h('div', { class: 'playlist-pick' },
    editable.length
      ? editable.map((p) => h('button', {
          class: 'playlist-pick-item',
          onclick: async () => {
            try {
              await api.post(`/api/playlists/${p.id}/tracks`, { song_id: song.id });
              close();
              toast(`Ajouté à « ${p.name} ».`, 'success');
              document.dispatchEvent(new CustomEvent('melovo:playlist-changed', { detail: { id: p.id } }));
            } catch (ex) { toast(ex.message, 'error'); }
          },
        }, cover(p.cover_url, 40, 18), h('span', { class: 'pick-name' }, p.name),
           h('span', { class: 'pick-count mono' }, `${p.track_count}`)))
      : emptyState('list-music', 'Aucune playlist modifiable. Créez-en une depuis la sidebar.'));
  const close = modal({ title: 'Ajouter à une playlist', content: body });
}

/** Duplique un titre dans ma bibliothèque. */
export async function saveToLibrary(song, onDone) {
  try {
    await api.post(`/api/songs/${song.id}/save`);
    toast('Enregistré dans votre bibliothèque.', 'success');
    onDone?.();
  } catch (ex) { toast(ex.message, 'error'); }
}

// ---------------------------------------------------------------- Table des pistes
/**
 * Table des pistes façon Spotify.
 * options :
 *  - canReorder / canRemove : droits sur la playlist affichée
 *  - reorderMode : 'track' (playlist, réordonne par track_id) ou 'song'
 *    (bibliothèque, réordonne par song.id)
 *  - onRemove(trackId), onReorder(ids), onChanged() : callbacks
 */
export function trackTable(items, opts = {}) {
  const { canReorder = false, canRemove = false, reorderMode = 'track',
    onRemove, onReorder, onChanged } = opts;
  const songs = items.map((it) => it.song);

  const head = h('div', { class: 'track-row track-head' },
    h('span', { class: 'col-num' }, '#'),
    h('span', { class: 'col-title' }, 'Titre'),
    h('span', { class: 'col-user' }, 'Ajouté par'),
    h('span', { class: 'col-date' }, 'Date ajoutée'),
    h('span', { class: 'col-dur', html: icon('clock', 14) }),
    h('span', { class: 'col-menu' }));

  const list = h('div', { class: 'track-list' });

  items.forEach((it, i) => {
    const song = it.song;
    const isCurrent = () => player.currentSongId() === song.id;

    const num = h('span', { class: 'col-num mono' },
      h('span', { class: 'num' }, String(i + 1)),
      // Égaliseur animé dans la colonne du numéro (remplace le n° pendant la lecture).
      h('span', { class: 'eq', html: '<i></i><i></i><i></i>' }),
      h('button', { class: 'btn-icon row-play', 'aria-label': 'Lire',
        html: icon('play', 16),
        onclick: (e) => { e.stopPropagation(); player.playContext(songs, i); } }),
      canReorder ? h('span', { class: 'drag-handle', html: icon('grip-vertical', 14) }) : null);

    const row = h('div', {
      class: 'track-row',
      'data-track-id': it.track_id ?? '',
      'data-song-id': song.id,
      ondblclick: () => player.playContext(songs, i),
      // Mobile : un simple appui sur la ligne (hors bouton) lance la lecture.
      onclick: (e) => { if (isMobile() && !e.target.closest('button')) player.playContext(songs, i); },
    },
      num,
      h('span', { class: 'col-title' },
        cover(song.cover_url, 40, 18),
        h('span', { class: 'title-block' },
          h('span', { class: 'track-title' }, song.title),
          song.artist ? h('span', { class: 'track-artist' }, song.artist) : null)),
      h('span', { class: 'col-user' },
        avatar(it.added_by_name ?? song.owner_name, 24),
        h('span', { class: 'user-name' }, it.added_by_name ?? song.owner_name)),
      h('span', { class: 'col-date mono' }, fmtDate(it.added_at ?? song.created_at)),
      h('span', { class: 'col-dur mono' },
        song.in_library && !song.is_mine
          ? h('span', { class: 'saved-mark', title: 'Dans votre bibliothèque', html: icon('check-circle-2', 16) })
          : null,
        fmtTime(song.duration_seconds)),
      h('span', { class: 'col-menu' },
        h('button', { class: 'btn-icon row-menu', 'aria-label': 'Options', html: icon('more-horizontal', 18),
          onclick: (e) => { e.stopPropagation(); openSongMenu(e.currentTarget, it, opts); } })));

    row.classList.toggle('current', isCurrent());
    // Écouteur auto-nettoyé : il se retire dès que la ligne quitte le DOM.
    const onTrackChange = () => {
      if (!row.isConnected) return document.removeEventListener('melovo:trackchange', onTrackChange);
      row.classList.toggle('current', isCurrent());
      row.classList.toggle('playing', isCurrent() && player.isPlaying());
    };
    document.addEventListener('melovo:trackchange', onTrackChange);

    if (canReorder) enableDrag(row, list, () => {
      const attr = reorderMode === 'song' ? 'songId' : 'trackId';
      // Renumérote les lignes dans le nouvel ordre (pas de re-render complet).
      [...list.children].forEach((r, idx) => {
        const n = r.querySelector('.num');
        if (n) n.textContent = String(idx + 1);
      });
      const ids = [...list.children].map((r) => Number(r.dataset[attr]));
      onReorder?.(ids);
    });

    list.append(row);
  });

  return h('div', { class: 'tracks' }, head, list);

  function openSongMenu(anchor, it, opts) {
    const song = it.song;
    openMenu(anchor, [
      { label: 'Lire', icon: 'play', onClick: () => player.playContext(songs, items.indexOf(it)) },
      { label: 'Ajouter à une playlist', icon: 'list-plus', onClick: () => openAddToPlaylist(song) },
      !song.is_mine && !song.in_library && {
        label: 'Enregistrer dans ma bibliothèque', icon: 'save',
        onClick: () => saveToLibrary(song, onChanged),
      },
      song.is_mine && {
        label: 'Modifier', icon: 'pencil',
        onClick: () => openEditSong(song, () => onChanged?.()),
      },
      canRemove && it.track_id && {
        label: 'Retirer de la playlist', icon: 'x', danger: true,
        onClick: () => onRemove?.(it.track_id),
      },
      song.is_mine && {
        label: 'Supprimer de ma bibliothèque', icon: 'trash-2', danger: true,
        onClick: async () => {
          const ok = await confirmDialog(
            `Supprimer « ${song.title} » ? Le fichier et toutes ses références dans les playlists seront supprimés.`,
            { confirmLabel: 'Supprimer', danger: true });
          if (!ok) return;
          try {
            await api.del(`/api/songs/${song.id}`);
            player.removeSong(song.id);
            toast('Titre supprimé.', 'success');
            onChanged?.();
          } catch (ex) { toast(ex.message, 'error'); }
        },
      },
    ]);
  }
}

// ---------------------------------------------------------------- Recherche de pistes
/**
 * Barre de recherche qui filtre en direct les lignes d'une `trackTable` déjà
 * rendue (par titre ou artiste). À placer au-dessus de la table.
 */
export function trackSearchInput(tableEl, placeholder = 'Rechercher un titre, un artiste…') {
  const input = h('input', { class: 'input', type: 'search', placeholder, 'aria-label': 'Rechercher' });
  const empty = h('p', { class: 'track-search-empty', hidden: true }, 'Aucun titre ne correspond.');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    tableEl.querySelectorAll('.track-list .track-row').forEach((row) => {
      const t = (row.querySelector('.track-title')?.textContent || '').toLowerCase();
      const a = (row.querySelector('.track-artist')?.textContent || '').toLowerCase();
      const match = !q || t.includes(q) || a.includes(q);
      row.style.display = match ? '' : 'none';
      if (match) shown += 1;
    });
    empty.hidden = shown > 0;
  });
  return h('div', { class: 'track-search' },
    h('span', { class: 'search-icon', html: icon('search', 18) }), input, empty);
}

// ---------------------------------------------------------------- En-tête de collection
/**
 * En-tête coloré commun à la bibliothèque et aux playlists :
 * dégradé fonctionnel (couleur -> --bg), pochette, label, titre 40/700, méta, actions.
 */
export function collectionHeader({ label, title, coverUrl, color, meta, actions }) {
  const header = h('div', { class: 'collection-head' },
    h('div', { class: 'collection-cover' },
      coverUrl ? h('img', { src: coverUrl, alt: '' }) : h('span', { class: 'cover-empty big', html: icon('music-2', 64) })),
    h('div', { class: 'collection-info' },
      h('span', { class: 'collection-label' }, label),
      h('h1', { class: 'collection-title' }, title),
      h('div', { class: 'collection-meta' }, meta)));
  header.style.setProperty('--collection-color', color ?? 'var(--accent)');
  return h('div', {}, header, h('div', { class: 'collection-actions' }, actions));
}

// Drag & drop natif pour réordonner les lignes d'une playlist.
function enableDrag(row, list, commit) {
  const handle = row.querySelector('.drag-handle');
  if (!handle) return;
  handle.addEventListener('mousedown', () => { row.draggable = true; });
  row.addEventListener('dragstart', (e) => {
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    row.draggable = false;
    commit();
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = list.querySelector('.dragging');
    if (!dragging || dragging === row) return;
    const r = row.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    list.insertBefore(dragging, before ? row : row.nextSibling);
  });
}
