import type Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { logger } from '../../infra/logger.js';

const log = logger.child({ module: 'memory-db' });

// ─── SCHEMA ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS conversations (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   TEXT    NOT NULL,
    role      TEXT    NOT NULL,
    content   TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations (user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS preferences (
    user_id    TEXT NOT NULL,
    pref_key   TEXT NOT NULL,
    pref_value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, pref_key)
  );

  CREATE TABLE IF NOT EXISTS searches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT    NOT NULL,
    query      TEXT    NOT NULL,
    url        TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_searches_user
    ON searches (user_id, created_at DESC);
`;

// ─── SINGLETON ────────────────────────────────────────────────────────────────

let _db: InstanceType<typeof Database> | null = null;

/**
 * Open (or create) the SQLite database and run schema migrations.
 * better-sqlite3 is loaded lazily (dynamic import inside this function)
 * so that importing this module in tests does NOT trigger the native addon load.
 * Tests inject a mock via setDbForTest() instead.
 */
export async function openDb(dbPath: string): Promise<InstanceType<typeof Database>> {
  if (_db) return _db;

  // Expand ~ to home directory
  const expanded = dbPath.startsWith('~')
    ? path.join(os.homedir(), dbPath.slice(1))
    : dbPath;

  // Ensure directory exists (skip for :memory: in tests)
  if (expanded !== ':memory:') {
    const dir = path.dirname(expanded);
    fs.mkdirSync(dir, { recursive: true });
  }

  // Lazy import — keeps the native module out of the module graph until needed
  const { default: SqliteDatabase } = await import('better-sqlite3');
  _db = new SqliteDatabase(expanded);

  // Enable WAL for better concurrent read performance
  (_db as any).pragma('journal_mode = WAL');
  (_db as any).pragma('foreign_keys = ON');

  // Create tables
  (_db as any).exec(SCHEMA_SQL);

  log.info({ path: expanded }, 'Memory DB opened');
  return _db;
}

/**
 * Synchronous openDb — used when the caller can't be async (e.g. init()).
 * Falls through to the async path if the DB isn't already open.
 */
export function openDbSync(dbPath: string): void {
  if (_db) return;
  // Fire-and-forget; caller must ensure openDb was already awaited before
  // any queries, or use setDbForTest() for test injection.
  void openDb(dbPath).catch(err => log.error({ err }, 'Failed to open memory DB'));
}

/**
 * Get the already-opened database. Throws if `openDb` was never called.
 */
export function getDb(): InstanceType<typeof Database> {
  if (!_db) throw new Error('Memory DB not initialized — call openDb() first');
  return _db;
}

/**
 * Close the database (used in tests and graceful shutdown).
 */
export function closeDb(): void {
  if (_db) {
    (_db as any).close();
    _db = null;
    log.info('Memory DB closed');
  }
}

/**
 * TEST ONLY — inject a mock Database instance without opening a real file.
 * Called from unit tests to avoid needing the native better-sqlite3 binary.
 * Never call this in production code.
 */
export function setDbForTest(mockDb: InstanceType<typeof Database>): void {
  _db = mockDb;
}
