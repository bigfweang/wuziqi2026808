export type GameRoomStatus = "waiting" | "active" | "finished";

export function describeGameOutcome(
  status: GameRoomStatus,
  winner: 0 | 1 | 2,
  selfSide: 1 | 2,
  opponentName: string,
) {
  if (status !== "finished") return null;
  if (winner === 0) {
    return {
      title: "本局和棋",
      detail: "棋盘已经落满，双方平分秋色。",
      isDraw: true,
    };
  }
  return {
    title: winner === selfSide ? "你赢了" : `${opponentName}赢了`,
    detail: "棋局和战绩已经保存到服务器。",
    isDraw: false,
  };
}

export function shouldApplyRoomResponse(input: {
  expectedGeneration: number;
  currentGeneration: number;
  currentRoomId: string;
  responseRoomId: string;
  currentRevision: number;
  responseRevision: number;
}) {
  if (input.expectedGeneration !== input.currentGeneration) return false;
  if (input.currentRoomId && input.currentRoomId !== input.responseRoomId) return false;
  if (input.currentRoomId === input.responseRoomId && input.responseRevision < input.currentRevision) return false;
  return true;
}
