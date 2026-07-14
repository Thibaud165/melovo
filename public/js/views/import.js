// Import : recherche YouTube Music (import en un clic), migration d'une playlist
// (YouTube/Deezer), fichier MP3/MP4 (brouillon éditable), ou lien YouTube.
import { api } from '../api.js';
import { refreshPlaylists } from '../state.js';
import { h, toast, spinner, fmtTime } from '../ui.js';
import { icon } from '../icons.js';
import { coverPicker } from '../components.js';

export function importView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Importer'));
  root.append(searchImportPanel());
  root.append(migratePanel());
  const grid = h('div', { class: 'import-grid' });
  root.append(grid);
  grid.append(fileImportPanel(), youtubeImportPanel());
}

// ---------------------------------------------------------------- Migration de playlist
function migratePanel() {
  const input = h('input', { class: 'input', type: 'url',
    placeholder: 'Lien d’une playlist YouTube Music ou Deezer (publique)', 'aria-label': 'Lien de playlist' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Importer la playlist');
  const form = h('form', { class: 'yt-form' }, input, submit);
  const status = h('div', { class: 'yt-status' });

  const panel = h('section', { class: 'import-panel import-migrate' },
    h('h2', { class: 'section-title' }, 'Migrer une playlist'),
    h('p', { class: 'muted' },
      'Colle le lien d’une playlist YouTube Music (import direct) ou d’une playlist Deezer publique ' +
      '(chaque titre est retrouvé sur YouTube). Les titres arrivent dans ta bibliothèque et une playlist est créée.'),
    form, status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    submit.disabled = true; input.disabled = true;
    status.innerHTML = '';
    const label = h('span', {}, 'Analyse de la playlist…');
    const fill = h('div', { class: 'yt-bar-fill' });
    status.append(h('div', { class: 'import-status' }, spinner(), label), h('div', { class: 'yt-bar' }, fill));

    const done = () => { submit.disabled = false; input.disabled = false; };
    const showError = (msg) => {
      status.innerHTML = '';
      status.append(h('div', { class: 'import-status error' },
        h('span', { html: icon('alert-circle', 20) }), h('span', {}, msg)));
      done();
    };

    const poll = async (jobId) => {
      try {
        const { job } = await api.get(`/api/import/playlist/${jobId}`);
        if (job.status === 'error') return showError(job.error);
        if (job.total) {
          const pct = Math.round((job.done / job.total) * 100);
          fill.style.width = `${pct}%`;
          label.textContent = `Import de « ${job.name || 'la playlist'} » — ${job.done} / ${job.total} titres…`;
        }
        if (job.status === 'done') {
          await refreshPlaylists().catch(() => {});
          status.innerHTML = '';
          const msg = job.failed
            ? `Playlist « ${job.name} » importée (${job.done - job.failed}/${job.total} titres, ${job.failed} introuvables).`
            : `Playlist « ${job.name} » importée (${job.done} titres).`;
          status.append(h('div', { class: 'import-status success' },
            h('span', { html: icon('check-circle-2', 20) }),
            h('a', { href: `#/playlist/${job.playlist_id}` }, msg)));
          toast('Playlist importée.', 'success');
          input.value = '';
          done();
          return;
        }
        setTimeout(() => poll(jobId), 1500);
      } catch (ex) { showError(ex.message); }
    };

    try {
      const { job } = await api.post('/api/import/playlist', { url });
      poll(job.id);
    } catch (ex) { showError(ex.message); }
  });

  return panel;
}

// ---------------------------------------------------------------- Recherche YouTube Music
function searchImportPanel() {
  const input = h('input', { class: 'input', type: 'search',
    placeholder: 'Rechercher un titre, un artiste…', 'aria-label': 'Rechercher sur YouTube Music' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Rechercher');
  const form = h('form', { class: 'yt-form' }, input, submit);
  const results = h('div', { class: 'yt-results' });

  const panel = h('section', { class: 'import-panel import-search' },
    h('h2', { class: 'section-title' }, 'Rechercher sur YouTube Music'),
    h('p', { class: 'muted' }, 'Cherchez un titre et importez-le directement, sans copier de lien.'),
    form, results);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    submit.disabled = true;
    results.innerHTML = '';
    results.append(h('div', { class: 'import-status' }, spinner(), h('span', {}, 'Recherche en cours…')));
    try {
      const { results: list } = await api.get(`/api/import/search?q=${encodeURIComponent(q)}`);
      results.innerHTML = '';
      if (!list.length) { results.append(h('p', { class: 'muted' }, 'Aucun résultat.')); }
      else list.forEach((r) => results.append(resultRow(r)));
    } catch (ex) {
      results.innerHTML = '';
      results.append(h('div', { class: 'import-status error' },
        h('span', { html: icon('alert-circle', 20) }), h('span', {}, ex.message)));
    } finally {
      submit.disabled = false;
    }
  });

  return panel;
}

function resultRow(r) {
  // Miniature cliquable : appui = aperçu audio (le son est diffusé par le Pi).
  const overlay = h('span', { class: 'yt-thumb-play', html: icon('play', 20) });
  const thumb = h('div', { class: 'yt-thumb', role: 'button', 'aria-label': 'Écouter un aperçu' });
  const img = h('img', { src: r.thumbnail, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => { thumb.classList.add('cover-empty'); img.remove(); });
  thumb.append(img, overlay);
  thumb.addEventListener('click', () => togglePreview(r.id, overlay));

  const importBtn = h('button', { class: 'btn btn-secondary btn-sm yt-import-btn' }, 'Importer');
  const sub = [r.artist, r.duration ? fmtTime(r.duration) : null].filter(Boolean).join(' · ');
  const row = h('div', { class: 'yt-result' },
    thumb,
    h('div', { class: 'yt-result-meta' },
      h('div', { class: 'yt-result-title' }, r.title),
      h('div', { class: 'yt-result-sub' }, sub)),
    importBtn);

  importBtn.addEventListener('click', async () => {
    importBtn.disabled = true;
    importBtn.textContent = '0 %';
    try {
      const { job } = await api.post('/api/import/youtube', { url: r.url });
      await pollJob(job.id,
        (p, status) => { importBtn.textContent = status === 'processing' ? '…' : `${Math.round(p)} %`; },
        (song) => {
          importBtn.textContent = 'Ajouté ✓';
          importBtn.classList.add('yt-import-done');
          row.classList.add('yt-result-done');
          toast(`« ${song.title} » ajouté à votre bibliothèque.`, 'success');
        },
        (err) => { importBtn.disabled = false; importBtn.textContent = 'Réessayer'; toast(err, 'error'); });
    } catch (ex) {
      importBtn.disabled = false; importBtn.textContent = 'Réessayer'; toast(ex.message, 'error');
    }
  });
  return row;
}

// ---- Aperçu audio d'un résultat (lecteur séparé du lecteur principal) ----
let previewAudio = null;
let previewOverlay = null;

function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio.removeAttribute('src'); previewAudio.load(); previewAudio = null; }
  if (previewOverlay) {
    previewOverlay.classList.remove('previewing', 'loading');
    previewOverlay.innerHTML = icon('play', 20);
    previewOverlay = null;
  }
}

