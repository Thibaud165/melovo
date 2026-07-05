// Store de sessions persistant minimaliste sur SQLite (évite une dépendance de plus).
import session from 'express-session';
import db from '../db.js';

const ONE_DAY = 86_400_000;

export class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ' +
      'ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires'
    );
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.purgeStmt = db.prepare('DELETE FROM sessions WHERE expires < ?');
    // Purge périodique des sessions expirées (toutes les heures).
    this.timer = setInterval(() => this.purgeStmt.run(Date.now()), 3_600_000);
    this.timer.unref();
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie?.maxAge ?? 30 * ONE_DAY;
      this.setStmt.run(sid, JSON.stringify(sess), Date.now() + maxAge);
      cb?.(null);
    } catch (err) { cb?.(err); }
  }

  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb?.(null); } catch (err) { cb?.(err); }
  }

  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
