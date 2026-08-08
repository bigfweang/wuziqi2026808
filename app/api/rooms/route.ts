import { findRoom, insertRoom, updateRoom, type RoomRow } from "../../../lib/db";
import { EMPTY_BOARD, findWinningLine, parseBoard, type Move } from "../../../lib/gomoku";
import { applyRoomCommand, resolveRoomSide, RoomCommandError } from "../../../lib/room-service";
import { authenticateRequest, playerView } from "../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
const makeToken = () => `${crypto.randomUUID()}-${crypto.randomUUID()}`;
const cleanName = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().slice(0, 12) : fallback;

function sideFor(room: RoomRow, token: string | null, userId?: string) {
  return resolveRoomSide(room, token, userId);
}

function tokenFor(room: RoomRow, side: 1 | 2) {
  return side === 1 ? room.black_token : room.white_token;
}

function view(room: RoomRow, token: string, userId?: string) {
  const side = sideFor(room, token, userId);
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
    round: room.round,
    revision: room.revision,
    blackName: room.black_name,
    whiteName: room.white_name,
    blackPlayer: playerView(room.black_user_id, room.black_name, 1),
    whitePlayer: room.white_token ? playerView(room.white_user_id, room.white_name, 2) : null,
  };
}

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").toUpperCase();
  const token = url.searchParams.get("token") || "";
  const session = authenticateRequest(request);
  if (!id || (!token && !session)) return error("缺少房间信息");
  const room = findRoom(id);
  if (!room) return error("没有找到这个房间", 404);
  try {
    const result = view(room, token, session?.user.id);
    return result ? Response.json({ room: result }) : error("你还没有加入这局棋", 403);
  } catch (caught) {
    if (caught instanceof RoomCommandError) return error(caught.message, caught.status);
    throw caught;
  }
}

export async function POST(request: Request) {
  let payload: { action?: string; id?: string; name?: string; token?: string };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }
  const session = authenticateRequest(request);
  if (payload.action === "create") {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = makeCode();
      const token = makeToken();
      try {
        const room = insertRoom(
          id,
          token,
          session?.user.nickname || cleanName(payload.name, "我"),
          EMPTY_BOARD,
          session?.user.id,
        );
        return Response.json({ token, room: view(room, token, session?.user.id) }, { status: 201 });
      } catch (caught) {
        if (attempt === 4) throw caught;
      }
    }
  }

  if (payload.action === "join") {
    try {
      const id = (payload.id || "").trim().toUpperCase();
      const current = id ? findRoom(id) : undefined;
      if (!current) return error("没有找到这个房间", 404);
      const existingSide = sideFor(current, payload.token || null, session?.user.id);
      if (existingSide) {
        const existingToken = tokenFor(current, existingSide);
        return Response.json({ token: existingToken, room: view(current, existingToken || "", session?.user.id) });
      }
      if (current.white_token) return error("这局已经坐满啦", 409);
      const token = makeToken();
      const updated = updateRoom(id, current.revision, {
        whiteToken: token,
        whiteName: session?.user.nickname || cleanName(payload.name, "好友"),
        whiteUserId: session?.user.id || null,
        status: "active",
      });
      return updated ? Response.json({ token, room: view(updated, token, session?.user.id) }) : error("朋友刚刚抢先加入了", 409);
    } catch (caught) {
      if (caught instanceof RoomCommandError) return error(caught.message, caught.status);
      throw caught;
    }
  }

  return error("不支持的操作");
}

export async function PATCH(request: Request) {
  let payload: { action?: string; id?: string; token?: string; index?: number };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }
  const session = authenticateRequest(request);
  const id = (payload.id || "").trim().toUpperCase();
  const token = payload.token || "";
  try {
    const result = applyRoomCommand({
      id,
      token,
      userId: session?.user.id,
      action: payload.action,
      index: payload.index,
    });
    return Response.json({ room: view(result.room, token, session?.user.id) });
  } catch (caught) {
    if (caught instanceof RoomCommandError) return error(caught.message, caught.status);
    console.error("Failed to apply room command", caught);
    return error("保存棋局失败，请重试", 500);
  }
}
