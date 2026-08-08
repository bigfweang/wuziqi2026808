export type Stone = 0 | 1 | 2;
export type Move = { index: number; stone: 1 | 2 };
export const BOARD_SIZE = 15;
export const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
export const EMPTY_BOARD = "0".repeat(CELL_COUNT);

export function parseBoard(value: string): Stone[] {
  if (value.length !== CELL_COUNT || /[^012]/.test(value)) return Array.from({ length: CELL_COUNT }, () => 0 as Stone);
  return Array.from(value, (char) => Number(char) as Stone);
}
export const serializeBoard = (board: Stone[]) => board.join("");

export function findWinningLine(board: Stone[], index: number, stone: 1 | 2) {
  const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [index];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r * BOARD_SIZE + c] === stone) {
        if (sign < 0) line.unshift(r * BOARD_SIZE + c); else line.push(r * BOARD_SIZE + c);
        r += dr * sign; c += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
