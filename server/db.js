import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.resolve('data/app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS invites (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    from_name       TEXT,
    message         TEXT,
    max_days        INTEGER NOT NULL DEFAULT 14,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    opened_at       TEXT,
    open_count      INTEGER NOT NULL DEFAULT 0,
    accepted_at     TEXT,
    no_attempts     INTEGER NOT NULL DEFAULT 0,
    puzzle_at       TEXT,
    foods           TEXT,
    activities      TEXT,
    date            TEXT,
    time            TEXT,
    note            TEXT,
    completed_at    TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// köhnə bazalar üçün yeni sütunlar
const cols = db
  .prepare('PRAGMA table_info(invites)')
  .all()
  .map((c) => c.name);
for (const col of ['answers', 'stats']) {
  if (!cols.includes(col)) db.exec(`ALTER TABLE invites ADD COLUMN ${col} TEXT`);
}
