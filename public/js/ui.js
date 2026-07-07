// Boîte à outils UI : création DOM, modales, toasts, menus, formats français.
import { icon } from './icons.js';

/**
 * Création d'élément déclarative : h('div', { class: 'x', onclick: fn }, enfants…)
 * Les enfants peuvent être des chaînes, des nœuds, des tableaux ou null (ignoré).
 * `html:` insère du HTML de confiance (icônes SVG générées localement).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) return child.forEach((c) => append(el, c));
  el.append(child.nodeType ? child : document.createTextNode(String(child)));
}

// ------------------------------------------------------------------ Formats
/** Durée en m:ss (affichée en police mono). */
export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Durée totale « 1 h 24 min » pour les en-têtes de collection. */
export function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Date relative courte, puis JJ/MM/AAAA au-delà de 30 jours. */
export function fmtDate(isoUtc) {
  const d = new Date(isoUtc.includes('T') ? isoUtc : isoUtc.replace(' ', 'T') + 'Z');
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  return d.toLocaleDateString('fr-FR');
}

// ------------------------------------------------------------------ Toasts
let toastTimer = null;
export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  root.innerHTML = '';
  clearTimeout(toastTimer);
  const icons = { info: 'music', success: 'check-circle-2', error: 'alert-circle' };
  const el = h('div', { class: `toast toast-${type}`, role: 'status' },
    h('span', { class: 'toast-icon', html: icon(icons[type], 18) }),
    h('span', {}, message));
  root.append(el);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

// ------------------------------------------------------------------ Modales
/** Ouvre une modale. Retourne une fonction de fermeture. */
export function modal({ title, content, wide = false }) {
  const root = document.getElementById('modal-root');
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  // Volontairement PAS de fermeture au clic sur l'overlay : un clic à côté par
  // mégarde ne doit jamais faire perdre un formulaire (fermeture via ×,
  // Annuler/Enregistrer ou Échap uniquement).
  const overlay = h('div', { class: 'modal-overlay' },
    h('div', { class: `modal${wide ? ' modal-wide' : ''}`, role: 'dialog', 'aria-label': title },
      h('div', { class: 'modal-head' },
        h('h2', {}, title),
        h('button', { class: 'btn-icon', 'aria-label': 'Fermer', html: icon('x', 18), onclick: close })),
      content));
  document.addEventListener('keydown', onKey);
  root.append(overlay);
  return close;
}

/** Confirmation simple. Résout true si l'utilisateur confirme. */
export function confirmDialog(message, { confirmLabel = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    const body = h('div', {},
      h('p', { class: 'modal-text' }, message),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn btn-secondary', onclick: () => { close(); resolve(false); } }, 'Annuler'),
        h('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
          onclick: () => { close(); resolve(true); },
        }, confirmLabel)));
    const close = modal({ title: 'Confirmation', content: body });
  });
}

// ------------------------------------------------------------------ Menus contextuels
let openMenuEl = null;
let menuJustOpened = false; // le clic qui OUVRE le menu ne doit pas le refermer en remontant
document.addEventListener('click', () => {
  if (menuJustOpened) return;
  openMenuEl?.remove();
  openMenuEl = null;
});

/**
 * Menu déroulant ancré à un élément.
 * items : [{ label, icon, danger, onClick }] — null/false pour masquer une entrée.
 */
export function openMenu(anchor, items) {
  openMenuEl?.remove();
  menuJustOpened = true;
  setTimeout(() => { menuJustOpened = false; }, 0);
  const menu = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map((it) =>
      h('button', {
        class: `menu-item${it.danger ? ' menu-danger' : ''}`,
        role: 'menuitem',
        onclick: (e) => { e.stopPropagation(); menu.remove(); openMenuEl = null; it.onClick(); },
      },
        h('span', { class: 'menu-icon', html: icon(it.icon, 16) }),
        it.label)));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = `${Math.min(r.left, window.innerWidth - mw - 8)}px`;
  menu.style.top = `${r.bottom + mh + 8 > window.innerHeight ? r.top - mh - 4 : r.bottom + 4}px`;
  openMenuEl = menu;
}

// ------------------------------------------------------------------ Divers
/** Pastille-avatar ronde avec l'initiale du pseudo. */
export function avatar(username, size = 24) {
  return h('span', {
    class: 'avatar',
    style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`,
  }, (username ?? '?')[0].toUpperCase());
}

/** Pochette carrée avec repli sur une icône note. size=0 : dimensionnée par le CSS. */
export function cover(url, size, iconSize = Math.round((size || 80) * 0.45)) {
  const el = h('div', { class: 'cover', style: size ? `width:${size}px;height:${size}px` : null });
  if (url) {
    el.append(h('img', { src: url, alt: '', loading: 'lazy' }));
  } else {
    el.classList.add('cover-empty');
    el.innerHTML = icon('music-2', iconSize);
  }
  return el;
}

/** Ligne d'état vide (icône + message + action optionnelle). */
export function emptyState(iconName, message, action) {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'empty-icon', html: icon(iconName, 40) }),
    h('p', {}, message),
    action ?? null);
}

/** Spinner de chargement. */
export function spinner() {
  return h('span', { class: 'spinner', html: icon('loader-2', 20) });
}
