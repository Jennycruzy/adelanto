import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Big numbers are stored as decimal strings; nothing here is ever rounded through a float.
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  chain TEXT NOT NULL, block INTEGER NOT NULL, tx TEXT NOT NULL, log_index INTEGER NOT NULL,
  contract TEXT NOT NULL, name TEXT NOT NULL, args TEXT NOT NULL, at INTEGER,
  PRIMARY KEY (chain, tx, log_index));
CREATE INDEX IF NOT EXISTS events_name ON events (name, block);
CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY, borrower TEXT NOT NULL, open INTEGER NOT NULL, collateral TEXT NOT NULL,
  debt TEXT NOT NULL, ltv_bps INTEGER, tier INTEGER, term_days INTEGER, opened_at INTEGER, due_at INTEGER,
  liquidated INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT 'USER', updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guard_limits (
  borrower TEXT PRIMARY KEY, limits TEXT NOT NULL, rule_hash TEXT NOT NULL, rule_text TEXT, tx TEXT, set_block INTEGER NOT NULL,
  active INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS arrivals (
  chain TEXT NOT NULL, tx TEXT NOT NULL, log_index INTEGER NOT NULL, borrower TEXT NOT NULL, from_addr TEXT NOT NULL,
  amount TEXT NOT NULL, block INTEGER NOT NULL, handled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chain, tx, log_index));
CREATE TABLE IF NOT EXISTS agent_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL, loan_id INTEGER, borrower TEXT, trigger_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL, decision TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, tx TEXT,
  sentence_es TEXT, sentence_en TEXT, error TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS actions_loan ON agent_actions (loan_id, at);
CREATE TABLE IF NOT EXISTS pending_tx (
  hash TEXT PRIMARY KEY, action_id INTEGER NOT NULL REFERENCES agent_actions(id), from_addr TEXT NOT NULL,
  nonce INTEGER NOT NULL, to_addr TEXT NOT NULL, data TEXT NOT NULL, raw TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, settled_at INTEGER);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, value REAL NOT NULL, observed_at INTEGER NOT NULL,
  raw TEXT);
CREATE INDEX IF NOT EXISTS prices_at ON prices (observed_at);
CREATE TABLE IF NOT EXISTS notices (
  key TEXT PRIMARY KEY, borrower TEXT, loan_id INTEGER, kind TEXT NOT NULL, text_es TEXT NOT NULL, text_en TEXT NOT NULL,
  created_at INTEGER NOT NULL, delivered_at INTEGER);
`;

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

export function getMeta(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: Db, key: string, value: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** JSON with bigints as strings. */
export function json(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
