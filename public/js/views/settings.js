// Paramètres : couleur d'accent (thème) + changement de mot de passe.
import { api } from '../api.js';
import { state, applyAccent } from '../state.js';
import { h, toast } from '../ui.js';

const PRESETS = ['#E8A13C', '#C65C3A', '#93A96B', '#7A9E9F', '#A67FB5', '#C99846'];

export function settingsView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Paramètres'));

  // --- Couleur d'accent -----------------------------------------------
  const section = h('section', { class: 'settings-section' },
    h('h2', { class: 'section-title' }, 'Couleur d’accent'),
    h('p', { class: 'muted' }, 'La base espresso est fixe : seule la couleur d’accent est personnalisable.'));

  let value = state.me.accent_color;
  const swatches = [];
  const mark = () => swatches.forEach((s) => s.classList.toggle('selected', s.dataset.color === value));
  const row = h('div', { class: 'color-picker' });
  for (const c of PRESETS) {
    const s = h('button', { class: 'swatch', 'data-color': c, style: `background:${c}`, title: c });
    s.addEventListener('click', () => { value = c; mark(); applyAccent(c); });
    swatches.push(s); row.append(s);
  }
  const custom = h('input', { type: 'color', class: 'color-custom', value, title: 'Couleur personnalisée' });
  custom.addEventListener('input', () => { value = custom.value.toUpperCase(); mark(); applyAccent(value); });
  row.append(custom);
  mark();

  const save = h('button', { class: 'btn btn-primary', onclick: async () => {
    try {
      await api.put('/api/auth/accent', { accent_color: value });
      state.me.accent_color = value;
      toast('Couleur d’accent enregistrée.', 'success');
    } catch (ex) { toast(ex.message, 'error'); }
  } }, 'Enregistrer');

  section.append(row, h('div', { class: 'settings-actions' }, save));
  root.append(section);

  // --- Mot de passe ----------------------------------------------------
  const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
  const err = h('p', { class: 'form-error' });
  const form = h('form', { class: 'form settings-form' },
    h('label', { class: 'label' }, 'Mot de passe actuel'), current,
    h('label', { class: 'label' }, 'Nouveau mot de passe (8 caractères min.)'), next,
    err,
    h('div', { class: 'settings-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Changer le mot de passe')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api.post('/api/auth/change-password', {
        current_password: current.value, new_password: next.value,
      });
      current.value = ''; next.value = '';
      toast('Mot de passe modifié.', 'success');
    } catch (ex) { err.textContent = ex.message; }
  });

  root.append(h('section', { class: 'settings-section' },
    h('h2', { class: 'section-title' }, 'Mot de passe'), form));
}
