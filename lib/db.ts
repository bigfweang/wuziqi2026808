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
};

const columns: Record<keyof RoomPatch, string> = {
  whiteToken: "white_token",
  whiteName: "white_name",
  board: "board",
  moves: "moves",
  turn: "turn",
  status: "status",
  winner: "winner",
};

declare global {
  var pixelGomokuDb: DatabaseSync | undefined;
}

function openDatabase() {
  const dataDirectory = process.env.DATA_DIR || join(process.cwd(), "data");
  mkdirSync(dataDirectory, { recursive: true });
  const databasePath = process.env.DATABASE_PATH || join(dataDirectory, "gomoku.db");
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
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
  return db;
}

export function getDb() {
  if (!globalThis.pixelGomokuDb) globalThis.pixelGomokuDb = openDatabase();
  return globalThis.pixelGomokuDb;
}

export function findRoom(id: string) {
  return getDb().prepare("SELECT * FROM rooms WHERE id = ? LIMIT 1").get(id) as RoomRow | undefined;
}

export function insertRoom(id: string, blackToken: string, blackName: string, board: string) {
  return getDb().prepare(`
    INSERT INTO rooms (id, black_token, black_name, board)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `).get(id, blackToken, blackName, board) as RoomRow;
}

export function updateRoom(id: string, revision: number, patch: RoomPatch) {
  const entries = Object.entries(patch) as Array<[keyof RoomPatch, string | number | null]>;
  if (!entries.length) return findRoom(id);
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  const now = new Date().toISOString();
  const statement = getDb().prepare(`
    UPDATE rooms
    SET ${assignments}, revision = revision + 1, updated_at = ?
    WHERE id = ? AND revision = ?
    RETURNING *
  `);
  return statement.get(...values, now, id, revision) as RoomRow | undefined;
}
