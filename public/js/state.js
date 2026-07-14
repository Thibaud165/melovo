// État global de la SPA : utilisateur connecté, playlists de la sidebar, thème.
import { api } from './api.js';

export const state = {
  me: null,        // { id, username, is_admin, accent_color, ... }
  playlists: [],   // playlists visibles dans la sidebar (miennes + partagées)
};

/** Recharge la liste des playlists (sidebar) et notifie l'interface. */
export async function refreshPlaylists() {
  const { playlists } = await api.get('/api/playlists');
  state.playlists = playlists;
  document.dispatchEvent(new CustomEvent('melovo:playlists'));
  return playlists;
}

/** Vrai sur un écran de téléphone (bascule vers le shell mobile). */
export function isMobile() {
  return window.innerWidth <= 768;
}

/** Enregistre une lecture (son ou playlist) pour l'historique. Best-effort. */
export function recordPlay(kind, id) {
  if (!id) return;
  api.post('/api/history', { kind, id }).catch(() => {});
}

/**
 * Envoie un lot de secondes réellement écoutées (statistiques).
 * sendBeacon survit à la fermeture de l'onglet ; sinon repli sur fetch.
 */
export function sendListen(songId, seconds) {
  const s = Math.round(seconds);
  if (!songId || s < 1) return;
  const body = JSON.stringify({ song_id: songId, seconds: s });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/stats/listen', new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch { /* repli ci-dessous */ }
  api.post('/api/stats/listen', { song_id: songId, seconds: s }).catch(() => {});
}

// ---- Thème : la base espresso est figée, seul --accent est personnalisable. ----

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/**
 * Applique la couleur d'accent de l'utilisateur : --accent est la couleur choisie,
 * --accent-hover / --accent-dim sont dérivées en HSL pour rester cohérentes.
 */
export function applyAccent(hex) {
  const root = document.documentElement.style;
  const [h, s, l] = hexToHsl(hex);
  root.setProperty('--accent', hex);
  root.setProperty('--accent-hover', hslToHex(h, s, Math.min(l + 8, 92)));
  root.setProperty('--accent-dim', hslToHex(h, Math.max(s - 10, 0), Math.max(l - 18, 8)));
  root.setProperty('--focus-ring', hex + '66'); // ~40 % d'opacité
}

/**
 * Applique la couleur de fond du thème en gardant la TEINTE choisie et en
 * regénérant la gamme (fond, sidebar/barre, surfaces, filets) avec les mêmes
 * écarts de luminosité que l'espresso — les nuances entre sections sont
 * préservées. `intensity` (0→1) contrôle la présence de la couleur : 0 = quasi
 * neutre (espresso à peine teinté), 1 = couleur bien affirmée. `null` -> défaut.
 */
export const DEFAULT_THEME_INTENSITY = 0.45;

export function applyTheme(hex, intensity = DEFAULT_THEME_INTENSITY) {
  const root = document.documentElement.style;
  const vars = ['--bg', '--bg-elevated', '--surface', '--surface-hover', '--border'];
  if (!hex) { vars.forEach((v) => root.removeProperty(v)); return; }
  const [h] = hexToHsl(hex);
  const k = Math.min(1, Math.max(0, intensity));
  // Saturation pilotée par l'intensité : 5 % (neutre) → 60 % (couleur affirmée).
  const sat = 5 + k * 55;
  // Un peu de luminosité en plus à haute intensité pour que la couleur « ressorte ».
  const lift = k * 2;
  root.setProperty('--bg', hslToHex(h, sat, 7 + lift));
  root.setProperty('--bg-elevated', hslToHex(h, sat + 1, 10 + lift));
  root.setProperty('--surface', hslToHex(h, sat + 2, 12.5 + lift));
  root.setProperty('--surface-hover', hslToHex(h, sat + 3, 16 + lift));
  root.setProperty('--border', hslToHex(h, sat + 4, 20 + lift));
}

/** Pastille d'aperçu lisible pour une couleur de thème (même teinte, plus claire). */
export function themeSwatchColor(hex) {
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(Math.max(s, 20), 60), 30);
}
