// Shell de l'application : boot, écran de connexion, changement de mot de passe
// forcé, layout (sidebar + topbar + lecteur) et routeur par hash.
import { api } from './api.js';
import { state, refreshPlaylists, applyAccent, applyTheme, isMobile } from './state.js';
import { h, toast, openMenu, avatar, cover } from './ui.js';
import { icon } from './icons.js';
import { renderPlayer, restorePlayback } from './player.js';
import { homeView } from './views/home.js';
import { searchView } from './views/search.js';
import { importView } from './views/import.js';
import { libraryView } from './views/library.js';
import { playlistsView } from './views/playlists.js';
import { playlistView, openEditPlaylist } from './views/playlist.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';

const app = document.getElementById('app');

// ------------------------------------------------------------------ Boot
async function boot() {
  try {
    const { user } = await api.get('/api/auth/me');
    onLoggedIn(user);
  } catch {
    renderLogin();
  }
}

function onLoggedIn(user) {
  state.me = user;
  applyAccent(user.accent_color);
  applyTheme(user.theme_color);
  if (user.must_change_password) renderChangePassword();
  else startApp();
}

async function startApp() {
  await refreshPlaylists().catch(() => {});
  currentIsMobile = isMobile();
  renderShell();
  restorePlayback(); // reprend la dernière lecture (en pause) après un reload
  // Si le hash change ici, l'événement hashchange déclenchera route() tout seul.
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  else route();
}

document.addEventListener('melovo:unauthorized', () => {
  state.me = null;
  applyTheme(null); // retour au thème par défaut sur l'écran de connexion
  renderLogin();
});
document.addEventListener('melovo:playerror', () =>
  toast('Impossible de lire ce titre (fichier manquant ?).', 'error'));

// ------------------------------------------------------------------ Connexion
function renderLogin(message = null) {
  app.innerHTML = '';
  const username = h('input', { class: 'input', autocomplete: 'username', 'aria-label': 'Identifiant' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password',
    'aria-label': 'Mot de passe' });
  const err = h('p', { class: 'form-error' }, message ?? '');
  const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Se connecter');

  const form = h('form', { class: 'form' },
    h('label', { class: 'label' }, 'Identifiant'), username,
    h('label', { class: 'label' }, 'Mot de passe'), password,
    err, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    submit.disabled = true;
    try {
      const { user } = await api.post('/api/auth/login', {
        username: username.value.trim(), password: password.value,
      });
      onLoggedIn(user);
    } catch (ex) {
      err.textContent = ex.message;
      submit.disabled = false;
    }
  });

  app.append(h('div', { class: 'auth-screen' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-dot' }), 'Melovo'),
      h('p', { class: 'auth-sub' }, 'Votre musique, chez vous.'),
      form)));
  username.focus();
}

// Changement de mot de passe obligatoire (première connexion ou reset admin).
function renderChangePassword() {
  app.innerHTML = '';
  const pass1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
  const pass2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
  const err = h('p', { class: 'form-error' });

  const form = h('form', { class: 'form' },
    h('label', { class: 'label' }, 'Nouveau mot de passe (8 caractères min.)'), pass1,
    h('label', { class: 'label' }, 'Confirmez le mot de passe'), pass2,
    err,
    h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Enregistrer et continuer'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (pass1.value !== pass2.value) { err.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
    try {
      await api.post('/api/auth/change-password', { new_password: pass1.value });
      state.me.must_change_password = false;
      toast('Mot de passe enregistré.', 'success');
      startApp();
    } catch (ex) { err.textContent = ex.message; }
  });

  app.append(h('div', { class: 'auth-screen' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'logo' }, h('span', { class: 'logo-dot' }), 'Melovo'),
      h('p', { class: 'auth-sub' }, `Bienvenue ${state.me.username} — choisissez votre mot de passe personnel pour continuer.`),
      form)));
  pass1.focus();
}

// ------------------------------------------------------------------ Shell
function renderShell() {
  app.innerHTML = '';
  if (isMobile()) renderMobileShell();
  else renderDesktopShell();

  renderPlayer(document.getElementById('player-root'));
  renderSidebarPlaylists();
  // Pas de doublons si on se reconnecte / re-render dans la même session.
  document.removeEventListener('melovo:playlists', renderSidebarPlaylists);
  document.addEventListener('melovo:playlists', renderSidebarPlaylists);
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
}

// Desktop : sidebar + topbar + barre de lecture pleine largeur.
function renderDesktopShell() {
  app.append(
    h('div', { class: 'layout' },
      h('aside', { class: 'sidebar' },
        h('a', { class: 'logo', href: '#/home' }, h('span', { class: 'logo-dot' }), 'Melovo'),
        h('nav', { class: 'nav' },
          navLink('#/home', 'home', 'Accueil'),
          navLink('#/search', 'search', 'Recherche'),
          navLink('#/import', 'upload', 'Importer')),
        h('hr', { class: 'sep' }),
        h('div', { class: 'sidebar-lib-head' },
          h('span', { class: 'sidebar-label' }, 'Bibliothèque'),
          h('button', { class: 'btn-icon', title: 'Nouvelle playlist', html: icon('plus', 16),
            onclick: () => openEditPlaylist(null) })),
        navLink('#/library', 'library', 'Ma bibliothèque'),
        h('div', { class: 'sidebar-playlists', id: 'sidebar-playlists' })),
      h('div', { class: 'main-wrap' },
        h('header', { class: 'topbar' },
          h('button', { class: 'avatar-btn', 'aria-label': 'Menu du compte',
            onclick: (e) => { e.stopPropagation(); accountMenu(e.currentTarget); } },
            avatar(state.me.username, 32))),
        h('main', { class: 'main', id: 'main' }))),
    h('footer', { class: 'player-bar', id: 'player-root' }));
}

