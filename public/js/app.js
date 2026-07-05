// Shell de l'application : boot, écran de connexion, changement de mot de passe
// forcé, layout (sidebar + topbar + lecteur) et routeur par hash.
import { api } from './api.js';
import { state, refreshPlaylists, applyAccent } from './state.js';
import { h, toast, openMenu, avatar, cover } from './ui.js';
import { icon } from './icons.js';
import { renderPlayer } from './player.js';
import { homeView } from './views/home.js';
import { searchView } from './views/search.js';
import { importView } from './views/import.js';
import { libraryView } from './views/library.js';
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
  if (user.must_change_password) renderChangePassword();
  else startApp();
}

async function startApp() {
  await refreshPlaylists().catch(() => {});
  renderShell();
  // Si le hash change ici, l'événement hashchange déclenchera route() tout seul.
  if (!location.hash || location.hash === '#/') location.hash = '#/home';
  else route();
}

document.addEventListener('melovo:unauthorized', () => {
  state.me = null;
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

  renderPlayer(document.getElementById('player-root'));
  renderSidebarPlaylists();
  // Pas de doublons si on se reconnecte dans la même session.
  document.removeEventListener('melovo:playlists', renderSidebarPlaylists);
  document.addEventListener('melovo:playlists', renderSidebarPlaylists);
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
}

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
      renderLogin();
    } },
  ]);
}

// ------------------------------------------------------------------ Routeur
const routes = [
  [/^#\/home$/, () => homeView],
  [/^#\/search$/, () => searchView],
  [/^#\/import$/, () => importView],
  [/^#\/library$/, () => libraryView],
  [/^#\/playlist\/(\d+)$/, () => playlistView],
  [/^#\/settings$/, () => settingsView],
  [/^#\/admin$/, () => adminView],
];

async function route() {
  const main = document.getElementById('main');
  if (!main || !state.me) return;
  const hash = location.hash || '#/home';

  if (hash === '#/admin' && !state.me.is_admin) { location.hash = '#/home'; return; }

  // état actif dans la sidebar
  document.querySelectorAll('.nav-item').forEach((a) =>
    a.classList.toggle('active', a.dataset.route === hash));

  main.innerHTML = '';
  main.scrollTop = 0;
  for (const [re, getView] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await getView()(main, m[1]); }
      catch (ex) { if (ex.status !== 401) toast(ex.message, 'error'); }
      return;
    }
  }
  location.hash = '#/home';
}

boot();
