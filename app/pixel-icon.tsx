type PixelIconName =
  | "back"
  | "close"
  | "copy"
  | "crown"
  | "draw"
  | "invite"
  | "join"
  | "plus"
  | "replay"
  | "resign"
  | "undo";

type PixelRect = readonly [x: number, y: number, width: number, height: number];

const ICON_RECTS: Record<PixelIconName, readonly PixelRect[]> = {
  back: [
    [1, 7, 13, 2],
    [3, 3, 2, 10],
    [1, 6, 2, 4],
    [5, 5, 2, 2],
    [5, 9, 2, 2],
  ],
  close: [
    [2, 2, 2, 2], [12, 2, 2, 2],
    [4, 4, 2, 2], [10, 4, 2, 2],
    [6, 6, 4, 4],
    [4, 10, 2, 2], [10, 10, 2, 2],
    [2, 12, 2, 2], [12, 12, 2, 2],
  ],
  copy: [
    [5, 1, 9, 2], [12, 3, 2, 9], [5, 3, 2, 2],
    [2, 4, 8, 2], [2, 6, 2, 9], [10, 6, 2, 9], [4, 13, 6, 2],
  ],
  crown: [
    [1, 3, 2, 7], [13, 3, 2, 7],
    [3, 5, 2, 5], [7, 3, 2, 7], [11, 5, 2, 5],
    [3, 8, 10, 4], [3, 13, 10, 2],
  ],
  draw: [
    [2, 4, 12, 3],
    [2, 10, 12, 3],
  ],
  invite: [
    [1, 3, 14, 2], [1, 5, 2, 9], [13, 5, 2, 9], [3, 13, 10, 2],
    [3, 5, 2, 2], [11, 5, 2, 2], [5, 7, 2, 2], [9, 7, 2, 2], [7, 9, 2, 2],
  ],
  join: [
    [7, 1, 2, 9], [9, 8, 4, 2], [11, 6, 2, 6],
    [4, 10, 7, 2], [2, 8, 2, 6], [4, 13, 9, 2],
  ],
  plus: [
    [7, 2, 2, 12],
    [2, 7, 12, 2],
  ],
  replay: [
    [3, 2, 8, 2], [1, 4, 2, 8], [3, 12, 8, 2], [11, 10, 2, 4],
    [11, 2, 2, 2], [11, 4, 4, 2], [13, 2, 2, 6],
  ],
  resign: [
    [2, 1, 2, 14], [4, 2, 9, 2], [4, 4, 7, 2], [4, 6, 9, 2],
    [11, 4, 2, 2], [1, 14, 6, 2],
  ],
  undo: [
    [1, 5, 7, 2], [1, 5, 2, 6], [3, 3, 2, 2], [3, 11, 2, 2],
    [8, 5, 4, 2], [12, 7, 2, 5], [10, 12, 2, 2], [6, 14, 4, 2],
  ],
};

export function PixelIcon({
  name,
  size = 16,
  className = "",
}: {
  name: PixelIconName;
  size?: 16 | 32;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`pixel-icon ${className}`.trim()}
      focusable="false"
      height={size}
      shapeRendering="crispEdges"
      viewBox="0 0 16 16"
      width={size}
    >
      {ICON_RECTS[name].map(([x, y, width, height], index) => (
        <rect fill="currentColor" height={height} key={`${name}-${index}`} width={width} x={x} y={y} />
      ))}
    </svg>
  );
}
