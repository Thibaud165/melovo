// Base SQLite (better-sqlite3) : schéma + seed du compte admin.
// Un seul fichier dans le volume data/ -> backup = copie du fichier.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import argon2 from 'argon2';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });
for (const dir of ['audio', 'covers', 'playlist-covers', 'tmp']) {
  fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'melovo.db'));
db.pragma('journal_mode = WAL'); // meilleures écritures concurrentes sur le Pi
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE,
    password_hash        TEXT NOT NULL,
    is_admin             INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    reset_code           TEXT,
    accent_color         TEXT NOT NULL DEFAULT '#E8A13C',
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS songs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    artist           TEXT,
    cover_path       TEXT,
    audio_path       TEXT NOT NULL,
    duration_seconds REAL NOT NULL DEFAULT 0,
    source           TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','youtube')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    cover_path TEXT,
    bg_color   TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    added_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS playlist_shares (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit    INTEGER NOT NULL DEFAULT 0,
    UNIQUE (playlist_id, user_id)
  );

  -- Store de sessions express-session (persistant, purgé des sessions expirées)
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    data    TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_songs_owner        ON songs(owner_id);
  CREATE INDEX IF NOT EXISTS idx_tracks_playlist    ON playlist_tracks(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_tracks_song        ON playlist_tracks(song_id);
  CREATE INDEX IF NOT EXISTS idx_shares_user        ON playlist_shares(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires);
`);

/** Seed du compte admin au premier démarrage, depuis le .env. */
export async function seedAdmin(username, password) {
  if (!username || !password) {
    console.warn('[seed] ADMIN_USERNAME / ADMIN_PASSWORD absents du .env — aucun admin créé.');
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return;
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  db.prepare(`
    INSERT INTO users (username, password_hash, is_admin, must_change_password)
    VALUES (?, ?, 1, 1)
  `).run(username, hash);
  console.log(`[seed] Compte admin « ${username} » créé (changement de mot de passe requis à la 1ère connexion).`);
}

export default db;
