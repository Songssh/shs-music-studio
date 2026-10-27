import type Database from 'better-sqlite3';

/** Image metadata extends user_assets; ownership continues to have one authority. */
export function prepareImageSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_library (
      asset_id TEXT PRIMARY KEY REFERENCES user_assets(id), name TEXT NOT NULL,
      format TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL, source TEXT NOT NULL, registered_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS image_digest ON image_library(sha256);
    CREATE TABLE IF NOT EXISTS image_variants (
      image_id TEXT NOT NULL REFERENCES image_library(asset_id) ON DELETE CASCADE,
      transform TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES user_assets(id),
      PRIMARY KEY(image_id,transform));
    CREATE TABLE IF NOT EXISTS song_image_refs (
      song_id TEXT PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
      image_id TEXT NOT NULL REFERENCES image_library(asset_id), crop TEXT,
      cover_url TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desktop_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id), data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);
}
