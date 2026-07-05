// Administration : liste des comptes, création, reset de mot de passe, suppression.
import { api } from '../api.js';
import { state } from '../state.js';
import { h, toast, modal, confirmDialog, avatar, fmtDate } from '../ui.js';
import { icon } from '../icons.js';

export async function adminView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Administration'));
  const container = h('div', {});
  root.append(container);
  await renderUsers(container);
}

async function renderUsers(container) {
  container.innerHTML = '';
  const { users } = await api.get('/api/admin/users');

  // --- Création de compte ----------------------------------------------
  const username = h('input', { class: 'input', placeholder: 'pseudo.nom', maxlength: '60',
    autocomplete: 'off' });
  const password = h('input', { class: 'input', type: 'text', placeholder: 'Mot de passe provisoire',
    minlength: '8', autocomplete: 'off' });
  const err = h('p', { class: 'form-error' });
  const form = h('form', { class: 'admin-create' },
    h('div', { class: 'admin-create-fields' },
      h('div', {}, h('label', { class: 'label' }, 'Identifiant'), username),
      h('div', {}, h('label', { class: 'label' }, 'Mot de passe provisoire'), password),
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Créer le compte')),
    err,
    h('p', { class: 'muted' }, 'La personne devra choisir son propre mot de passe à sa première connexion.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      await api.post('/api/admin/users', { username: username.value, password: password.value });
      toast(`Compte « ${username.value} » créé.`, 'success');
      renderUsers(container);
    } catch (ex) { err.textContent = ex.message; }
  });

  container.append(h('section', { class: 'settings-section' },
    h('h2', { class: 'section-title' }, 'Créer un compte'), form));

  // --- Liste des comptes ------------------------------------------------
  const list = h('div', { class: 'admin-list' },
    h('div', { class: 'admin-row admin-head' },
      h('span', {}, 'Compte'), h('span', {}, 'Créé'), h('span', {}, 'Contenu'), h('span', {}, 'État'), h('span', {})),
    users.map((u) => h('div', { class: 'admin-row' },
      h('span', { class: 'admin-user' },
        avatar(u.username, 28),
        h('span', {}, u.username),
        u.is_admin ? h('span', { class: 'badge badge-accent', title: 'Administrateur', html: icon('shield', 12) }) : null),
      h('span', { class: 'mono muted' }, fmtDate(u.created_at)),
      h('span', { class: 'muted' }, `${u.song_count} titres · ${u.playlist_count} playlists`),
      h('span', {},
        u.must_change_password
          ? h('span', { class: 'badge' }, u.reset_code ? 'Code provisoire actif' : 'Doit changer son mot de passe')
          : h('span', { class: 'badge badge-ok' }, 'Actif')),
      h('span', { class: 'admin-actions' },
        h('button', { class: 'btn btn-secondary btn-sm', title: 'Réinitialiser le mot de passe',
          onclick: () => resetPassword(u, () => renderUsers(container)) },
          'Réinitialiser'),
        u.id !== state.me.id
          ? h('button', { class: 'btn btn-danger btn-sm', onclick: async () => {
              const ok = await confirmDialog(
                `Supprimer le compte « ${u.username} » ? Ses titres, fichiers et playlists seront définitivement supprimés.`,
                { confirmLabel: 'Supprimer', danger: true });
              if (!ok) return;
              try {
                await api.del(`/api/admin/users/${u.id}`);
                toast('Compte supprimé.', 'success');
                renderUsers(container);
              } catch (ex) { toast(ex.message, 'error'); }
            } }, 'Supprimer')
          : null))));

  container.append(h('section', { class: 'settings-section' },
    h('h2', { class: 'section-title' }, `Comptes (${users.length})`), list));
}

async function resetPassword(user, onDone) {
  const ok = await confirmDialog(
    `Générer un code provisoire pour « ${user.username} » ? Son mot de passe actuel sera invalidé.`,
    { confirmLabel: 'Générer le code' });
  if (!ok) return;
  try {
    const { code } = await api.post(`/api/admin/users/${user.id}/reset`);
    modal({
      title: 'Code provisoire généré',
      content: h('div', {},
        h('p', { class: 'modal-text' },
          `Transmettez ce code à ${user.username} : il lui servira de mot de passe pour sa prochaine connexion, puis il devra en choisir un nouveau.`),
        h('div', { class: 'reset-code mono' }, code),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn btn-secondary', onclick: () => {
            navigator.clipboard?.writeText(code).then(() => toast('Code copié.', 'success'));
          } }, 'Copier le code'))),
    });
    onDone();
  } catch (ex) { toast(ex.message, 'error'); }
}
