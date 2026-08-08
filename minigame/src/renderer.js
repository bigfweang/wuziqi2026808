const {
  avatarFile,
  parseBoard,
  roomStatusText,
  winningLine,
} = require("./core");

const COLORS = {
  ink: "#24312b",
  green: "#386e55",
  dark: "#214b3a",
  paper: "#f8f5e9",
  muted: "#738078",
  soft: "#e4ead8",
  wood: "#e6b570",
  woodDark: "#805a36",
  orange: "#e78d4d",
  white: "#fffdf4",
  red: "#d95e49",
};

class Renderer {
  constructor(platform, invalidate) {
    this.platform = platform;
    this.invalidate = invalidate;
    this.canvas = platform.createCanvas();
    this.ctx = this.canvas.getContext("2d");
    this.images = new Map();
    this.layout = { hits: [], board: null };
    this.resize();
  }

  resize() {
    const info = this.platform.systemInfo();
    this.width = info.width;
    this.height = info.height;
    this.dpr = info.pixelRatio;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    if (this.canvas.style) {
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  hit(id, x, y, width, height) {
    this.layout.hits.push({ id, x, y, width, height });
  }

  hitAt(x, y) {
    for (let index = this.layout.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.layout.hits[index];
      if (x >= hit.x && x <= hit.x + hit.width && y >= hit.y && y <= hit.y + hit.height) return hit.id;
    }
    return "";
  }

  fillPixelCard(x, y, width, height, fill = COLORS.white, border = "#c8cfbd", shadow = 3) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(36,49,43,.17)";
    ctx.fillRect(x + shadow, y + shadow, width, height);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  }

  text(value, x, y, size, color = COLORS.ink, align = "left", weight = 500) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.font = `${weight} ${size}px "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.fillText(String(value), x, y);
  }

  button(id, label, x, y, width, height, primary = false, disabled = false) {
    const fill = disabled ? "#b9c0b3" : primary ? COLORS.green : COLORS.white;
    const border = primary ? COLORS.dark : "#bfc7b6";
    this.fillPixelCard(x, y, width, height, fill, border, primary ? 4 : 2);
    this.text(label, x + width / 2, y + height / 2, 13, primary ? COLORS.white : COLORS.ink, "center", 700);
    if (!disabled) this.hit(id, x, y, width, height);
  }

  avatar(avatarId, x, y, size) {
    const name = avatarFile(avatarId);
    const base = this.platform.isPreview ? "/avatars" : "images/avatars";
    const source = `${base}/${name}`;
    let image = this.images.get(source);
    if (!image) {
      image = this.platform.createImage(this.canvas, source);
      this.images.set(source, image || false);
      if (image) {
        image.onload = () => this.invalidate();
        image.onerror = () => this.images.set(source, false);
      }
    }
    this.ctx.fillStyle = "#d9e7cb";
    this.ctx.fillRect(x, y, size, size);
    if (image && image.complete !== false) {
      try { this.ctx.drawImage(image, x, y, size, size); } catch {}
    }
    this.ctx.strokeStyle = COLORS.ink;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  }

  background() {
    const ctx = this.ctx;
    ctx.fillStyle = "#dfe8cd";
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.strokeStyle = "rgba(56,110,85,.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= this.width; x += 16) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, this.height); ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += 16) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(this.width, y + 0.5); ctx.stroke();
    }
    const appX = Math.max(0, (this.width - 440) / 2);
    const appWidth = Math.min(this.width, 440);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(appX, 0, appWidth, this.height);
    ctx.fillStyle = "rgba(56,110,85,.08)";
    for (let y = 22; y < this.height; y += 29) {
      for (let x = appX + 18; x < appX + appWidth; x += 29) ctx.fillRect(x, y, 2, 2);
    }
  }

  header(title, subtitle, showBack, share) {
    const x = Math.max(16, (this.width - 408) / 2);
    if (showBack) {
      this.text("‹", x + 10, 32, 32, COLORS.ink, "center", 400);
      this.hit("back", x - 4, 8, 44, 48);
    }
    this.text(title, this.width / 2, 25, 17, COLORS.ink, "center", 800);
    this.text(subtitle, this.width / 2, 44, 8, COLORS.muted, "center", 700);
    if (share) {
      this.fillPixelCard(this.width - x - 45, 13, 45, 31, "rgba(255,255,255,.8)", "#bfc6ba", 1);
      this.text("分享", this.width - x - 22, 29, 10, COLORS.green, "center", 800);
      this.hit("share", this.width - x - 50, 7, 54, 43);
    }
  }

  render(state) {
    this.layout = { hits: [], board: null };
    this.background();
    if (state.screen === "loading") this.renderLoading(state);
    else if (state.screen === "game") this.renderGame(state);
    else this.renderHome(state);
    if (state.busy) this.renderBusy();
    if (state.toast) this.renderToast(state.toast);
    return this.layout;
  }

  renderLoading(state) {
    this.header("像素五子棋", "PIXEL GOMOKU · DEV", false, false);
    const cx = this.width / 2;
    const cy = this.height * 0.43;
    this.ctx.fillStyle = COLORS.green;
    for (let i = 0; i < 5; i += 1) this.ctx.fillRect(cx - 42 + i * 20, cy, 11, 11);
    this.text(state.loadingText || "正在准备开发身份…", cx, cy + 38, 12, COLORS.muted, "center", 600);
  }

  renderHome(state) {
    this.header("像素五子棋", "PIXEL GOMOKU · 开发版", false, false);
    const margin = Math.max(18, (this.width - 404) / 2);
    const width = this.width - margin * 2;
    const user = state.user || { nickname: "开发棋手", avatarId: 1, stats: {} };
    const stats = user.stats || {};

    this.fillPixelCard(margin, 68, width, 84, COLORS.white, "#c9d1c1", 4);
    this.avatar(user.avatarId, margin + 12, 80, 58);
    this.text(user.nickname, margin + 84, 91, 17, COLORS.ink, "left", 800);
    this.ctx.fillStyle = "#4fa76f";
    this.ctx.fillRect(margin + 84, 113, 8, 8);
    this.text("在线 · 开发身份", margin + 99, 117, 10, COLORS.green, "left", 700);
    this.text("头像已随机分配并会保持", margin + 84, 137, 9, COLORS.muted, "left", 500);

    const statY = 166;
    const gap = 7;
    const statWidth = (width - gap * 3) / 4;
    [["胜", stats.wins || 0], ["负", stats.losses || 0], ["和", stats.draws || 0], ["总局", stats.total || 0]].forEach(([label, value], index) => {
      const x = margin + index * (statWidth + gap);
      this.fillPixelCard(x, statY, statWidth, 58, "#f2f5e9", "#d2d8ca", 2);
      this.text(value, x + statWidth / 2, statY + 22, 19, index === 0 ? COLORS.green : COLORS.ink, "center", 800);
      this.text(label, x + statWidth / 2, statY + 43, 9, COLORS.muted, "center", 600);
    });

    let buttonY = 244;
    if (state.activeRoom) {
      this.button("resume", `继续房间 ${state.activeRoom.id}`, margin, buttonY, width, 48, true);
      buttonY += 60;
    }
    this.button("create", "＋ 创建棋局并邀请好友", margin, buttonY, width, 48, true);
    buttonY += 60;
    this.button("join", "输入房间码加入", margin, buttonY, width, 44, false);

    const historyY = buttonY + 68;
    this.text("最近对局", margin, historyY, 13, COLORS.ink, "left", 800);
    this.text("日期与输赢会保存在账号中", margin + width, historyY, 9, COLORS.muted, "right", 500);
    const history = Array.isArray(state.history) ? state.history.slice(0, 3) : [];
    if (!history.length) {
      this.fillPixelCard(margin, historyY + 18, width, 52, "#f4f4e9", "#d8dbd1", 1);
      this.text("还没有战绩，先邀请一位好友吧", this.width / 2, historyY + 44, 10, COLORS.muted, "center", 500);
    } else {
      history.forEach((item, index) => {
        const y = historyY + 18 + index * 45;
        this.fillPixelCard(margin, y, width, 38, COLORS.white, "#d8dbd1", 1);
        const resultText = item.result === "win" ? "胜" : item.result === "loss" ? "负" : "和";
        const resultColor = item.result === "win" ? COLORS.green : item.result === "loss" ? COLORS.red : COLORS.orange;
        this.text(resultText, margin + 19, y + 19, 13, resultColor, "center", 900);
        this.text(item.opponent ? `对阵 ${item.opponent.nickname}` : `房间 ${item.roomId}`, margin + 38, y + 13, 10, COLORS.ink, "left", 700);
        this.text(String(item.endedAt || "").slice(0, 10), margin + 38, y + 27, 8, COLORS.muted, "left", 500);
      });
    }

    this.text("账号接入后：开发身份将替换为微信登录", this.width / 2, this.height - 22, 8, COLORS.muted, "center", 600);
  }

  playerCard(player, side, x, y, width, isTurn) {
    this.fillPixelCard(x, y, width, 62, isTurn ? "#edf3e6" : COLORS.white, isTurn ? "#7fa185" : "#d1d5ca", isTurn ? 4 : 2);
    const safePlayer = player || { nickname: "等待好友", avatarId: 2, online: false };
    this.avatar(safePlayer.avatarId, x + 8, y + 8, 46);
    this.text(safePlayer.nickname, x + 66, y + 20, 13, COLORS.ink, "left", 800);
    this.ctx.fillStyle = safePlayer.online ? "#4fa76f" : "#a6aaa3";
    this.ctx.fillRect(x + 66, y + 39, 7, 7);
    this.text(safePlayer.online ? "在线" : "离线", x + 79, y + 43, 9, safePlayer.online ? COLORS.green : COLORS.muted, "left", 600);
    this.ctx.fillStyle = side === 1 ? "#27302c" : "#fff9e8";
    this.ctx.beginPath(); this.ctx.arc(x + width - 29, y + 23, 9, 0, Math.PI * 2); this.ctx.fill();
    this.ctx.strokeStyle = "#766c5c"; this.ctx.stroke();
    this.text(side === 1 ? "黑方" : "白方", x + width - 29, y + 46, 8, COLORS.muted, "center", 700);
  }

  renderBoard(room, boardLayout) {
    const ctx = this.ctx;
    const { x, y, size, padding } = boardLayout;
    ctx.fillStyle = "#5c412b";
    ctx.fillRect(x + 5, y + 5, size, size);
    ctx.fillStyle = "#8d6038";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.wood;
    ctx.fillRect(x + 7, y + 7, size - 14, size - 14);
    ctx.strokeStyle = "#f0c889";
    ctx.strokeRect(x + 8.5, y + 8.5, size - 17, size - 17);

    const originX = x + padding;
    const originY = y + padding;
    const span = size - padding * 2;
    const cell = span / 14;
    ctx.strokeStyle = COLORS.woodDark;
    ctx.lineWidth = 1;
    for (let index = 0; index < 15; index += 1) {
      const offset = index * cell;
      ctx.beginPath(); ctx.moveTo(originX + offset, originY); ctx.lineTo(originX + offset, originY + span); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(originX, originY + offset); ctx.lineTo(originX + span, originY + offset); ctx.stroke();
    }
    ctx.fillStyle = COLORS.woodDark;
    [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]].forEach(([row, col]) => {
      ctx.fillRect(originX + col * cell - 2, originY + row * cell - 2, 4, 4);
    });

    const board = parseBoard(room.board);
    const wins = winningLine(room);
    const last = Array.isArray(room.moves) && room.moves.length ? room.moves[room.moves.length - 1].index : -1;
    board.forEach((stone, index) => {
      if (!stone) return;
      const row = Math.floor(index / 15), col = index % 15;
      const cx = originX + col * cell, cy = originY + row * cell;
      const radius = Math.max(5, cell * 0.42);
      ctx.fillStyle = stone === 1 ? "#26302b" : "#fff9e8";
      ctx.beginPath(); ctx.arc(cx + 1, cy + 2, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = stone === 1 ? "#111714" : "#9b8b72";
      ctx.stroke();
      if (index === last || wins.has(index)) {
        ctx.fillStyle = wins.has(index) ? COLORS.green : COLORS.red;
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
      }
    });
  }

  renderGame(state) {
    const room = state.room;
    this.header("像素五子棋", room ? `房间 ${room.id}` : "正在进入房间", true, Boolean(room));
    if (!room) return;
    const margin = Math.max(14, (this.width - 412) / 2);
    const width = this.width - margin * 2;
    const selfSide = room.side;
    const opponentSide = selfSide === 1 ? 2 : 1;
    const self = selfSide === 1 ? room.blackPlayer : room.whitePlayer;
    const opponent = opponentSide === 1 ? room.blackPlayer : room.whitePlayer;

    this.playerCard(opponent, opponentSide, margin, 64, width, room.status === "active" && room.turn === opponentSide);
    this.fillPixelCard(margin + 25, 136, width - 50, 31, "#fffdf4", "#b89a6c", 2);
    this.text(roomStatusText(room), this.width / 2, 151, 11, COLORS.ink, "center", 800);

    const boardSize = Math.min(width, Math.max(205, this.height - 420));
    const boardLayout = { x: (this.width - boardSize) / 2, y: 177, size: boardSize, padding: 18 };
    this.layout.board = boardLayout;
    this.hit("board", boardLayout.x, boardLayout.y, boardLayout.size, boardLayout.size);
    this.renderBoard(room, boardLayout);

    const selfY = boardLayout.y + boardLayout.size + 12;
    this.playerCard(self, selfSide, margin, selfY, width, room.status === "active" && room.turn === selfSide);
    const actionY = selfY + 74;
    const actionWidth = (width - 8) / 2;
    this.button("undo", "悔一步", margin, actionY, actionWidth, 40, false, state.busy || room.status !== "active" || !room.moves.length);
    this.button("resign", "认输", margin + actionWidth + 8, actionY, actionWidth, 40, false, state.busy || room.status !== "active");
    const inviteY = actionY + 51;
    this.button("share", room.status === "waiting" ? "↗ 发给微信好友，等 TA 加入" : "↗ 分享这局棋", margin, inviteY, width, 45, true, state.busy);
    this.text(`你执${selfSide === 1 ? "黑" : "白"} · 第 ${room.moves.length + (room.status === "finished" ? 0 : 1)} 手`, this.width / 2, inviteY + 60, 8, COLORS.muted, "center", 600);

    if (room.status === "finished") this.renderResult(state, selfSide);
  }

  renderResult(state, selfSide) {
    const room = state.room;
    const winner = room.winner;
    const ownResult = winner === 0 ? "和棋" : winner === selfSide ? "你赢啦" : "好友赢啦";
    const width = Math.min(330, this.width - 42);
    const x = (this.width - width) / 2;
    const y = Math.max(160, this.height / 2 - 115);
    this.ctx.fillStyle = "rgba(28,42,34,.68)";
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.hit("modal-block", 0, 0, this.width, this.height);
    this.fillPixelCard(x, y, width, 224, COLORS.paper, COLORS.ink, 8);
    this.text(winner === 0 ? "GOOD DRAW" : "GOOD GAME!", this.width / 2, y + 31, 9, COLORS.orange, "center", 900);
    this.text(ownResult, this.width / 2, y + 70, 25, COLORS.ink, "center", 900);
    this.text(roomStatusText(room), this.width / 2, y + 104, 11, COLORS.muted, "center", 600);
    this.button("result-reset", "再来一局", x + 24, y + 132, width - 48, 42, true);
    this.text("返回首页查看战绩", this.width / 2, y + 196, 10, COLORS.green, "center", 700);
    this.hit("result-home", x + 70, y + 178, width - 140, 36);
  }

  renderBusy() {
    this.ctx.fillStyle = "rgba(248,245,233,.35)";
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  renderToast(message) {
    const width = Math.min(this.width - 40, Math.max(180, String(message).length * 14));
    const x = (this.width - width) / 2;
    const y = this.height - 68;
    this.ctx.fillStyle = "rgba(31,48,39,.94)";
    this.ctx.fillRect(x + 3, y + 3, width, 36);
    this.ctx.fillStyle = COLORS.ink;
    this.ctx.fillRect(x, y, width, 36);
    this.ctx.strokeStyle = "#dbe7ce";
    this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 35);
    this.text(message, this.width / 2, y + 18, 10, COLORS.white, "center", 600);
  }
}

module.exports = { Renderer };