// Onglets du bas (mobile) : Accueil · Recherche · Bibliothèque · Importer.
const MOBILE_TABS = [
  { hash: '#/home', icon: 'home', label: 'Accueil' },
  { hash: '#/search', icon: 'search', label: 'Recherche' },
  { hash: '#/playlists', icon: 'library', label: 'Bibliothèque' },
  { hash: '#/import', icon: 'upload', label: 'Importer' },
];

// Mobile : topbar (retour + avatar), contenu scrollable, mini-lecteur, onglets.
function renderMobileShell() {
  app.append(
    h('header', { class: 'mobile-topbar', id: 'mobile-topbar' },
      h('button', { class: 'btn-icon topbar-back', 'aria-label': 'Retour',
        onclick: () => history.back(), html: icon('arrow-left', 22) }),
      h('span', { class: 'topbar-brand' }, h('span', { class: 'logo-dot' }), 'Melovo'),
      h('button', { class: 'avatar-btn', 'aria-label': 'Menu du compte',
        onclick: (e) => { e.stopPropagation(); accountMenu(e.currentTarget); } },
        avatar(state.me.username, 32))),
    h('main', { class: 'main main-mobile', id: 'main' }),
    // sidebar-playlists cachée : conservée pour renderSidebarPlaylists (no-op visuel)
    h('div', { id: 'sidebar-playlists', hidden: true }),
    h('footer', { class: 'miniplayer-wrap', id: 'player-root' }),
    h('nav', { class: 'tabbar', id: 'tabbar' },
      MOBILE_TABS.map((t) => h('a', { class: 'tab', href: t.hash, 'data-tab': t.hash },
        h('span', { class: 'tab-icon', html: icon(t.icon, 22) }),
        h('span', { class: 'tab-label' }, t.label)))));
}

// Bascule desktop <-> mobile au redimensionnement / rotation.
let currentIsMobile = null;
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.me || state.me.must_change_password) return;
    if (isMobile() === currentIsMobile) return;
    currentIsMobile = isMobile();
    renderShell();
    route();
  }, 150);
});

function navLink(href, iconName, label) {
  return h('a', { class: 'nav-item', href, 'data-route': href },
    h('span', { class: 'nav-icon', html: icon(iconName, 20) }),
    h('span', { class: 'nav-label' }, label));
}

function renderSidebarPlaylists() {
  const el = document.getElementById('sidebar-playlists');
  if (!el) return;
  el.innerHTML = '';
  for (const p of state.playlists) {
    el.append(h('a', { class: 'nav-item playlist-item', href: `#/playlist/${p.id}`,
      'data-route': `#/playlist/${p.id}`, title: p.name },
      cover(p.cover_url, 32, 14),
      h('span', { class: 'nav-label' },
        h('span', { class: 'pl-name' }, p.name),
        p.role !== 'owner' ? h('span', { class: 'pl-owner' }, `de ${p.owner_name}`) : null)));
  }
}

function accountMenu(anchor) {
  openMenu(anchor, [
    { label: 'Paramètres', icon: 'settings', onClick: () => { location.hash = '#/settings'; } },
    state.me.is_admin && { label: 'Administration', icon: 'shield', onClick: () => { location.hash = '#/admin'; } },
    { label: 'Déconnexion', icon: 'log-out', onClick: async () => {
      await api.post('/api/auth/logout').catch(() => {});
      document.getElementById('audio').pause();
      state.me = null;
      applyTheme(null);
      renderLogin();
    } },
  ]);
}

// ------------------------------------------------------------------ Routeur
const routes = [
  [/^#\/home$/, () => homeView],
  [/^#\/search$/, () => searchView],
  [/^#\/import$/, () => importView],
  [/^#\/playlists$/, () => playlistsView],
  [/^#\/library$/, () => libraryView],
  [/^#\/playlist\/(\d+)$/, () => playlistView],
  [/^#\/settings$/, () => settingsView],
  [/^#\/admin$/, () => adminView],
];

// Onglet mobile mis en évidence selon la route (les pages de détail
// restent sous l'onglet « Bibliothèque »).
function activeTabFor(hash) {
  if (hash === '#/library' || hash.startsWith('#/playlist/')) return '#/playlists';
  return hash;
}

async function route() {
  const main = document.getElementById('main');
  if (!main || !state.me) return;
  const hash = location.hash || '#/home';

  if (hash === '#/admin' && !state.me.is_admin) { location.hash = '#/home'; return; }

  // état actif dans la sidebar (desktop)
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === hash));

  // état actif dans les onglets + bouton retour (mobile)
  const activeTab = activeTabFor(hash);
  document.querySelectorAll('.tab').forEach((a) =>
    a.classList.toggle('active', a.dataset.tab === activeTab));
  const topbar = document.getElementById('mobile-topbar');
  if (topbar) {
    const isRoot = MOBILE_TABS.some((t) => t.hash === hash);
    topbar.classList.toggle('show-back', !isRoot);
  }

  // Chaque vue est montée dans un conteneur NEUF : à la navigation suivante,
  // l'ancien conteneur quitte le DOM et ses écouteurs auto-nettoyés se retirent
  // (sinon les vues précédentes continueraient de réagir aux événements).
  main.innerHTML = '';
  main.scrollTop = 0;
  const page = h('div', { class: 'page' });
  main.append(page);
  for (const [re, getView] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await getView()(page, m[1]); }
      catch (ex) { if (ex.status !== 401) toast(ex.message, 'error'); }
      return;
    }
  }
  location.hash = '#/home';
}

boot();
