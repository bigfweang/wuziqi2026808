import { findRoom, insertRoom, updateRoom, type RoomPatch, type RoomRow } from "../../../lib/db";
import { EMPTY_BOARD, findWinningLine, parseBoard, serializeBoard, type Move } from "../../../lib/gomoku";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
const makeToken = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const cleanName = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 12) : fallback;

function sideFor(room: RoomRow, token: string | null) {
  if (token && token === room.black_token) return 1 as const;
  if (token && token === room.white_token) return 2 as const;
  return 0 as const;
}

function view(room: RoomRow, token: string) {
  const side = sideFor(room, token);
  if (!side) return null;
  let moves: Move[] = [];
  try { moves = JSON.parse(room.moves) as Move[]; } catch { moves = []; }
  const last = moves.at(-1);
  const winningLine = last && room.winner ? findWinningLine(parseBoard(room.board), last.index, room.winner as 1 | 2) : [];
  return {
    id: room.id,
    side,
    board: room.board,
    moves,
    turn: room.turn,
    status: room.status,
    winner: room.winner,
    winningLine,
    revision: room.revision,
    blackName: room.black_name,
    whiteName: room.white_name,
  };
}

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").toUpperCase();
  const token = url.searchParams.get("token") || "";
  if (!id || !token) return error("缺少房间信息");
  const room = findRoom(id);
  if (!room) return error("没有找到这个房间", 404);
  const result = view(room, token);
  return result ? Response.json({ room: result }) : error("你还没有加入这局棋", 403);
}

export async function POST(request: Request) {
  const payload = await request.json() as { action?: string; id?: string; name?: string; token?: string };
  if (payload.action === "create") {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = makeCode();
      const token = makeToken();
      try {
        const room = insertRoom(id, token, cleanName(payload.name, "我"), EMPTY_BOARD);
        return Response.json({ token, room: view(room, token) }, { status: 201 });
      } catch (caught) {
        if (attempt === 4) throw caught;
      }
    }
  }

  if (payload.action === "join") {
    const id = (payload.id || "").trim().toUpperCase();
    const current = id ? findRoom(id) : undefined;
    if (!current) return error("没有找到这个房间", 404);
    if (payload.token && sideFor(current, payload.token)) return Response.json({ token: payload.token, room: view(current, payload.token) });
    if (current.white_token) return error("这局已经坐满啦", 409);
    const token = makeToken();
    const updated = updateRoom(id, current.revision, {
      whiteToken: token,
      whiteName: cleanName(payload.name, "好友"),
      status: "active",
    });
    return updated ? Response.json({ token, room: view(updated, token) }) : error("朋友刚刚抢先加入了", 409);
  }

  return error("不支持的操作");
}

export async function PATCH(request: Request) {
  const payload = await request.json() as { action?: string; id?: string; token?: string; index?: number };
  const id = (payload.id || "").trim().toUpperCase();
  const token = payload.token || "";
  const current = findRoom(id);
  if (!current) return error("没有找到这个房间", 404);
  const side = sideFor(current, token);
  if (!side) return error("你不在这局棋里", 403);
  let patch: RoomPatch;

  if (payload.action === "move") {
    if (current.status !== "active") return error(current.status === "waiting" ? "等朋友加入后再落子" : "这局已经结束了", 409);
    if (current.turn !== side) return error("还没轮到你", 409);
    const index = payload.index;
    if (!Number.isInteger(index) || index! < 0 || index! >= 225) return error("落子位置不对");
    const board = parseBoard(current.board);
    if (board[index!]) return error("这里已经有棋子了", 409);
    board[index!] = side;
    let moves: Move[] = [];
    try { moves = JSON.parse(current.moves) as Move[]; } catch { moves = []; }
    moves.push({ index: index!, stone: side });
    const won = findWinningLine(board, index!, side).length > 0;
    patch = {
      board: serializeBoard(board),
      moves: JSON.stringify(moves),
      turn: side === 1 ? 2 : 1,
      status: won || moves.length === 225 ? "finished" : "active",
      winner: won ? side : 0,
    };
  } else if (payload.action === "undo") {
    let moves: Move[] = [];
    try { moves = JSON.parse(current.moves) as Move[]; } catch { moves = []; }
    const last = moves.at(-1);
    if (!last || last.stone !== side || current.turn === side) return error("只能撤回自己刚走的那一步", 409);
    const board = parseBoard(current.board);
    board[last.index] = 0;
    moves.pop();
    patch = { board: serializeBoard(board), moves: JSON.stringify(moves), turn: side, status: "active", winner: 0 };
  } else if (payload.action === "resign") {
    if (current.status !== "active") return error("现在不能认输", 409);
    patch = { status: "finished", winner: side === 1 ? 2 : 1 };
  } else if (payload.action === "reset") {
    patch = { board: EMPTY_BOARD, moves: "[]", turn: 1, status: current.white_token ? "active" : "waiting", winner: 0 };
  } else {
    return error("不支持的操作");
  }

  const updated = updateRoom(id, current.revision, patch);
  return updated ? Response.json({ room: view(updated, token) }) : error("棋局刚刚变化了，请再试一次", 409);
}
