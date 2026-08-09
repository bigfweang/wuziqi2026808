import { findRoom, insertRoom, updateRoom, type RoomRow } from "../../../lib/db";
import { EMPTY_BOARD, findWinningLine, parseBoard, type Move } from "../../../lib/gomoku";
import { createRoomPassword, RoomPasswordError, verifyRoomPassword } from "../../../lib/room-password";
import { consumeRequestLimit, type RateLimitResult } from "../../../lib/request-rate-limit";
import { mutationOriginError } from "../../../lib/request-security";
import { applyRoomCommand, resolveRoomSide, RoomCommandError } from "../../../lib/room-service";
import { authenticateRequest, playerView } from "../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_PATTERN = /^[23456789A-HJ-NP-Z]{6}$/;
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
    hasPassword: Boolean(room.password_hash),
    blackName: room.black_name,
    whiteName: room.white_name,
    blackPlayer: playerView(room.black_user_id, room.black_name, 1),
    whitePlayer: room.white_token ? playerView(room.white_user_id, room.white_name, 2) : null,
  };
}

function roomResponse(transport: "cookie" | "bearer", room: ReturnType<typeof view>, token: string) {
  return transport === "bearer" ? { token, room } : { room };
}

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function rateLimitError(result: RateLimitResult) {
  return Response.json(
    { error: "尝试过于频繁，请稍后再试" },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").toUpperCase();
  const session = authenticateRequest(request);
  if (!session) return error("请先注册或登录", 401);
  const token = session.transport === "bearer" ? url.searchParams.get("token") || "" : "";
  if (!id) return error("缺少房间信息");
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
  let payload: { action?: string; id?: string; name?: string; token?: string; password?: string };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }
  const session = authenticateRequest(request);
  if (!session) return error("请先注册或登录", 401);
  const originError = mutationOriginError(request, session.transport);
  if (originError) return originError;
  if (payload.action === "create") {
    const requestLimit = consumeRequestLimit(request, session?.user.id, {
      scope: "room-create",
      userLimit: 10,
      ipLimit: 20,
      globalLimit: 120,
    });
    if (!requestLimit.allowed) return rateLimitError(requestLimit);
    let roomPassword: Awaited<ReturnType<typeof createRoomPassword>>;
    try {
      roomPassword = await createRoomPassword(payload.password);
    } catch (caught) {
      if (caught instanceof RoomPasswordError) return error(caught.message);
      throw caught;
    }
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
          roomPassword.salt,
          roomPassword.hash,
        );
        return Response.json(
          roomResponse(session.transport, view(room, token, session.user.id), token),
          { status: 201 },
        );
      } catch (caught) {
        if (attempt === 4) throw caught;
      }
    }
  }

  if (payload.action === "join") {
    try {
      const id = (payload.id || "").trim().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(id)) return error("房间号格式不正确");
      const requestLimit = consumeRequestLimit(request, session?.user.id, {
        scope: "room-join",
        userLimit: 12,
        ipLimit: 30,
        globalLimit: 240,
      });
      if (!requestLimit.allowed) return rateLimitError(requestLimit);
      const current = findRoom(id);
      if (!current) return error("没有找到这个房间", 404);
      const existingSide = sideFor(
        current,
        session.transport === "bearer" ? payload.token || null : null,
        session.user.id,
      );
      if (existingSide) {
        const existingToken = tokenFor(current, existingSide);
        return Response.json(roomResponse(
          session.transport,
          view(current, existingToken || "", session.user.id),
          existingToken || "",
        ));
      }
      if (!(await verifyRoomPassword(payload.password, current.password_salt, current.password_hash))) {
        return error("房间密码不正确", 403);
      }
      if (current.white_token) return error("这局已经坐满啦", 409);
      const token = makeToken();
      const updated = updateRoom(id, current.revision, {
        whiteToken: token,
        whiteName: session?.user.nickname || cleanName(payload.name, "好友"),
        whiteUserId: session?.user.id || null,
        status: "active",
      });
      return updated
        ? Response.json(roomResponse(session.transport, view(updated, token, session.user.id), token))
        : error("朋友刚刚抢先加入了", 409);
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
  if (!session) return error("请先注册或登录", 401);
  const originError = mutationOriginError(request, session.transport);
  if (originError) return originError;
  const id = (payload.id || "").trim().toUpperCase();
  const token = session.transport === "bearer" ? payload.token || "" : "";
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
