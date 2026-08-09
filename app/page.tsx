"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { BOARD_SIZE, CELL_COUNT, parseBoard, type Move, type Stone } from "../lib/gomoku";
import { buildGameInvitation } from "../lib/invitation";
import { describeGameOutcome, shouldApplyRoomResponse } from "../lib/web-game-state";
import { PixelIcon } from "./pixel-icon";

type Stats = { wins: number; losses: number; draws: number; total: number };
type SelfUser = {
  id: string;
  account: string | null;
  nickname: string;
  avatarId: number;
  online: boolean;
  stats: Stats;
};
type ActiveRoom = { id: string; side: 1 | 2; status: "waiting" | "active"; updatedAt: string };
type HistoryItem = {
  id: string;
  roomId: string;
  round: number;
  result: "win" | "loss" | "draw";
  opponent: { id: string; nickname: string; avatarId: number } | null;
  endedAt: string;
};
type RoomPlayer = { id: string | null; nickname: string; avatarId: number; online: boolean };
type RoomView = {
  id: string;
  side: 1 | 2;
  board: string;
  moves: Move[];
  turn: 1 | 2;
  status: "waiting" | "active" | "finished";
  winner: Stone;
  winningLine: number[];
  round: number;
  revision: number;
  undoRemaining: number;
  hasPassword: boolean;
  blackName: string;
  whiteName: string | null;
  blackPlayer: RoomPlayer;
  whitePlayer: RoomPlayer | null;
};
type ProfilePayload = {
  user: SelfUser;
  activeRoom: ActiveRoom | null;
  history: HistoryItem[];
  authMode: string;
};
type AuthPayload = {
  user: SelfUser;
  activeRoom: ActiveRoom | null;
  authMode: string;
};
type RoomPayload = { token?: string; room: RoomView };

const STARS = new Set([48, 56, 112, 168, 176]);
const AVATARS = [
  "01-face-short-hair.png",
  "02-face-bob.png",
  "03-face-curly.png",
  "04-face-glasses.png",
  "05-face-bangs.png",
  "06-face-spiky.png",
  "07-face-beard.png",
  "08-face-bun.png",
  "09-face-mustache.png",
];
const freshBoard = () => Array.from({ length: CELL_COUNT }, () => 0 as Stone);
const avatarUrl = (avatarId: number) => `/avatars/pixel-64/${AVATARS[Math.max(1, Math.min(9, avatarId)) - 1]}`;

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function readResponse<T>(response: Response) {
  const text = await response.text();
  let data: { error?: string } & Partial<T> = {};
  try { data = text ? JSON.parse(text) as typeof data : {}; } catch {}
  if (!response.ok) throw new ApiError(data.error || "刚刚没连上，请再试一次", response.status);
  return data as T;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  let copied = false;
  try {
    input.select();
    copied = document.execCommand("copy");
  } finally {
    input.remove();
  }
  if (!copied) throw new Error("浏览器未允许复制");
}

function PixelAvatar({ avatarId, name, size = "normal" }: { avatarId: number; name: string; size?: "small" | "normal" | "large" }) {
  return <img className={`pixel-avatar pixel-avatar--${size}`} src={avatarUrl(avatarId)} alt={`${name}的头像`} />;
}

