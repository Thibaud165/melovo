// Paramètres : couleur d'accent, couleur de fond du thème, mot de passe.
import { api } from '../api.js';
import { state, applyAccent, applyTheme, themeSwatchColor } from '../state.js';
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';

const ACCENT_PRESETS = ['#E8A13C', '#C65C3A', '#93A96B', '#7A9E9F', '#A67FB5', '#C99846'];

// Bases de thème : la teinte est extraite, la gamme sombre est régénérée.
const THEME_PRESETS = [
  { name: 'Espresso (défaut)', value: null, swatch: '#4A392E' },
  { name: 'Nuit', value: '#22334D', swatch: themeSwatchColor('#22334D') },
  { name: 'Forêt', value: '#26402E', swatch: themeSwatchColor('#26402E') },
  { name: 'Ardoise', value: '#333A40', swatch: themeSwatchColor('#333A40') },
  { name: 'Prune', value: '#3C2B44', swatch: themeSwatchColor('#3C2B44') },
  { name: 'Bordeaux', value: '#46262C', swatch: themeSwatchColor('#46262C') },
];

export function settingsView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Paramètres'));

  // --- Couleur d'accent -----------------------------------------------
  root.append(colorSection({
    title: 'Couleur d’accent',
    hint: 'Boutons, lecture en cours, éléments actifs.',
    presets: ACCENT_PRESETS.map((c) => ({ name: c, value: c, swatch: c })),
    initial: state.me.accent_color,
    preview: (v) => applyAccent(v ?? '#E8A13C'),
    save: async (v) => {
      await api.put('/api/auth/accent', { accent_color: v });
      state.me.accent_color = v;
      toast('Couleur d’accent enregistrée.', 'success');
    },
    allowNone: false,
  }));

  // --- Couleur de fond ---------------------------------------------------
  root.append(colorSection({
    title: 'Couleur de fond',
    hint: 'Teinte le fond de toute l’app en conservant les nuances entre sections (sidebar et barre de lecture plus claires, zone centrale plus sombre).',
    presets: THEME_PRESETS,
    initial: state.me.theme_color,
    preview: (v) => applyTheme(v),
    save: async (v) => {
      await api.put('/api/auth/theme', { theme_color: v ?? '' });
      state.me.theme_color = v;
      toast('Couleur de fond enregistrée.', 'success');
    },
    allowNone: true,
  }));

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

/**
 * Bloc de choix de couleur : pastilles prédéfinies + pastille « personnalisée »
 * (crayon). Aperçu immédiat, enregistrement via le bouton.
 */
function colorSection({ title, hint, presets, initial, preview, save, allowNone }) {
  let value = initial ?? (allowNone ? null : presets[0].value);
  let customValue = null; // couleur libre choisie via le crayon

  const row = h('div', { class: 'color-picker' });
  const swatches = [];

  const mark = () => {
    const isPreset = presets.some((p) => p.value === value);
    swatches.forEach((s) => s.classList.toggle('selected', s.dataset.value === String(value)));
    customWrap.classList.toggle('selected', !isPreset && customValue !== null && value === customValue);
    if (!isPreset && value) customWrap.style.background = value;
  };

  for (const p of presets) {
    const s = h('button', {
      type: 'button',
      class: `swatch${p.value === null ? ' swatch-none' : ''}`,
      'data-value': String(p.value),
      title: p.name,
      style: p.value === null ? null : `background:${p.swatch}`,
      html: p.value === null ? icon('x', 14) : '',
    });
    s.addEventListener('click', () => { value = p.value; preview(value); mark(); });
    swatches.push(s);
    row.append(s);
  }

  // Pastille personnalisée : crayon par-dessus un <input type="color"> invisible.
  const customInput = h('input', { type: 'color', class: 'color-custom-input',
    value: (initial && !presets.some((p) => p.value === initial)) ? initial : '#888888',
    'aria-label': 'Couleur personnalisée' });
  const customWrap = h('label', { class: 'swatch color-custom-wrap', title: 'Couleur personnalisée' },
    h('span', { class: 'color-custom-pencil', html: icon('pencil', 13) }),
    customInput);
  customInput.addEventListener('input', () => {
    customValue = customInput.value.toUpperCase();
    value = customValue;
    preview(value);
    mark();
  });
  if (initial && !presets.some((p) => p.value === initial)) {
    customValue = initial;
    customWrap.style.background = initial;
  }
  row.append(customWrap);
  mark();

  const saveBtn = h('button', { class: 'btn btn-primary', onclick: async () => {
    try { await save(value); mark(); }
    catch (ex) { toast(ex.message, 'error'); }
  } }, 'Enregistrer');

  return h('section', { class: 'settings-section' },
    h('h2', { class: 'section-title' }, title),
    h('p', { class: 'muted' }, hint),
    row,
    h('div', { class: 'settings-actions' }, saveBtn));
}
