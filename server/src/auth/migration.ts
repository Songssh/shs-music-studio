import type Database from 'better-sqlite3';
import { prepareImageSchema } from '../services/images/schema.js';

/** Additive and repeatable: keep legacy IDs and file references intact. */
export function prepareIdentitySchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS registration_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('open','invite','closed')),
      bootstrap_complete INTEGER NOT NULL DEFAULT 0, legacy_user_id TEXT, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS registration_invites (
      digest TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_by TEXT, created_by TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_assets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS user_assets_owner ON user_assets(user_id);
    CREATE TABLE IF NOT EXISTS assistant_messages (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,content TEXT NOT NULL,status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS assistant_messages_owner ON assistant_messages(user_id);
    CREATE TABLE IF NOT EXISTS auth_daw_keys(user_id TEXT PRIMARY KEY REFERENCES users(id),digest TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resource_owners (
      kind TEXT NOT NULL, resource_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY(kind,resource_id));`);
  const cols = new Set((db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(c => c.name));
  const additions: Record<string, string> = {
    email: 'TEXT COLLATE NOCASE', emailVerified: 'INTEGER NOT NULL DEFAULT 0',
    auth_created_at: 'INTEGER NOT NULL DEFAULT 0', auth_updated_at: 'INTEGER NOT NULL DEFAULT 0',
    role: "TEXT NOT NULL DEFAULT 'user'", banned: 'INTEGER NOT NULL DEFAULT 0',
    banReason: 'TEXT', banExpires: 'INTEGER',
  };
  db.transaction(() => {
    for (const [column, definition] of Object.entries(additions)) {
      if (!cols.has(column)) db.exec(`ALTER TABLE users ADD COLUMN "${column}" ${definition}`);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL');
    const legacy = db.prepare('SELECT id FROM users ORDER BY created_at,id LIMIT 1').get() as {id: string} | undefined;
    db.prepare(`INSERT OR IGNORE INTO registration_settings(id,mode,legacy_user_id,updated_at)
      VALUES(1,'open',?,?)`).run(legacy?.id ?? null, Date.now());
    db.prepare('INSERT OR IGNORE INTO auth_migrations VALUES(1,?)').run(new Date().toISOString());
  })();
  prepareImageSchema(db);
}
