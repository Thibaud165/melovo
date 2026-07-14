// Statistiques d'écoute : enregistre le temps réellement écouté et renvoie
// les agrégats (total, top 3, sons différents, 30 derniers jours).
import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../lib/util.js';

const router = Router();
router.use(requireAuth);

// Seuil sous lequel un son n'est pas compté comme « écouté » (anti-effleurement).
const DISTINCT_MIN_SECONDS = 20;

// Enregistre un lot de secondes écoutées pour un son.
// Alimente : total cumulé (jamais purgé), temps par son, temps du jour.
const addTotal = db.prepare(`
  INSERT INTO user_stats (user_id, total_seconds) VALUES (@uid, @s)
  ON CONFLICT(user_id) DO UPDATE SET total_seconds = total_seconds + @s
`);
const addSong = db.prepare(`
  INSERT INTO listen_song (user_id, song_id, seconds) VALUES (@uid, @sid, @s)
  ON CONFLICT(user_id, song_id) DO UPDATE SET seconds = seconds + @s
`);
const addDay = db.prepare(`
  INSERT INTO listen_day (user_id, day, seconds) VALUES (@uid, date('now'), @s)
  ON CONFLICT(user_id, day) DO UPDATE SET seconds = seconds + @s
`);
// Purge du détail journalier au-delà de 30 jours (on garde le total cumulé).
const pruneDays = db.prepare("DELETE FROM listen_day WHERE user_id = ? AND day < date('now', '-30 days')");

router.post('/listen', (req, res) => {
  const uid = req.session.userId;
  const songId = Number(req.body?.song_id);
  let seconds = Number(req.body?.seconds);
  if (!Number.isInteger(songId) || !Number.isFinite(seconds)) {
    return res.status(400).json({ error: 'Requête invalide.' });
  }
  // Borne défensive : jamais négatif, jamais plus de 10 min d'un coup.
  seconds = Math.max(0, Math.min(seconds, 600));
  if (seconds < 1) return res.json({ ok: true });

  db.transaction(() => {
    addTotal.run({ uid, s: seconds });
    // Le temps par son n'a de sens que si le son existe encore.
    if (db.prepare('SELECT 1 FROM songs WHERE id = ?').get(songId)) {
      addSong.run({ uid, sid: songId, s: seconds });
    }
    addDay.run({ uid, s: seconds });
    pruneDays.run(uid);
  })();
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const uid = req.session.userId;

  const total = db.prepare('SELECT total_seconds FROM user_stats WHERE user_id = ?').get(uid);
  const totalSeconds = Math.round(total?.total_seconds ?? 0);

  const distinct = db.prepare(
    'SELECT COUNT(*) AS n FROM listen_song WHERE user_id = ? AND seconds >= ?'
  ).get(uid, DISTINCT_MIN_SECONDS).n;

  // Top 3 : « nombre d'écoutes » = temps écouté / durée du son (arrondi).
  // Évite qu'un appui répété compte pour plusieurs écoutes.
  const top = db.prepare(`
    SELECT s.id, s.title, s.artist, s.cover_path, s.duration_seconds, ls.seconds,
           CASE WHEN s.duration_seconds > 0
                THEN ls.seconds / s.duration_seconds ELSE 0 END AS plays
    FROM listen_song ls
    JOIN songs s ON s.id = ls.song_id
    WHERE ls.user_id = ? AND s.owner_id = ?
    ORDER BY plays DESC LIMIT 3
  `).all(uid, uid).map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    cover_url: r.cover_path ? `/media/covers/${r.cover_path}` : null,
    plays: Math.max(1, Math.round(r.plays)),
    seconds: Math.round(r.seconds),
  }));

  // 30 derniers jours : une valeur par jour (0 si rien écouté ce jour-là).
  const rows = db.prepare(
    "SELECT day, seconds FROM listen_day WHERE user_id = ? AND day >= date('now','-29 days')"
  ).all(uid);
  const byDay = new Map(rows.map((r) => [r.day, r.seconds]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    // Construit la date AAAA-MM-JJ de i jours en arrière (côté SQLite pour cohérence).
    const d = db.prepare("SELECT date('now', ?) AS d").get(`-${i} days`).d;
    days.push({ day: d, seconds: Math.round(byDay.get(d) ?? 0) });
  }

  res.json({ total_seconds: totalSeconds, distinct_songs: distinct, top, days });
});

export default router;
