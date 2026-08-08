import {
  findRoomIn,
  updateRoomIn,
  withImmediateTransaction,
  type RoomPatch,
  type RoomRow,
} from "./db";
import { EMPTY_BOARD, findWinningLine, parseBoard, serializeBoard, type Move } from "./gomoku";
import { recordFinishedMatch } from "./users";

export class RoomCommandError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RoomCommandError";
  }
}

export function resolveRoomSide(room: RoomRow, token: string | null, userId?: string) {
  const userSide = userId === room.black_user_id
    ? 1
    : userId === room.white_user_id
      ? 2
      : 0;
  const tokenSide = token === room.black_token
    ? 1
    : token && token === room.white_token
      ? 2
      : 0;
  if (userSide && tokenSide && userSide !== tokenSide) {
    throw new RoomCommandError("登录身份与房间凭据不一致", 403);
  }
  return (userSide || tokenSide) as 0 | 1 | 2;
}

function parseMoves(value: string) {
  try {
    return JSON.parse(value) as Move[];
  } catch {
    return [];
  }
}

export function applyRoomCommand(input: {
  id: string;
  token: string;
  userId?: string;
  action?: string;
  index?: number;
}) {
  return withImmediateTransaction((db) => {
    const current = findRoomIn(db, input.id);
    if (!current) throw new RoomCommandError("没有找到这个房间", 404);

    const side = resolveRoomSide(current, input.token || null, input.userId);
    if (!side) throw new RoomCommandError("你不在这局棋里", 403);
    const linkedUserId = side === 1 ? current.black_user_id : current.white_user_id;
    if (linkedUserId && linkedUserId !== input.userId) {
      throw new RoomCommandError("登录身份与棋手不一致", 403);
    }

    let patch: RoomPatch;
    if (input.action === "move") {
      if (current.status !== "active") {
        throw new RoomCommandError(current.status === "waiting" ? "等朋友加入后再落子" : "这局已经结束了", 409);
      }
      if (current.turn !== side) throw new RoomCommandError("还没轮到你", 409);
      if (!Number.isInteger(input.index) || input.index! < 0 || input.index! >= 225) {
        throw new RoomCommandError("落子位置不对", 400);
      }
      const board = parseBoard(current.board);
      if (board[input.index!]) throw new RoomCommandError("这里已经有棋子了", 409);
      board[input.index!] = side;
      const moves = parseMoves(current.moves);
      moves.push({ index: input.index!, stone: side });
      const won = findWinningLine(board, input.index!, side).length > 0;
      patch = {
        board: serializeBoard(board),
        moves: JSON.stringify(moves),
        turn: side === 1 ? 2 : 1,
        status: won || moves.length === 225 ? "finished" : "active",
        winner: won ? side : 0,
      };
    } else if (input.action === "undo") {
      if (current.status !== "active") {
        throw new RoomCommandError("只有进行中的棋局可以悔棋", 409);
      }
      const moves = parseMoves(current.moves);
      const last = moves.at(-1);
      if (!last || last.stone !== side || current.turn === side) {
        throw new RoomCommandError("只能撤回自己刚走的那一步", 409);
      }
      const board = parseBoard(current.board);
      board[last.index] = 0;
      moves.pop();
      patch = {
        board: serializeBoard(board),
        moves: JSON.stringify(moves),
        turn: side,
        status: "active",
        winner: 0,
      };
    } else if (input.action === "resign") {
      if (current.status !== "active") throw new RoomCommandError("现在不能认输", 409);
      patch = { status: "finished", winner: side === 1 ? 2 : 1 };
    } else if (input.action === "reset") {
      if (current.status !== "finished") {
        throw new RoomCommandError("只有结束后才能再来一局", 409);
      }
      recordFinishedMatch(current, db);
      patch = {
        board: EMPTY_BOARD,
        moves: "[]",
        turn: 1,
        status: current.white_token ? "active" : "waiting",
        winner: 0,
        round: current.round + 1,
      };
    } else {
      throw new RoomCommandError("不支持的操作", 400);
    }

    const updated = updateRoomIn(db, current.id, current.revision, patch);
    if (!updated) throw new RoomCommandError("棋局刚刚变化了，请再试一次", 409);
    if (updated.status === "finished") recordFinishedMatch(updated, db);
    return { room: updated, side };
  });
}
