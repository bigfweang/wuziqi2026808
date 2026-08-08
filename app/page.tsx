"use client";

import { useEffect, useRef, useState } from "react";
import { BOARD_SIZE, CELL_COUNT, findWinningLine, parseBoard, type Move, type Stone } from "../lib/gomoku";

type RoomView = {
  id: string; side: 1 | 2; board: string; moves: Move[]; turn: 1 | 2;
  status: "waiting" | "active" | "finished"; winner: Stone; winningLine: number[];
  revision: number; blackName: string; whiteName: string | null;
};

const STARS = new Set([48, 56, 112, 168, 176]);
const freshBoard = () => Array.from({ length: CELL_COUNT }, () => 0 as Stone);

function Avatar({ color, label }: { color: "green" | "orange"; label: string }) {
  return <div className={`avatar avatar--${color}`} aria-label={label}><i className="hair" /><i className="face" /><i className="eye eye--l" /><i className="eye eye--r" /><i className="mouth" /></div>;
}

async function readResponse(response: Response) {
  const data = await response.json() as { error?: string; token?: string; room?: RoomView };
  if (!response.ok) throw new Error(data.error || "刚刚没连上，再试一次");
  return data;
}

export default function Home() {
  const [board, setBoard] = useState<Stone[]>(freshBoard);
  const [turn, setTurn] = useState<1 | 2>(1);
  const [moves, setMoves] = useState<Move[]>([]);
  const [winner, setWinner] = useState<Stone>(0);
  const [line, setLine] = useState<number[]>([]);
  const [hint, setHint] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [rules, setRules] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [mode, setMode] = useState<"local" | "online">("local");
  const [roomId, setRoomId] = useState("");
  const [token, setToken] = useState("");
  const [side, setSide] = useState<1 | 2>(1);
  const [roomStatus, setRoomStatus] = useState<RoomView["status"]>("active");
  const [revision, setRevision] = useState(0);
  const [blackName, setBlackName] = useState("我");
  const [whiteName, setWhiteName] = useState<string | null>("阿远");
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("好友");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const seenResult = useRef(-1);

  const last = moves.at(-1)?.index ?? -1;
  const selfSide: 1 | 2 = mode === "online" ? side : 1;
  const opponentSide: 1 | 2 = selfSide === 1 ? 2 : 1;
  const selfName = selfSide === 1 ? blackName : (whiteName || "我");
  const opponentName = opponentSide === 1 ? blackName : (whiteName || "等待好友");
  const status = roomStatus === "waiting" ? "房间已开好，等朋友" : winner ? `${winner === 1 ? "黑棋" : "白棋"}连成五子！` : `轮到${turn === 1 ? "黑棋" : "白棋"}`;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1900);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const code = new URL(window.location.href).searchParams.get("room")?.toUpperCase();
    if (!code) return;
    const raw = window.localStorage.getItem(`pixel-gomoku:${code}`);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as { token: string };
        setMode("online"); setRoomId(code); setToken(saved.token);
        void refreshRoom(code, saved.token, true);
        return;
      } catch { window.localStorage.removeItem(`pixel-gomoku:${code}`); }
    }
    setJoinCode(code); setJoinOpen(true);
  }, []);

  useEffect(() => {
    if (mode !== "online" || !roomId || !token) return;
    const timer = window.setInterval(() => void refreshRoom(roomId, token, false), 1400);
    return () => window.clearInterval(timer);
  }, [mode, roomId, token]);

  function applyRoom(room: RoomView) {
    setMode("online"); setRoomId(room.id); setSide(room.side); setBoard(parseBoard(room.board));
    setMoves(room.moves); setTurn(room.turn); setWinner(room.winner); setLine(room.winningLine || []);
    setRoomStatus(room.status); setRevision(room.revision); setBlackName(room.blackName); setWhiteName(room.whiteName);
    setHint(null);
    if (room.winner && seenResult.current !== room.revision) {
      seenResult.current = room.revision; setResultOpen(true);
    }
  }

  async function refreshRoom(id: string, playerToken: string, showError: boolean) {
    try {
      const data = await readResponse(await fetch(`/api/rooms?id=${encodeURIComponent(id)}&token=${encodeURIComponent(playerToken)}`, { cache: "no-store" }));
      if (data.room) applyRoom(data.room);
    } catch (caught) { if (showError) setToast(caught instanceof Error ? caught.message : "房间连接失败"); }
  }

  async function createRoom() {
    setBusy(true);
    try {
      const data = await readResponse(await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", name: "我" }) }));
      if (!data.room || !data.token) throw new Error("房间创建失败");
      window.localStorage.setItem(`pixel-gomoku:${data.room.id}`, JSON.stringify({ token: data.token }));
      const url = new URL(window.location.href); url.searchParams.set("room", data.room.id); window.history.replaceState({}, "", url);
      setToken(data.token); applyRoom(data.room); setInviteOpen(true); setToast("房间开好啦");
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "房间创建失败"); }
    finally { setBusy(false); }
  }

  async function joinRoom() {
    if (!joinCode.trim()) return setToast("请输入房间码");
    setBusy(true);
    try {
      const data = await readResponse(await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "join", id: joinCode, name: joinName }) }));
      if (!data.room || !data.token) throw new Error("加入失败");
      window.localStorage.setItem(`pixel-gomoku:${data.room.id}`, JSON.stringify({ token: data.token }));
      const url = new URL(window.location.href); url.searchParams.set("room", data.room.id); window.history.replaceState({}, "", url);
      setToken(data.token); applyRoom(data.room); setJoinOpen(false); setToast("加入成功，轮到黑棋");
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "加入失败"); }
    finally { setBusy(false); }
  }

  async function onlineAction(action: "move" | "undo" | "resign" | "reset", index?: number) {
    if (busy) return;
    setBusy(true);
    try {
      const data = await readResponse(await fetch("/api/rooms", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id: roomId, token, index }) }));
      if (data.room) applyRoom(data.room);
    } catch (caught) { setToast(caught instanceof Error ? caught.message : "操作失败"); }
    finally { setBusy(false); }
  }

  function place(index: number) {
    if (winner || board[index]) return;
    if (mode === "online") {
      if (roomStatus === "waiting") return setToast("先把邀请发给朋友吧");
      if (turn !== side) return setToast("还没轮到你");
      void onlineAction("move", index); return;
    }
    const next = [...board]; next[index] = turn;
    const winning = findWinningLine(next, index, turn);
    setBoard(next); setMoves((old) => [...old, { index, stone: turn }]); setHint(null);
    if (winning.length) { setWinner(turn); setLine(winning); setResultOpen(true); }
    else setTurn(turn === 1 ? 2 : 1);
  }

  function undo() {
    if (mode === "online") return void onlineAction("undo");
    const move = moves.at(-1); if (!move) return setToast("还没有落子");
    const next = [...board]; next[move.index] = 0;
    setBoard(next); setMoves((old) => old.slice(0, -1)); setTurn(move.stone); setWinner(0); setLine([]); setResultOpen(false); setToast("撤回一步");
  }

  function getHint() {
    if (winner || (mode === "online" && turn !== side)) return setToast("等轮到你再看提示");
    const empty = board.flatMap((stone, index) => stone ? [] : [index]);
    const near = empty.filter((index) => !moves.length ? index === 112 : moves.some((move) => Math.abs(Math.floor(index / BOARD_SIZE) - Math.floor(move.index / BOARD_SIZE)) <= 1 && Math.abs(index % BOARD_SIZE - move.index % BOARD_SIZE) <= 1));
    const pool = near.length ? near : empty; if (!pool.length) return;
    setHint(pool[Math.floor(Math.random() * pool.length)]); setToast("小灯泡给你指了一步");
  }

  function reset() {
    setResultOpen(false);
    if (mode === "online") return void onlineAction("reset");
    setBoard(freshBoard()); setTurn(1); setMoves([]); setWinner(0); setLine([]); setHint(null); setToast("新的一局开始啦");
  }

  function resign() {
    if (!moves.length || winner) return setToast("棋局还没开始");
    if (mode === "online") return void onlineAction("resign");
    setWinner(turn === 1 ? 2 : 1); setResultOpen(true);
  }

  function invite() { if (mode === "online") setInviteOpen(true); else void createRoom(); }

  async function shareInvite() {
    const url = new URL(window.location.href); url.searchParams.set("room", roomId);
    try {
      if (navigator.share) await navigator.share({ title: "来下一盘像素五子棋", text: `房间码 ${roomId}，等你来下棋。`, url: url.toString() });
      else { await navigator.clipboard.writeText(url.toString()); setToast("邀请链接已复制"); }
    } catch { setToast("没有发出去，再试一次"); }
  }

  return (
    <main className="shell"><div className="scene" aria-hidden="true"><i className="cloud c1" /><i className="cloud c2" /><i className="leaf l1" /></div>
      <section className="app" aria-label="像素五子棋">
        <header className="header"><button className="back" aria-label="返回">‹</button><div><b>像素五子棋</b><small>PIXEL GOMOKU</small></div><span className="capsule">••• <i /></span></header>
        <div className="mode"><i /> {mode === "online" ? `联机房间 ${roomId}` : "同屏好友局"} <button onClick={invite}>{mode === "online" ? "分享" : "切换玩法"}</button></div>

        <section className={`player ${turn === opponentSide && !winner && roomStatus === "active" ? "active" : ""}`}>
          <Avatar color="orange" label="好友头像" /><div className="player-copy"><p><b>{opponentName}</b><em>{roomStatus === "waiting" ? "等待加入" : mode === "online" ? "在线" : "在你身边"}</em></p><small>{roomStatus === "waiting" ? "把房间链接发给朋友" : turn === opponentSide ? "正在想下一步…" : "等你落子"}</small></div>
          <div className="score"><i className={`disc ${opponentSide === 1 ? "black" : "white"}`} /><b>{winner === opponentSide ? 1 : 0}</b><small>胜</small></div>
        </section>

        <section className="board-zone"><div className="turn"><i className={`disc ${turn === 1 ? "black" : "white"}`} /><b>{status}</b><small>第 {moves.length + (winner ? 0 : 1)} 手</small></div><div className="board-frame"><div className="board" role="grid" aria-label="十五乘十五棋盘">
          {board.map((stone, index) => { const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE; const cls = ["cell", row === 0 && "top", row === 14 && "bottom", col === 0 && "left", col === 14 && "right", index === last && "last", line.includes(index) && "win", busy && "locked"].filter(Boolean).join(" "); return <button key={index} className={cls} role="gridcell" onClick={() => place(index)} aria-label={`${row + 1}行${col + 1}列${stone ? (stone === 1 ? "黑棋" : "白棋") : "空位"}`}>{STARS.has(index) && !stone && <i className="star" />}{stone > 0 && <i className={`stone ${stone === 1 ? "stone-black" : "stone-white"}`} />}{hint === index && !stone && <i className="hint" />}</button>; })}
        </div></div></section>

        <section className={`player self ${turn === selfSide && !winner && roomStatus === "active" ? "active" : ""}`}><Avatar color="green" label="我的头像" /><div className="player-copy"><p><b>{selfName}</b><em>{selfSide === 1 ? "先手" : "后手"}</em></p><small>{roomStatus === "waiting" ? "房间已经准备好了" : turn === selfSide ? "该你啦，稳住！" : "看好友怎么走"}</small></div><div className="score"><i className={`disc ${selfSide === 1 ? "black" : "white"}`} /><b>{winner === selfSide ? 1 : 0}</b><small>胜</small></div></section>

        <nav className="actions" aria-label="棋局操作"><button onClick={undo}><span>↶</span><b>悔一步</b></button><button onClick={getHint}><span>✦</span><b>提示</b></button><button onClick={() => setRules(true)}><span>?</span><b>规则</b></button><button onClick={resign}><span>⚑</span><b>认输</b></button></nav>
        <button className="invite" disabled={busy} onClick={invite}>{roomStatus === "waiting" && mode === "online" ? "↗ 把房间发给微信好友" : mode === "online" ? "↗ 分享这局棋" : "＋ 邀请微信好友对弈"}</button>
        <p className="motto">落子无声，友情有回声。</p>

        {toast && <div className="toast" role="status">{toast}</div>}
        {resultOpen && winner > 0 && <div className="scrim"><div className="modal result" role="dialog"><i className="trophy">♛</i><em>GOOD GAME!</em><h2>{winner === selfSide ? "你赢啦" : `${opponentName}赢啦`}</h2><p>五颗棋子排成一线，漂亮的一局。</p><button onClick={reset}>再来一局</button><a onClick={() => setResultOpen(false)}>回看棋盘</a></div></div>}
        {rules && <div className="scrim"><div className="modal rules" role="dialog"><a className="close" onClick={() => setRules(false)}>×</a><em>HOW TO PLAY</em><h2>五子棋规则</h2><ol><li><b>01</b>黑棋先手，双方轮流落子。</li><li><b>02</b>横、竖或斜线率先连成五子获胜。</li><li><b>03</b>这是轻松好友棋，不设置禁手。</li></ol><button onClick={() => setRules(false)}>知道啦</button></div></div>}
        {joinOpen && <div className="scrim"><div className="modal room-modal" role="dialog"><em>JOIN A ROOM</em><h2>好友在等你</h2><p>输入你的称呼，加入房间 <b>{joinCode}</b></p><label>你的昵称<input className="pixel-input" value={joinName} maxLength={12} onChange={(event) => setJoinName(event.target.value)} /></label><button disabled={busy} onClick={joinRoom}>{busy ? "正在加入…" : "加入棋局"}</button><a onClick={() => { setJoinOpen(false); window.history.replaceState({}, "", window.location.pathname); }}>先在本机试玩</a></div></div>}
        {inviteOpen && <div className="scrim"><div className="modal room-modal" role="dialog"><a className="close" onClick={() => setInviteOpen(false)}>×</a><em>ROOM IS READY</em><h2>房间开好啦</h2><p>把链接发给朋友，对方不用注册就能加入。</p><div className="room-code"><small>房间码</small><b>{roomId}</b></div><button onClick={shareInvite}>发给微信好友</button><a onClick={async () => { await navigator.clipboard.writeText(roomId); setToast("房间码已复制"); }}>只复制房间码</a></div></div>}
      </section>
    </main>
  );
}
