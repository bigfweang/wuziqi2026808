# Pixel Gomoku Mini Game — Visual System

## Direction

A quiet, friendly tabletop game rendered as a compact pixel interface: warm wood, off-white paper, dark forest green, simple square shadows, and visibly discrete pixel avatars. The game should feel like opening a small physical board-game box rather than entering a casino or competitive esports lobby.

## Tokens

| Role | Value |
|---|---|
| Ink | `#24312b` |
| Primary green | `#386e55` |
| Deep green | `#214b3a` |
| Paper | `#f8f5e9` |
| Muted text | `#738078` |
| Board wood | `#e6b570` |
| Board line | `#805a36` |
| Accent orange | `#e78d4d` |
| Result red | `#d95e49` |

## Rules

- Canvas reference width is 390 logical pixels; all layouts adapt to actual window height.
- Keep one dominant action per screen in green; secondary actions stay paper-white.
- Shadows use hard integer offsets (1–8 px), never blurred card shadows.
- Player identity always appears as avatar + nickname + presence dot + side.
- The board remains square. On short screens it shrinks before controls are clipped.
- A waiting opponent uses a visible placeholder and “等待好友”; never fake an online player.
- Win/loss/draw are textually distinct; a full board with `winner = 0` is explicitly “和棋”.
- Generated avatars are shown with nearest-neighbour image scaling and a 2 px dark border.

## Required screen states

1. Loading/development identity
2. Home without history
3. Home with resumable room
4. Waiting room
5. Active game with two online users
6. Opponent offline
7. Finished win/loss
8. Finished draw
9. Network error toast