function togglePreview(id, overlay) {
  if (previewOverlay === overlay) { stopPreview(); return; } // ré-appui = stop
  stopPreview();
  const a = new Audio(`/api/import/preview/${id}`);
  previewAudio = a;
  previewOverlay = overlay;
  overlay.classList.add('previewing', 'loading');
  overlay.innerHTML = icon('loader-2', 20);
  const showPause = () => { overlay.classList.remove('loading'); overlay.innerHTML = icon('pause', 20); };
  a.addEventListener('playing', showPause);
  a.addEventListener('ended', stopPreview);
  a.addEventListener('error', () => { toast('Aperçu indisponible.', 'error'); stopPreview(); });
  a.play().then(showPause).catch(() => {});
}

// L'aperçu s'arrête si on quitte la page d'import.
window.addEventListener('hashchange', stopPreview);

// Suivi d'un job d'import (partagé par la recherche et l'import par lien).
async function pollJob(jobId, onProgress, onDone, onError) {
  try {
    const { job } = await api.get(`/api/import/youtube/${jobId}`);
    onProgress(job.progress, job.status);
    if (job.status === 'error') return onError(job.error);
    if (job.status === 'done') return onDone(job.song);
    setTimeout(() => pollJob(jobId, onProgress, onDone, onError), 1000);
  } catch (ex) {
    onError(ex.message);
  }
}

