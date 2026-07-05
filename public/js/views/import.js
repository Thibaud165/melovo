// Import : fichier MP3/MP4 (avec brouillon éditable) ou lien YouTube (progression).
import { api } from '../api.js';
import { h, toast, spinner } from '../ui.js';
import { icon } from '../icons.js';
import { coverPicker } from '../components.js';

export function importView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Importer'));
  const grid = h('div', { class: 'import-grid' });
  root.append(grid);
  grid.append(fileImportPanel(), youtubeImportPanel());
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
