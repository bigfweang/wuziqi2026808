import { findRoom, getDb } from "../../../../lib/db";
import { authenticateRequest } from "../../../../lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOM_CODE_PATTERN = /^[23456789A-HJ-NP-Z]{6}$/;
const MIN_ACCESS_INFO_LENGTH = 8;
const MAX_ACCESS_INFO_LENGTH = 8192;
const DEFAULT_TTL_SECONDS = 600;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3600;

type GameServerRoomRow = {
  room_id: string;
  owner_user_id: string;
  access_info: string;
  created_at: string;
  expires_at: string;
};

const error = (message: string, status = 400) => Response.json({ error: message }, { status });

function cleanRoomId(value: unknown) {
  const roomId = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ROOM_CODE_PATTERN.test(roomId) ? roomId : "";
}

function roomSide(room: ReturnType<typeof findRoom>, userId: string) {
  if (!room) return 0;
  if (room.black_user_id === userId) return 1;
  if (room.white_user_id === userId) return 2;
  return 0;
}

export async function GET(request: Request) {
  const session = authenticateRequest(request);
  if (!session) return error("请先登录", 401);
  const roomId = cleanRoomId(new URL(request.url).searchParams.get("id"));
  if (!roomId) return error("房间号格式不正确");
  const room = findRoom(roomId);
  if (!room) return error("没有找到这个房间", 404);
  if (!roomSide(room, session.user.id)) return error("你还没有加入这个房间", 403);

  const broker = getDb().prepare(
    "SELECT * FROM gameserver_rooms WHERE room_id = ? LIMIT 1",
  ).get(roomId) as GameServerRoomRow | undefined;
  if (!broker) return error("微信房间尚未准备好", 404);
  if (Date.parse(broker.expires_at) <= Date.now()) {
    getDb().prepare("DELETE FROM gameserver_rooms WHERE room_id = ?").run(roomId);
    return error("微信房间凭证已过期，请房主重新创建", 410);
  }
  return Response.json({
    roomId,
    accessInfo: broker.access_info,
    expiresAt: broker.expires_at,
  });
}

export async function PUT(request: Request) {
  const session = authenticateRequest(request);
  if (!session) return error("请先登录", 401);
  let payload: { roomId?: string; accessInfo?: string; ttlSeconds?: number };
  try {
    payload = await request.json() as typeof payload;
  } catch {
    return error("请求内容不是有效 JSON");
  }

  const roomId = cleanRoomId(payload.roomId);
  if (!roomId) return error("房间号格式不正确");
  const room = findRoom(roomId);
  if (!room) return error("没有找到这个房间", 404);
  if (room.black_user_id !== session.user.id) return error("只有房主可以登记微信房间", 403);

  const accessInfo = typeof payload.accessInfo === "string" ? payload.accessInfo.trim() : "";
  if (accessInfo.length < MIN_ACCESS_INFO_LENGTH || accessInfo.length > MAX_ACCESS_INFO_LENGTH) {
    return error("微信房间凭证格式不正确");
  }
  const requestedTtl = Number(payload.ttlSeconds || DEFAULT_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(requestedTtl)
    ? Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.round(requestedTtl)))
    : DEFAULT_TTL_SECONDS;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  getDb().prepare(`
    INSERT INTO gameserver_rooms (
      room_id, owner_user_id, access_info, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(room_id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      access_info = excluded.access_info,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(roomId, session.user.id, accessInfo, now.toISOString(), expiresAt);

  return Response.json({ roomId, expiresAt });
}