// ---------------------------------------------------------------- Fichier
function fileImportPanel() {
  const panel = h('section', { class: 'import-panel' },
    h('h2', { class: 'section-title' }, 'Depuis un fichier'),
    h('p', { class: 'muted' }, 'MP3 ou MP4 — les MP4 sont convertis en MP3 automatiquement.'));

  const input = h('input', { type: 'file', accept: '.mp3,.mp4,.m4a,audio/mpeg,video/mp4', style: 'display:none' });
  const zone = h('div', { class: 'drop-zone', tabindex: '0', role: 'button' },
    h('span', { html: icon('upload', 32) }),
    h('span', {}, 'Glissez un fichier ici ou cliquez pour choisir'));
  const body = h('div', {}, zone, input);
  panel.append(body);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.click(); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) uploadFile(f);
  });
  input.addEventListener('change', () => { if (input.files[0]) uploadFile(input.files[0]); });

  async function uploadFile(file) {
    body.innerHTML = '';
    body.append(h('div', { class: 'import-status' }, spinner(),
      h('span', {}, `Analyse de « ${file.name} »…`)));
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { draft } = await api.post('/api/import/upload', fd);
      showDraftForm(draft);
    } catch (ex) {
      toast(ex.message, 'error');
      reset();
    }
  }

  // Formulaire de validation : titre / artiste / pochette pré-remplis depuis les tags.
  function showDraftForm(draft) {
    const picker = coverPicker(draft.cover_url);
    const title = h('input', { class: 'input', value: draft.title ?? '', maxlength: '200' });
    const artist = h('input', { class: 'input', value: draft.artist ?? '', maxlength: '120', placeholder: 'Optionnel' });
    const err = h('p', { class: 'form-error' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Valider');

    const form = h('form', { class: 'form' },
      h('div', { class: 'form-row' },
        picker.el,
        h('div', { class: 'form-fields' },
          h('label', { class: 'label' }, 'Titre'), title,
          h('label', { class: 'label' }, 'Artiste'), artist)),
      err,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: async () => {
          await api.del(`/api/import/drafts/${draft.id}`).catch(() => {});
          reset();
        } }, 'Annuler'),
        submit));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      const fd = new FormData();
      fd.append('title', title.value);
      fd.append('artist', artist.value);
      if (picker.getFile()) fd.append('cover', picker.getFile());
      try {
        const { song } = await api.post(`/api/import/drafts/${draft.id}`, fd);
        toast(`« ${song.title} » ajouté à votre bibliothèque.`, 'success');
        reset();
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false;
      }
    });

    body.innerHTML = '';
    body.append(form);
    title.focus();
  }

  function reset() {
    body.innerHTML = '';
    body.append(zone, input);
    input.value = '';
  }

  return panel;
}

// ---------------------------------------------------------------- YouTube
function youtubeImportPanel() {
  const input = h('input', { class: 'input', type: 'url',
    placeholder: 'https://www.youtube.com/watch?v=…', 'aria-label': 'Lien YouTube' });
  const submit = h('button', { class: 'btn btn-primary' }, 'Télécharger');
  const status = h('div', { class: 'yt-status' });

  const form = h('form', { class: 'yt-form' }, input, submit);
  const panel = h('section', { class: 'import-panel' },
    h('h2', { class: 'section-title' }, 'Depuis YouTube'),
    h('p', { class: 'muted' }, 'Collez un lien YouTube ou YouTube Music : audio, pochette et métadonnées sont récupérés.'),
    form, status);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    submit.disabled = true; input.disabled = true;
    status.innerHTML = '';
    const fill = h('div', { class: 'yt-bar-fill' });
    const pct = h('span', { class: 'mono yt-pct' }, '0 %');
    status.append(
      h('div', { class: 'import-status' }, spinner(), h('span', {}, 'Téléchargement en cours…'), pct),
      h('div', { class: 'yt-bar' }, fill));
    try {
      const { job } = await api.post('/api/import/youtube', { url });
      await poll(job.id, fill, pct);
    } catch (ex) {
      showError(ex.message);
    }
  });

  async function poll(jobId, fill, pct) {
    try {
      const { job } = await api.get(`/api/import/youtube/${jobId}`);
      fill.style.width = `${job.progress}%`;
      pct.textContent = `${Math.round(job.progress)} %`;
      if (job.status === 'error') return showError(job.error);
      if (job.status === 'done') {
        status.innerHTML = '';
        status.append(h('div', { class: 'import-status success' },
          h('span', { html: icon('check-circle-2', 20) }),
          h('span', {}, `« ${job.song.title} » ajouté à votre bibliothèque.`)));
        toast('Import YouTube terminé.', 'success');
        input.value = '';
        done();
        return;
      }
      if (job.status === 'processing') pct.textContent = 'Conversion…';
      setTimeout(() => poll(jobId, fill, pct), 1000);
    } catch (ex) {
      showError(ex.message);
    }
  }

  function showError(message) {
    status.innerHTML = '';
    status.append(h('div', { class: 'import-status error' },
      h('span', { html: icon('alert-circle', 20) }), h('span', {}, message)));
    done();
  }

  function done() {
    submit.disabled = false;
    input.disabled = false;
  }

  return panel;
}