export default function Home() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<SelfUser | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [account, setAccount] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [avatarId, setAvatarId] = useState(1);
  const [authError, setAuthError] = useState("");

  const [board, setBoard] = useState<Stone[]>(freshBoard);
  const [turn, setTurn] = useState<1 | 2>(1);
  const [moves, setMoves] = useState<Move[]>([]);
  const [winner, setWinner] = useState<Stone>(0);
  const [line, setLine] = useState<number[]>([]);
  const [undoRemaining, setUndoRemaining] = useState(3);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState(112);
  const [boardSize, setBoardSize] = useState(330);
  const [roomId, setRoomId] = useState("");
  const [side, setSide] = useState<1 | 2>(1);
  const [roomStatus, setRoomStatus] = useState<RoomView["status"]>("waiting");
  const [round, setRound] = useState(1);
  const [revision, setRevision] = useState(0);
  const [roomHasPassword, setRoomHasPassword] = useState(false);
  const [blackPlayer, setBlackPlayer] = useState<RoomPlayer | null>(null);
  const [whitePlayer, setWhitePlayer] = useState<RoomPlayer | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [resignOpen, setResignOpen] = useState(false);
  const seenResult = useRef(-1);
  const latestRoom = useRef({ id: "", revision: -1 });
  const roomGeneration = useRef(0);
  const roomPollController = useRef<AbortController | null>(null);
  const roomPollInFlight = useRef(false);
  const boardSlotRef = useRef<HTMLDivElement | null>(null);
  const boardPointerActive = useRef(false);

  const last = moves.at(-1)?.index ?? -1;
  const selfSide: 1 | 2 = side;
  const opponentSide: 1 | 2 = side === 1 ? 2 : 1;
  const fallbackSelf: RoomPlayer | null = user ? {
    id: user.id,
    nickname: user.nickname,
    avatarId: user.avatarId,
    online: true,
  } : null;
  const selfPlayer = (side === 1 ? blackPlayer : whitePlayer) || fallbackSelf;
  const opponentPlayer = side === 1 ? whitePlayer : blackPlayer;
  const opponentName = opponentPlayer?.nickname || "等待好友";
  const canUndo = roomStatus === "active"
    && undoRemaining > 0
    && moves.at(-1)?.stone === selfSide
    && turn !== selfSide;
  const outcome = describeGameOutcome(roomStatus, winner, selfSide, opponentName);
  const turnText = roomStatus === "finished"
    ? winner === 0 ? "本局和棋" : `${winner === 1 ? "黑棋" : "白棋"}连成五子`
    : roomStatus === "waiting"
    ? "房间已准备，等待好友加入"
    : `轮到${turn === 1 ? "黑棋" : "白棋"}`;

  useEffect(() => {
    const invitation = new URL(window.location.href).searchParams.get("room")?.trim().toUpperCase() || "";
    if (invitation) setJoinCode(invitation);
    void hydrateProfile();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    const heartbeat = async () => {
      try {
        const response = await fetch("/api/presence", { method: "POST", cache: "no-store" });
        if (response.status === 401) expireSession();
      } catch {}
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 20_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void heartbeat(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || !roomId) return;
    const generation = roomGeneration.current;
    const poll = async () => {
      if (roomPollInFlight.current) return;
      roomPollInFlight.current = true;
      const controller = new AbortController();
      roomPollController.current = controller;
      try {
        await refreshRoom(roomId, false, generation, controller.signal);
      } finally {
        if (roomPollController.current === controller) {
          roomPollController.current = null;
          roomPollInFlight.current = false;
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 1400);
    return () => {
      window.clearInterval(timer);
      roomPollController.current?.abort();
    };
  }, [user?.id, roomId]);

  useEffect(() => {
    const slot = boardSlotRef.current;
    if (!roomId || !slot) return;
    const updateBoardSize = () => {
      const available = Math.max(210, slot.clientWidth - 24);
      setBoardSize(Math.max(210, Math.min(630, Math.floor(available / 30) * 30)));
    };
    updateBoardSize();
    const observer = new ResizeObserver(updateBoardSize);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [roomId]);

  async function hydrateProfile() {
    try {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (response.status === 401) return;
      const data = await readResponse<ProfilePayload>(response);
      setUser(data.user);
      setHistory(data.history || []);
      setActiveRoom(data.activeRoom || null);
    } catch {
      setToast("暂时无法连接服务器");
    } finally {
      setInitializing(false);
    }
  }

  async function reloadProfile() {
    try {
      const data = await readResponse<ProfilePayload>(await fetch("/api/me", { cache: "no-store" }));
      setUser(data.user);
      setHistory(data.history || []);
      setActiveRoom(data.activeRoom || null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) expireSession();
    }
  }

  function invalidateRoomRequests() {
    roomGeneration.current += 1;
    roomPollController.current?.abort();
    roomPollController.current = null;
    roomPollInFlight.current = false;
  }

  function expireSession() {
    if (roomId) setJoinCode(roomId);
    invalidateRoomRequests();
    latestRoom.current = { id: "", revision: -1 };
    setUser(null);
    setHistory([]);
    setActiveRoom(null);
    setRoomId("");
    setToast("登录已过期，请重新登录");
  }

  function showFailure(caught: unknown, fallback: string) {
    if (caught instanceof ApiError && caught.status === 401) {
      expireSession();
      return;
    }
    setToast(caught instanceof Error ? caught.message : fallback);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setAuthError("");
    try {
      const data = await readResponse<AuthPayload>(await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: authTab,
          account,
          password,
          nickname: authTab === "register" ? nickname : undefined,
          avatarId: authTab === "register" ? avatarId : undefined,
        }),
      }));
      setUser(data.user);
      setActiveRoom(data.activeRoom || null);
      setPassword("");
      await reloadProfile();
      setToast(authTab === "register" ? "注册成功，欢迎来下棋" : "欢迎回来");
    } catch (caught) {
      setAuthError(caught instanceof Error ? caught.message : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await readResponse<{ ok: boolean }>(await fetch("/api/auth/session", { method: "DELETE" }));
      invalidateRoomRequests();
      latestRoom.current = { id: "", revision: -1 };
      setUser(null);
      setHistory([]);
      setActiveRoom(null);
      setRoomId("");
      setPassword("");
      setToast("已安全退出");
    } catch (caught) {
      setToast(caught instanceof Error ? `退出失败：${caught.message}` : "退出失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  function applyRoom(room: RoomView, expectedGeneration = roomGeneration.current) {
    const current = latestRoom.current;
    if (!shouldApplyRoomResponse({
      expectedGeneration,
      currentGeneration: roomGeneration.current,
      currentRoomId: current.id,
      responseRoomId: room.id,
      currentRevision: current.revision,
      responseRevision: room.revision,
    })) return false;
    if (!current.id) {
      roomGeneration.current += 1;
      seenResult.current = -1;
    }
    latestRoom.current = { id: room.id, revision: room.revision };
    setRoomId(room.id);
    setSide(room.side);
    setBoard(parseBoard(room.board));
    setMoves(room.moves);
    setTurn(room.turn);
    setWinner(room.winner);
    setLine(room.winningLine || []);
    setUndoRemaining(room.undoRemaining);
    setRoomStatus(room.status);
    setRound(room.round);
    setRevision(room.revision);
    setRoomHasPassword(room.hasPassword);
    setBlackPlayer(room.blackPlayer);
    setWhitePlayer(room.whitePlayer);
    setPreviewIndex(null);
    if (room.status === "finished" && seenResult.current !== room.revision) {
      seenResult.current = room.revision;
      setResignOpen(false);
      setResultOpen(true);
    } else if (room.status !== "finished") {
      setResultOpen(false);
    }
    return true;
  }

  function setRoomUrl(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("room", id);
    else url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
  }

  async function refreshRoom(
    id: string,
    showError = true,
    expectedGeneration = roomGeneration.current,
    signal?: AbortSignal,
  ) {
    try {
      const data = await readResponse<RoomPayload>(await fetch(`/api/rooms?id=${encodeURIComponent(id)}`, {
        cache: "no-store",
        signal,
      }));
      return applyRoom(data.room, expectedGeneration);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return false;
      if (caught instanceof ApiError && caught.status === 401) showFailure(caught, "房间连接失败");
      else if (showError) showFailure(caught, "房间连接失败");
      return false;
    }
  }

  async function createRoom() {
    if (busy) return;
    const protectedPassword = createPassword.trim();
    setBusy(true);
    try {
      const data = await readResponse<RoomPayload>(await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", password: protectedPassword }),
      }));
      applyRoom(data.room);
      setRoomUrl(data.room.id);
      setInvitePassword(protectedPassword);
      setInviteOpen(true);
      setToast("房间创建成功");
    } catch (caught) {
      showFailure(caught, "房间创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) return setToast("请输入 6 位房间号");
    setBusy(true);
    try {
      const enteredPassword = joinPassword.trim();
      const data = await readResponse<RoomPayload>(await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "join", id: code, password: enteredPassword }),
      }));
      applyRoom(data.room);
      setRoomUrl(data.room.id);
      setInvitePassword(enteredPassword);
      setJoinPassword("");
      setToast("已加入对局");
    } catch (caught) {
      showFailure(caught, "加入房间失败");
    } finally {
      setBusy(false);
    }
  }

  async function resumeRoom() {
    if (!activeRoom || busy) return;
    setBusy(true);
    try {
      const loaded = await refreshRoom(activeRoom.id);
      if (loaded) {
        setRoomUrl(activeRoom.id);
        setInvitePassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onlineAction(action: "move" | "undo" | "resign" | "reset", index?: number) {
    if (busy || !roomId) return;
    const expectedGeneration = roomGeneration.current;
    const actionRoomId = roomId;
    setBusy(true);
    try {
      const data = await readResponse<RoomPayload>(await fetch("/api/rooms", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: actionRoomId, index }),
      }));
      applyRoom(data.room, expectedGeneration);
    } catch (caught) {
      showFailure(caught, "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function place(index: number) {
    if (busy || board[index]) return;
    if (roomStatus === "waiting") return setToast("先邀请好友加入房间");
    if (roomStatus === "finished") return;
    if (turn !== side) return setToast("还没轮到你");
    void onlineAction("move", index);
  }

  function boardIndexFromPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cellWidth = rect.width / BOARD_SIZE;
    const cellHeight = rect.height / BOARD_SIZE;
    const col = Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor((event.clientX - rect.left) / cellWidth)));
    const row = Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor((event.clientY - rect.top) / cellHeight)));
    return row * BOARD_SIZE + col;
  }

  function handleBoardPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    boardPointerActive.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewIndex(boardIndexFromPointer(event));
  }

  function handleBoardPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!boardPointerActive.current) return;
    setPreviewIndex(boardIndexFromPointer(event));
  }

  function handleBoardPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!boardPointerActive.current) return;
    const index = boardIndexFromPointer(event);
    boardPointerActive.current = false;
    setPreviewIndex(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    place(index);
  }

  function cancelBoardPointer() {
    boardPointerActive.current = false;
    setPreviewIndex(null);
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const row = Math.floor(keyboardIndex / BOARD_SIZE);
    const col = keyboardIndex % BOARD_SIZE;
    const next = event.key === "ArrowUp"
      ? Math.max(0, row - 1) * BOARD_SIZE + col
      : event.key === "ArrowDown"
        ? Math.min(BOARD_SIZE - 1, row + 1) * BOARD_SIZE + col
        : event.key === "ArrowLeft"
          ? row * BOARD_SIZE + Math.max(0, col - 1)
          : event.key === "ArrowRight"
            ? row * BOARD_SIZE + Math.min(BOARD_SIZE - 1, col + 1)
            : keyboardIndex;
    if (next !== keyboardIndex) {
      event.preventDefault();
      setKeyboardIndex(next);
      setPreviewIndex(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      place(keyboardIndex);
    }
  }

  async function exitGame() {
    invalidateRoomRequests();
    latestRoom.current = { id: "", revision: -1 };
    seenResult.current = -1;
    setRoomId("");
    setJoinCode("");
    setRoomUrl("");
    setBoard(freshBoard());
    setMoves([]);
    setWinner(0);
    setLine([]);
    setUndoRemaining(3);
    setPreviewIndex(null);
    setResultOpen(false);
    setInviteOpen(false);
    await reloadProfile();
  }

  function currentInvitation() {
    return buildGameInvitation({
      baseUrl: window.location.origin + window.location.pathname,
      roomId,
      roomPassword: roomHasPassword ? invitePassword.trim() : null,
      inviterNickname: user?.nickname || "好友",
    });
  }

  function validateInvitePassword() {
    if (roomHasPassword && !invitePassword.trim()) {
      setToast("请先填写房间密码，再生成完整邀请");
      return false;
    }
    return true;
  }

  async function copyInvitation() {
    if (!validateInvitePassword()) return;
    try {
      await copyText(currentInvitation().text);
      setToast("完整邀请已复制，可粘贴到微信");
    } catch {
      setToast("复制失败，请长按房间信息复制");
    }
  }

  async function systemShare() {
    if (!validateInvitePassword()) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "像素五子棋对战邀请", text: currentInvitation().text });
        return;
      }
      await copyInvitation();
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      setToast("系统分享不可用，已保留复制方式");
    }
  }

  if (initializing) {
    return <main className="loading-screen"><div className="brand-mark"><i /><i /><i /><i /><i /></div><b>像素五子棋</b><small>正在连接棋局服务器…</small></main>;
  }

  if (!user) {
    return (
      <main className="site-shell auth-shell">
        <div className="ambient-grid" aria-hidden="true" />
        <section className="auth-hero">
          <span className="eyebrow">PIXEL GOMOKU · WEB</span>
          <h1>五子连成线，<br />落子别眨眼。</h1>
          {joinCode && <div className="invitation-badge"><i /> 收到房间邀请 <b>{joinCode}</b></div>}
          <div className="hero-board" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
          <ul className="feature-list"><li>长期登录与在线状态</li><li>私密房间与续局</li><li>战绩持久保存</li></ul>
        </section>

        <section className="auth-card" aria-label="账号入口">
          <header><div className="mini-logo"><span>五</span></div><div><b>像素五子棋</b><small>独立在线对战</small></div></header>
          <div className="auth-tabs" role="tablist">
            <button className={authTab === "login" ? "active" : ""} onClick={() => { setAuthTab("login"); setAuthError(""); }}>登录</button>
            <button className={authTab === "register" ? "active" : ""} onClick={() => { setAuthTab("register"); setAuthError(""); }}>注册新账号</button>
          </div>
          <form onSubmit={submitAuth}>
            {authTab === "register" && <>
              <label>对外昵称<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={16} placeholder="朋友会看到这个名字" autoComplete="nickname" required /></label>
              <fieldset><legend>选择头像</legend><div className="avatar-picker">{AVATARS.map((file, index) => <button type="button" className={avatarId === index + 1 ? "selected" : ""} key={file} onClick={() => setAvatarId(index + 1)} aria-label={`选择头像 ${index + 1}`}><img src={`/avatars/pixel-64/${file}`} alt="" /></button>)}</div></fieldset>
            </>}
            <label>登录账号<input value={account} onChange={(event) => setAccount(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" placeholder="字母、数字或下划线" autoCapitalize="none" autoComplete="username" required /></label>
            <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={64} placeholder="至少 8 个字符" autoComplete={authTab === "login" ? "current-password" : "new-password"} required /></label>
            {authError && <p className="form-error" role="alert">{authError}</p>}
            <button className="primary-button" disabled={busy} type="submit">{busy ? "处理中…" : authTab === "login" ? "登录并进入大厅" : "完成注册并进入大厅"}</button>
          </form>
          <p className="privacy-note">账号数据仅保存在本游戏服务器；密码经过加盐哈希，不保存明文。</p>
        </section>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  if (!roomId) {
    return (
      <main className="site-shell lobby-shell">
        <div className="ambient-grid" aria-hidden="true" />
        <header className="site-header">
          <a className="wordmark"><span>五</span><div><b>像素五子棋</b><small>PIXEL GOMOKU</small></div></a>
          <div className="header-account"><i className="online-dot" /><span>{user.nickname}</span><button disabled={busy} onClick={logout}>退出</button></div>
        </header>

        <section className="lobby-grid">
          <aside className="profile-card panel">
            <span className="eyebrow">PLAYER PROFILE</span>
            <div className="profile-main"><PixelAvatar avatarId={user.avatarId} name={user.nickname} size="large" /><div><h2>{user.nickname}</h2><p>@{user.account || "开发账号"}</p><em><i /> 在线</em></div></div>
            <div className="stats-grid"><div><b>{user.stats.wins}</b><small>胜</small></div><div><b>{user.stats.losses}</b><small>负</small></div><div><b>{user.stats.draws}</b><small>和</small></div><div><b>{user.stats.total}</b><small>总局</small></div></div>
            {activeRoom && <button className="resume-card" disabled={busy} onClick={resumeRoom}><span>未完成棋局</span><b>房间 {activeRoom.id}</b><small>{activeRoom.status === "waiting" ? "等待好友加入" : "继续对战"} →</small></button>}
          </aside>

          <section className="room-panel panel">
            <span className="eyebrow">ONLINE MATCH</span>
            <h1>{joinCode ? "好友正在等你" : "开始一盘新棋"}</h1>
            <p className="section-lead">输入房间信息加入，或者创建自己的私密房间。</p>
            {joinCode && <div className="received-invite"><span>邀请房间</span><b>{joinCode}</b><small>确认密码后即可加入</small></div>}
            <div className="room-actions-grid">
              <form className="room-form join-form" onSubmit={joinRoom}>
                <div className="form-heading"><i><PixelIcon name="join" /></i><div><b>加入房间</b><small>JOIN A ROOM</small></div></div>
                <label>房间号<input className="code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, "").slice(0, 6))} maxLength={6} placeholder="例如 ABC234" autoCapitalize="characters" required /></label>
                <label>房间密码<input type="password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} maxLength={16} placeholder="无密码可留空" autoComplete="off" /></label>
                <button className="primary-button" disabled={busy} type="submit">{busy ? "正在连接…" : "进入对战"}</button>
              </form>

              <div className="room-form create-form">
                <div className="form-heading"><i><PixelIcon name="plus" /></i><div><b>创建房间</b><small>CREATE A ROOM</small></div></div>
                <label>设置房间密码（选填）<input type="password" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} minLength={createPassword ? 4 : undefined} maxLength={16} placeholder="4–16 位；留空即公开" autoComplete="new-password" /></label>
                <p>创建后会生成网址、房间号与完整邀请文案。密码不会写入网址。</p>
                <button className="secondary-button" disabled={busy} onClick={createRoom}>{busy ? "正在创建…" : "创建我的房间"}</button>
              </div>
            </div>
          </section>

          <section className="history-card panel">
            <div className="panel-title"><div><span className="eyebrow">MATCH HISTORY</span><h2>最近对局</h2></div><small>{history.length ? `保存 ${history.length} 条记录` : "完成对局后自动保存"}</small></div>
            {history.length ? <div className="history-list">{history.slice(0, 6).map((item) => <article key={item.id}><span className={`result-chip result-${item.result}`}>{item.result === "win" ? "胜" : item.result === "loss" ? "负" : "和"}</span><div><b>{item.opponent?.nickname || "游客棋手"}</b><small>房间 {item.roomId} · 第 {item.round} 局</small></div><time>{item.endedAt.slice(0, 10)}</time></article>)}</div> : <div className="empty-history"><i>···</i><p>还没有历史对局，邀请朋友来第一盘。</p></div>}
          </section>
        </section>
        <footer className="site-footer">落子无声，友情有回声。 · 数据由个人服务器持久保存</footer>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="game-shell">
      <header className="game-header"><button className="back-button" onClick={() => void exitGame()}><PixelIcon name="back" />大厅</button><div><b>房间 {roomId}</b><small>第 {round} 局 · {roomHasPassword ? "私密房间" : "公开房间"}</small></div><span className="game-side-chip">你执{selfSide === 1 ? "黑棋" : "白棋"}</span></header>
      <section className="game-layout">
        <aside className="player-stack">
          <article className={`game-player ${turn === opponentSide && !winner && roomStatus === "active" ? "active" : ""}`}>
            {opponentPlayer ? <PixelAvatar avatarId={opponentPlayer.avatarId} name={opponentPlayer.nickname} size="large" /> : <div className="empty-avatar">?</div>}
            <div><span>{opponentSide === 1 ? "黑棋 · 先手" : "白棋 · 后手"}</span><h2>{opponentName}</h2><p><i className={opponentPlayer?.online ? "online-dot" : "offline-dot"} /> {opponentPlayer ? opponentPlayer.online ? "在线" : "暂时离线" : "尚未加入"}</p></div>
          </article>
          <div className="versus"><span>VS</span><i /></div>
          <article className={`game-player self-player ${turn === selfSide && !winner && roomStatus === "active" ? "active" : ""}`}>
            {selfPlayer && <PixelAvatar avatarId={selfPlayer.avatarId} name={selfPlayer.nickname} size="large" />}
            <div><span>{selfSide === 1 ? "黑棋 · 先手" : "白棋 · 后手"}</span><h2>{selfPlayer?.nickname || user.nickname}</h2><p><i className="online-dot" /> 你在线</p></div>
          </article>
          <div className="room-summary"><small>当前状态</small><b>{turnText}</b><p>已落 {moves.length} 手 · 同步版本 {revision}</p></div>
        </aside>

        <section className="board-card">
          <div className="turn-banner"><i className={`disc ${turn === 1 ? "black" : "white"}`} /><b>{turnText}</b><small>{roomStatus === "waiting" ? "分享邀请开始对局" : roomStatus === "finished" ? `共 ${moves.length} 手` : `第 ${moves.length + 1} 手`}</small></div>
          <div className="board-slot" ref={boardSlotRef}>
            <div className="board-frame">
              <div
                aria-activedescendant={`intersection-${keyboardIndex}`}
                aria-label="十五乘十五五子棋棋盘。拖动选择交点，松开落子；键盘方向键移动，回车落子。"
                className={`board ${busy ? "locked" : ""}`}
                onBlur={() => setPreviewIndex(null)}
                onFocus={() => setPreviewIndex(keyboardIndex)}
                onKeyDown={handleBoardKeyDown}
                onPointerCancel={cancelBoardPointer}
                onPointerDown={handleBoardPointerDown}
                onPointerMove={handleBoardPointerMove}
                onPointerUp={handleBoardPointerUp}
                role="grid"
                style={{ height: boardSize, width: boardSize }}
                tabIndex={0}
              >
                {board.map((stone, index) => {
                  const row = Math.floor(index / BOARD_SIZE), col = index % BOARD_SIZE;
                  const cls = ["cell", row === 0 && "top", row === 14 && "bottom", col === 0 && "left", col === 14 && "right", index === last && "last", line.includes(index) && "win"].filter(Boolean).join(" ");
                  return <span aria-label={`${row + 1}行${col + 1}列${stone ? stone === 1 ? "黑棋" : "白棋" : "空位"}`} aria-selected={previewIndex === index} className={cls} id={`intersection-${index}`} key={index} role="gridcell">{STARS.has(index) && !stone && <i className="star" />}{stone > 0 && <i className={`stone ${stone === 1 ? "stone-black" : "stone-white"}`} />}{previewIndex === index && !stone && <i className="pixel-cursor" />}</span>;
                })}
              </div>
            </div>
          </div>
          <nav className={`game-actions ${roomStatus === "finished" ? "game-actions--finished" : ""}`} aria-label="棋局操作">
            {roomStatus === "finished" ? (
              <button disabled={busy} onClick={() => void onlineAction("reset")}><PixelIcon name="replay" /><span><b>再来一局</b><small>双方悔棋次数重置</small></span></button>
            ) : <>
              <button disabled={busy || !canUndo} onClick={() => void onlineAction("undo")}><PixelIcon name="undo" /><span><b>悔棋</b><small>本局剩余 {undoRemaining} 次</small></span></button>
              <button className="resign-action" disabled={busy || roomStatus !== "active"} onClick={() => setResignOpen(true)}><PixelIcon name="resign" /><span><b>认输</b><small>立即结束本局</small></span></button>
            </>}
          </nav>
          {roomStatus === "waiting" && <button className="primary-button waiting-share" onClick={() => setInviteOpen(true)}><PixelIcon name="invite" />复制邀请，让好友加入</button>}
        </section>
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
      {inviteOpen && <div className="scrim"><section className="modal invite-modal" role="dialog" aria-modal="true"><button className="modal-close" aria-label="关闭邀请" onClick={() => setInviteOpen(false)}><PixelIcon name="close" /></button><span className="eyebrow">ROOM INVITATION</span><h2>邀请好友来对战</h2><p>微信或浏览器均可打开。对方需要先登录或注册，再输入房间信息。</p><div className="invite-details"><label>网址<code>{currentInvitation().url}</code></label><label>房间号<strong>{roomId}</strong></label>{roomHasPassword ? <label>房间密码<input type="text" value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} maxLength={16} placeholder="重新填写房间密码" /></label> : <label>房间密码<strong>无密码</strong></label>}</div><label className="manual-invitation">完整邀请（复制不可用时可长按全选）<textarea readOnly value={currentInvitation().text} onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-button" onClick={copyInvitation}><PixelIcon name="copy" />复制完整邀请</button><button className="text-button share-text-button" onClick={systemShare}><PixelIcon name="invite" />调用系统分享</button><small>安全提示：密码只进入复制内容，不写入网址。</small></section></div>}
      {resignOpen && <div className="scrim"><section className="modal resign-modal" role="alertdialog" aria-modal="true"><span className="result-crown"><PixelIcon name="resign" size={32} /></span><span className="eyebrow">CONFIRM RESIGN</span><h2>确认认输？</h2><p>认输会立即结束本局，并在战绩中记录一次负场。</p><button className="danger-button" disabled={busy} onClick={() => { setResignOpen(false); void onlineAction("resign"); }}><PixelIcon name="resign" />确认认输</button><button className="text-button" disabled={busy} onClick={() => setResignOpen(false)}>继续下棋</button></section></div>}
      {resultOpen && outcome && <div className="scrim"><section className="modal result-modal" role="dialog" aria-modal="true"><span className="result-crown"><PixelIcon name={outcome.isDraw ? "draw" : "crown"} size={32} /></span><span className="eyebrow">GOOD GAME</span><h2>{outcome.title}</h2><p>{outcome.detail}</p><button className="primary-button" disabled={busy} onClick={() => { setResultOpen(false); void onlineAction("reset"); }}><PixelIcon name="replay" />再来一局</button><button className="text-button" onClick={() => setResultOpen(false)}>回看棋盘</button></section></div>}
    </main>
  );
}
