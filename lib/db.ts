import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type RoomRow = {
  id: string;
  black_token: string;
  white_token: string | null;
  black_name: string;
  white_name: string | null;
  board: string;
  moves: string;
  turn: number;
  status: string;
  winner: number;
  black_user_id: string | null;
  white_user_id: string | null;
  round: number;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type RoomPatch = {
  whiteToken?: string | null;
  whiteName?: string | null;
  board?: string;
  moves?: string;
  turn?: number;
  status?: string;
  winner?: number;
  blackUserId?: string | null;
  whiteUserId?: string | null;
  round?: number;
};

const columns: Record<keyof RoomPatch, string> = {
  whiteToken: "white_token",
  whiteName: "white_name",
  board: "board",
  moves: "moves",
  turn: "turn",
  status: "status",
  winner: "winner",
  blackUserId: "black_user_id",
  whiteUserId: "white_user_id",
  round: "round",
};

declare global {
  var pixelGomokuDb: DatabaseSync | undefined;
}

function migrateDatabase(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY NOT NULL,
        black_token TEXT NOT NULL,
        white_token TEXT,
        black_name TEXT NOT NULL DEFAULT '我',
        white_name TEXT,
        board TEXT NOT NULL,
        moves TEXT NOT NULL DEFAULT '[]',
        turn INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'waiting',
        winner INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const roomColumns = new Set(
      (db.prepare("PRAGMA table_info(rooms)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    const migrations = [
      ["black_user_id", "ALTER TABLE rooms ADD COLUMN black_user_id TEXT"],
      ["white_user_id", "ALTER TABLE rooms ADD COLUMN white_user_id TEXT"],
      ["round", "ALTER TABLE rooms ADD COLUMN round INTEGER NOT NULL DEFAULT 1"],
    ] as const;
    for (const [column, sql] of migrations) {
      if (!roomColumns.has(column)) db.exec(sql);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        avatar_id INTEGER NOT NULL CHECK (avatar_id BETWEEN 1 AND 9),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(provider, provider_user_id)
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY NOT NULL,
        room_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        black_user_id TEXT,
        white_user_id TEXT,
        winner_user_id TEXT,
        result TEXT NOT NULL CHECK (result IN ('black', 'white', 'draw')),
        ended_at TEXT NOT NULL,
        UNIQUE(room_id, round)
      );
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS matches_black_user_idx ON matches(black_user_id, ended_at DESC);
      CREATE INDEX IF NOT EXISTS matches_white_user_idx ON matches(white_user_id, ended_at DESC);
      CREATE INDEX IF NOT EXISTS rooms_black_user_idx ON rooms(black_user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS rooms_white_user_idx ON rooms(white_user_id, updated_at DESC);
      PRAGMA user_version = 1;
    `);
    db.exec("COMMIT");
  } catch (caught) {
    db.exec("ROLLBACK");
    throw caught;
  }
}

function openDatabase() {
  const dataDirectory = process.env.DATA_DIR || join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = process.env.DATABASE_PATH || join(dataDirectory, "gomoku.db");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

export function getDb() {
  if (!globalThis.pixelGomokuDb) globalThis.pixelGomokuDb = openDatabase();
  return globalThis.pixelGomokuDb;
}

export function withImmediateTransaction<T>(operation: (db: DatabaseSync) => T) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation(db);
    db.exec("COMMIT");
    return result;
  } catch (caught) {
    db.exec("ROLLBACK");
    throw caught;
  }
}

export function findRoomIn(db: DatabaseSync, id: string) {
  return db.prepare("SELECT * FROM rooms WHERE id = ? LIMIT 1").get(id) as RoomRow | undefined;
}

export function findRoom(id: string) {
  return findRoomIn(getDb(), id);
}

export function insertRoom(id: string, blackToken: string, blackName: string, board: string, blackUserId?: string) {
  return getDb().prepare(`
    INSERT INTO rooms (id, black_token, black_name, board, black_user_id)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `).get(id, blackToken, blackName, board, blackUserId || null) as RoomRow;
}

export function updateRoomIn(db: DatabaseSync, id: string, revision: number, patch: RoomPatch) {
  const entries = Object.entries(patch) as Array<[keyof RoomPatch, string | number | null]>;
  if (!entries.length) return findRoomIn(db, id);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  const now = new Date().toISOString();
  const statement = db.prepare(`
    UPDATE rooms
    SET ${assignments}, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ?
    RETURNING *
  `);
  return statement.get(...values, now, id, revision) as RoomRow | undefined;
}

export function updateRoom(id: string, revision: number, patch: RoomPatch) {
  return updateRoomIn(getDb(), id, revision, patch);
}
