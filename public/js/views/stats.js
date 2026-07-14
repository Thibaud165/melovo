// Statistiques d'écoute : podium des 3 titres les plus écoutés (façon table de
// DJ), temps d'écoute total, sons différents, graphique des 30 derniers jours.
import { api } from '../api.js';
import { h, cover, fmtTotal, emptyState } from '../ui.js';

export async function statsView(root) {
  root.append(h('h1', { class: 'page-title' }, 'Statistiques'));
  const data = await api.get('/api/stats');

  if (!data.total_seconds && !data.top.length) {
    root.append(emptyState('music', 'Aucune écoute pour l’instant. Lancez de la musique et revenez ici !'));
    return;
  }

  // --- Podium « table de DJ » : top 3 covers + barres dégradées par rang ------
  if (data.top.length) {
    root.append(h('h2', { class: 'section-title' }, 'Vos titres les plus écoutés'));
    const podium = h('div', { class: 'dj-podium' });
    data.top.forEach((s, i) => {
      const rank = i + 1;
      // « Table de mixage » : quelques barres, plus claires pour le top 1.
      const bars = h('div', { class: 'dj-bars' },
        Array.from({ length: 5 }, () => h('span', {})));
      podium.append(h('div', { class: `dj-col dj-rank-${rank}` },
        h('div', { class: 'dj-cover' }, cover(s.cover_url, 0, 28)),
        bars,
        h('div', { class: 'dj-info' },
          h('span', { class: 'dj-rank-num' }, `top ${rank}`),
          h('span', { class: 'dj-title' }, s.title),
          h('span', { class: 'dj-plays' }, `${s.plays} écoute${s.plays > 1 ? 's' : ''}`))));
    });
    root.append(podium);
  }

  // --- Chiffres clés ----------------------------------------------------------
  root.append(h('div', { class: 'stat-cards' },
    statCard('Temps d’écoute total', fmtTotal(data.total_seconds)),
    statCard('Sons différents écoutés', String(data.distinct_songs))));

  // --- Graphique 30 jours -----------------------------------------------------
  root.append(h('h2', { class: 'section-title' }, '30 derniers jours'));
  root.append(dailyChart(data.days));
}

function statCard(label, value) {
  return h('div', { class: 'stat-card' },
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-label' }, label));
}

// Graphique à barres verticales : hauteur = temps écouté du jour.
function dailyChart(days) {
  const max = Math.max(1, ...days.map((d) => d.seconds));
  const chart = h('div', { class: 'daily-chart' },
    days.map((d) => {
      const min = Math.round(d.seconds / 60);
      const pct = Math.round((d.seconds / max) * 100);
      const label = new Date(d.day + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      return h('div', { class: 'daily-col', title: `${label} · ${min} min` },
        h('div', { class: 'daily-bar', style: `height:${d.seconds ? Math.max(pct, 2) : 0}%` }));
    }));
  // Repères : premier et dernier jour.
  const first = new Date(days[0].day + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  const last = new Date(days[days.length - 1].day + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  return h('div', { class: 'daily-wrap' },
    chart,
    h('div', { class: 'daily-axis' }, h('span', {}, first), h('span', {}, `${Math.round(max / 60)} min max`), h('span', {}, last)));
}
