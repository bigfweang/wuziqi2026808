"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // minigame/src/core.js
  var require_core = __commonJS({
    "minigame/src/core.js"(exports, module) {
      "use strict";
      var BOARD_SIZE = 15;
      var CELL_COUNT = BOARD_SIZE * BOARD_SIZE;
      var AVATAR_FILES = [
        "01-face-short-hair.png",
        "02-face-bob.png",
        "03-face-curly.png",
        "04-face-glasses.png",
        "05-face-bangs.png",
        "06-face-spiky.png",
        "07-face-beard.png",
        "08-face-bun.png",
        "09-face-mustache.png"
      ];
      function applyRoomIfNewer(current, incoming) {
        if (!incoming) return current;
        if (!current || current.id !== incoming.id) return incoming;
        return Number(incoming.revision) >= Number(current.revision) ? incoming : current;
      }
      function parseBoard(value) {
        if (typeof value !== "string" || value.length !== CELL_COUNT || /[^012]/.test(value)) {
          return Array(CELL_COUNT).fill(0);
        }
        return Array.from(value, Number);
      }
      function roomStatusText(room) {
        if (!room) return "\u6B63\u5728\u8FDE\u63A5\u68CB\u5C40";
        if (room.status === "waiting") return "\u7B49\u5F85\u597D\u53CB\u52A0\u5165";
        if (room.status === "finished") {
          if (room.winner === 1) return "\u9ED1\u65B9\u8FDE\u6210\u4E94\u5B50";
          if (room.winner === 2) return "\u767D\u65B9\u8FDE\u6210\u4E94\u5B50";
          return "\u548C\u68CB\uFF0C\u68CB\u76D8\u4E0B\u6EE1\u5566";
        }
        return room.turn === 1 ? "\u8F6E\u5230\u9ED1\u65B9" : "\u8F6E\u5230\u767D\u65B9";
      }
      function boardIndexFromPoint(x, y, board) {
        if (!board || x < board.x || y < board.y || x > board.x + board.size || y > board.y + board.size) return -1;
        const span = board.size - board.padding * 2;
        const cell = span / (BOARD_SIZE - 1);
        const col = Math.round((x - board.x - board.padding) / cell);
        const row = Math.round((y - board.y - board.padding) / cell);
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return -1;
        const centerX = board.x + board.padding + col * cell;
        const centerY = board.y + board.padding + row * cell;
        if (Math.abs(x - centerX) > cell * 0.62 || Math.abs(y - centerY) > cell * 0.62) return -1;
        return row * BOARD_SIZE + col;
      }
      function normalizeRoomCode(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      }
      function inviteQuery(roomId) {
        return `room=${encodeURIComponent(normalizeRoomCode(roomId))}`;
      }
      function avatarFile(avatarId) {
        const index = Math.max(1, Math.min(9, Number(avatarId) || 1)) - 1;
        return AVATAR_FILES[index];
      }
      function makeDeviceId(random = Math.random, now = Date.now) {
        const seed = `${now().toString(36)}-${Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36)}`;
        return `dev-${seed.replace(/[^a-z0-9-]/gi, "").slice(0, 80)}`;
      }
      function winningLine(room) {
        return new Set(Array.isArray(room && room.winningLine) ? room.winningLine : []);
      }
      module.exports = {
        AVATAR_FILES,
        BOARD_SIZE,
        CELL_COUNT,
        applyRoomIfNewer,
        avatarFile,
        boardIndexFromPoint,
        inviteQuery,
        makeDeviceId,
        normalizeRoomCode,
        parseBoard,
        roomStatusText,
        winningLine
      };
    }
  });

  // minigame/src/platform.js
  var require_platform = __commonJS({
    "minigame/src/platform.js"(exports, module) {
      "use strict";
      var { inviteQuery, normalizeRoomCode } = require_core();
      function createPlatform2(wxApi) {
        if (!wxApi) throw new Error("\u5FAE\u4FE1\u5C0F\u6E38\u620F\u8FD0\u884C\u65F6\u4E0D\u53EF\u7528");
        const isPreview = Boolean(wxApi.__isPreview);
        function systemInfo() {
          const legacy = typeof wxApi.getSystemInfoSync === "function" ? wxApi.getSystemInfoSync() : {};
          const windowInfo = typeof wxApi.getWindowInfo === "function" ? wxApi.getWindowInfo() : legacy;
          return {
            width: Number(windowInfo.windowWidth || legacy.windowWidth || 390),
            height: Number(windowInfo.windowHeight || legacy.windowHeight || 844),
            pixelRatio: Math.max(1, Math.min(3, Number(legacy.pixelRatio || 1))),
            safeArea: windowInfo.safeArea || legacy.safeArea || null
          };
        }
        function request({ url, method = "GET", data, headers = {} }) {
          return new Promise((resolve, reject) => {
            wxApi.request({
              url,
              method,
              data,
              header: headers,
              success(response) {
                const body = response.data || {};
                if (response.statusCode >= 200 && response.statusCode < 300) resolve(body);
                else reject(new Error(body.error || `\u8BF7\u6C42\u5931\u8D25\uFF08${response.statusCode}\uFF09`));
              },
              fail(error) {
                reject(new Error(error && error.errMsg ? error.errMsg : "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25"));
              }
            });
          });
        }
        function getStorage(key) {
          try {
            return wxApi.getStorageSync(key);
          } catch {
            return "";
          }
        }
        function setStorage(key, value) {
          try {
            wxApi.setStorageSync(key, value);
          } catch {
          }
        }
        function removeStorage(key) {
          try {
            wxApi.removeStorageSync(key);
          } catch {
          }
        }
        function onTap(handler) {
          wxApi.onTouchEnd((event) => {
            const touch = event.changedTouches && event.changedTouches[0];
            if (!touch) return;
            handler(Number(touch.clientX ?? touch.x), Number(touch.clientY ?? touch.y));
          });
        }
        function promptRoomCode() {
          return new Promise((resolve) => {
            wxApi.showModal({
              title: "\u52A0\u5165\u597D\u53CB\u68CB\u5C40",
              content: "",
              editable: true,
              placeholderText: "\u8F93\u5165 6 \u4F4D\u623F\u95F4\u7801",
              confirmText: "\u52A0\u5165",
              success(result) {
                resolve(result.confirm ? normalizeRoomCode(result.content) : "");
              },
              fail() {
                resolve("");
              }
            });
          });
        }
        function shareRoom(roomId) {
          const payload = {
            title: `\u6765\u548C\u6211\u4E0B\u4E00\u76D8\u50CF\u7D20\u4E94\u5B50\u68CB\uFF5C\u623F\u95F4 ${roomId}`,
            query: inviteQuery(roomId)
          };
          if (typeof wxApi.shareAppMessage === "function") wxApi.shareAppMessage(payload);
          return payload;
        }
        function configureShare(getRoomId) {
          if (typeof wxApi.showShareMenu === "function") {
            wxApi.showShareMenu({ menus: ["shareAppMessage"], withShareTicket: true });
          }
          if (typeof wxApi.onShareAppMessage === "function") {
            wxApi.onShareAppMessage(() => {
              const roomId = getRoomId();
              return roomId ? {
                title: `\u6765\u548C\u6211\u4E0B\u4E00\u76D8\u50CF\u7D20\u4E94\u5B50\u68CB\uFF5C\u623F\u95F4 ${roomId}`,
                query: inviteQuery(roomId)
              } : { title: "\u50CF\u7D20\u4E94\u5B50\u68CB\uFF5C\u843D\u5B50\u65E0\u58F0\uFF0C\u53CB\u60C5\u6709\u56DE\u58F0" };
            });
          }
        }
        function launchQuery() {
          try {
            return wxApi.getLaunchOptionsSync && wxApi.getLaunchOptionsSync().query || {};
          } catch {
            return {};
          }
        }
        function createImage(canvas, source) {
          const image = canvas && typeof canvas.createImage === "function" ? canvas.createImage() : typeof Image !== "undefined" ? new Image() : null;
          if (image) image.src = source;
          return image;
        }
        return {
          isPreview,
          systemInfo,
          createCanvas: () => wxApi.createCanvas(),
          createImage,
          request,
          getStorage,
          setStorage,
          removeStorage,
          onTap,
          promptRoomCode,
          shareRoom,
          configureShare,
          launchQuery,
          onShow: (callback) => wxApi.onShow && wxApi.onShow(callback),
          onHide: (callback) => wxApi.onHide && wxApi.onHide(callback),
          setInterval: (callback, ms) => setInterval(callback, ms),
          clearInterval: (timer) => clearInterval(timer)
        };
      }
      module.exports = { createPlatform: createPlatform2 };
    }
  });

  // minigame/src/api.js
  var require_api = __commonJS({
    "minigame/src/api.js"(exports, module) {
      "use strict";
      var GameApi = class {
        constructor(platform2, baseUrl) {
          this.platform = platform2;
          this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
          this.token = "";
        }
        setToken(token) {
          this.token = token || "";
        }
        headers(json = false) {
          const headers = {};
          if (json) headers["content-type"] = "application/json";
          if (this.token) headers.authorization = `Bearer ${this.token}`;
          return headers;
        }
        call(path, method = "GET", data) {
          return this.platform.request({
            url: `${this.baseUrl}${path}`,
            method,
            data,
            headers: this.headers(Boolean(data))
          });
        }
        async devLogin(deviceId, nickname) {
          const response = await this.call("/api/auth/session", "POST", {
            mode: "dev",
            deviceId,
            nickname
          });
          this.setToken(response.token);
          return response;
        }
        me() {
          return this.call("/api/me");
        }
        createRoom() {
          return this.call("/api/rooms", "POST", { action: "create" });
        }
        joinRoom(roomId) {
          return this.call("/api/rooms", "POST", { action: "join", id: roomId });
        }
        room(roomId) {
          return this.call(`/api/rooms?id=${encodeURIComponent(roomId)}`);
        }
        action(roomId, action, index) {
          const data = { action, id: roomId };
          if (Number.isInteger(index)) data.index = index;
          return this.call("/api/rooms", "PATCH", data);
        }
      };
      module.exports = { GameApi };
    }
  });

  // minigame/src/renderer.js
  var require_renderer = __commonJS({
    "minigame/src/renderer.js"(exports, module) {
      "use strict";
      var {
        avatarFile,
        parseBoard,
        roomStatusText,
        winningLine
      } = require_core();
      var COLORS = {
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
        red: "#d95e49"
      };
      var Renderer = class {
        constructor(platform2, invalidate) {
          this.platform = platform2;
          this.invalidate = invalidate;
          this.canvas = platform2.createCanvas();
          this.ctx = this.canvas.getContext("2d");
          this.images = /* @__PURE__ */ new Map();
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
            try {
              this.ctx.drawImage(image, x, y, size, size);
            } catch {
            }
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
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, this.height);
            ctx.stroke();
          }
          for (let y = 0; y <= this.height; y += 16) {
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(this.width, y + 0.5);
            ctx.stroke();
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
            this.text("\u2039", x + 10, 32, 32, COLORS.ink, "center", 400);
            this.hit("back", x - 4, 8, 44, 48);
          }
          this.text(title, this.width / 2, 25, 17, COLORS.ink, "center", 800);
          this.text(subtitle, this.width / 2, 44, 8, COLORS.muted, "center", 700);
          if (share) {
            this.fillPixelCard(this.width - x - 45, 13, 45, 31, "rgba(255,255,255,.8)", "#bfc6ba", 1);
            this.text("\u5206\u4EAB", this.width - x - 22, 29, 10, COLORS.green, "center", 800);
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
          this.header("\u50CF\u7D20\u4E94\u5B50\u68CB", "PIXEL GOMOKU \xB7 DEV", false, false);
          const cx = this.width / 2;
          const cy = this.height * 0.43;
          this.ctx.fillStyle = COLORS.green;
          for (let i = 0; i < 5; i += 1) this.ctx.fillRect(cx - 42 + i * 20, cy, 11, 11);
          this.text(state.loadingText || "\u6B63\u5728\u51C6\u5907\u5F00\u53D1\u8EAB\u4EFD\u2026", cx, cy + 38, 12, COLORS.muted, "center", 600);
        }
        renderHome(state) {
          this.header("\u50CF\u7D20\u4E94\u5B50\u68CB", "PIXEL GOMOKU \xB7 \u5F00\u53D1\u7248", false, false);
          const margin = Math.max(18, (this.width - 404) / 2);
          const width = this.width - margin * 2;
          const user = state.user || { nickname: "\u5F00\u53D1\u68CB\u624B", avatarId: 1, stats: {} };
          const stats = user.stats || {};
          this.fillPixelCard(margin, 68, width, 84, COLORS.white, "#c9d1c1", 4);
          this.avatar(user.avatarId, margin + 12, 80, 58);
          this.text(user.nickname, margin + 84, 91, 17, COLORS.ink, "left", 800);
          this.ctx.fillStyle = "#4fa76f";
          this.ctx.fillRect(margin + 84, 113, 8, 8);
          this.text("\u5728\u7EBF \xB7 \u5F00\u53D1\u8EAB\u4EFD", margin + 99, 117, 10, COLORS.green, "left", 700);
          this.text("\u5934\u50CF\u5DF2\u968F\u673A\u5206\u914D\u5E76\u4F1A\u4FDD\u6301", margin + 84, 137, 9, COLORS.muted, "left", 500);
          const statY = 166;
          const gap = 7;
          const statWidth = (width - gap * 3) / 4;
          [["\u80DC", stats.wins || 0], ["\u8D1F", stats.losses || 0], ["\u548C", stats.draws || 0], ["\u603B\u5C40", stats.total || 0]].forEach(([label, value], index) => {
            const x = margin + index * (statWidth + gap);
            this.fillPixelCard(x, statY, statWidth, 58, "#f2f5e9", "#d2d8ca", 2);
            this.text(value, x + statWidth / 2, statY + 22, 19, index === 0 ? COLORS.green : COLORS.ink, "center", 800);
            this.text(label, x + statWidth / 2, statY + 43, 9, COLORS.muted, "center", 600);
          });
          let buttonY = 244;
          if (state.activeRoom) {
            this.button("resume", `\u7EE7\u7EED\u623F\u95F4 ${state.activeRoom.id}`, margin, buttonY, width, 48, true);
            buttonY += 60;
          }
          this.button("create", "\uFF0B \u521B\u5EFA\u68CB\u5C40\u5E76\u9080\u8BF7\u597D\u53CB", margin, buttonY, width, 48, true);
          buttonY += 60;
          this.button("join", "\u8F93\u5165\u623F\u95F4\u7801\u52A0\u5165", margin, buttonY, width, 44, false);
          const historyY = buttonY + 68;
          this.text("\u6700\u8FD1\u5BF9\u5C40", margin, historyY, 13, COLORS.ink, "left", 800);
          this.text("\u65E5\u671F\u4E0E\u8F93\u8D62\u4F1A\u4FDD\u5B58\u5728\u8D26\u53F7\u4E2D", margin + width, historyY, 9, COLORS.muted, "right", 500);
          const history = Array.isArray(state.history) ? state.history.slice(0, 3) : [];
          if (!history.length) {
            this.fillPixelCard(margin, historyY + 18, width, 52, "#f4f4e9", "#d8dbd1", 1);
            this.text("\u8FD8\u6CA1\u6709\u6218\u7EE9\uFF0C\u5148\u9080\u8BF7\u4E00\u4F4D\u597D\u53CB\u5427", this.width / 2, historyY + 44, 10, COLORS.muted, "center", 500);
          } else {
            history.forEach((item, index) => {
              const y = historyY + 18 + index * 45;
              this.fillPixelCard(margin, y, width, 38, COLORS.white, "#d8dbd1", 1);
              const resultText = item.result === "win" ? "\u80DC" : item.result === "loss" ? "\u8D1F" : "\u548C";
              const resultColor = item.result === "win" ? COLORS.green : item.result === "loss" ? COLORS.red : COLORS.orange;
              this.text(resultText, margin + 19, y + 19, 13, resultColor, "center", 900);
              this.text(item.opponent ? `\u5BF9\u9635 ${item.opponent.nickname}` : `\u623F\u95F4 ${item.roomId}`, margin + 38, y + 13, 10, COLORS.ink, "left", 700);
              this.text(String(item.endedAt || "").slice(0, 10), margin + 38, y + 27, 8, COLORS.muted, "left", 500);
            });
          }
          this.text("\u8D26\u53F7\u63A5\u5165\u540E\uFF1A\u5F00\u53D1\u8EAB\u4EFD\u5C06\u66FF\u6362\u4E3A\u5FAE\u4FE1\u767B\u5F55", this.width / 2, this.height - 22, 8, COLORS.muted, "center", 600);
        }
        playerCard(player, side, x, y, width, isTurn) {
          this.fillPixelCard(x, y, width, 62, isTurn ? "#edf3e6" : COLORS.white, isTurn ? "#7fa185" : "#d1d5ca", isTurn ? 4 : 2);
          const safePlayer = player || { nickname: "\u7B49\u5F85\u597D\u53CB", avatarId: 2, online: false };
          this.avatar(safePlayer.avatarId, x + 8, y + 8, 46);
          this.text(safePlayer.nickname, x + 66, y + 20, 13, COLORS.ink, "left", 800);
          this.ctx.fillStyle = safePlayer.online ? "#4fa76f" : "#a6aaa3";
          this.ctx.fillRect(x + 66, y + 39, 7, 7);
          this.text(safePlayer.online ? "\u5728\u7EBF" : "\u79BB\u7EBF", x + 79, y + 43, 9, safePlayer.online ? COLORS.green : COLORS.muted, "left", 600);
          this.ctx.fillStyle = side === 1 ? "#27302c" : "#fff9e8";
          this.ctx.beginPath();
          this.ctx.arc(x + width - 29, y + 23, 9, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.strokeStyle = "#766c5c";
          this.ctx.stroke();
          this.text(side === 1 ? "\u9ED1\u65B9" : "\u767D\u65B9", x + width - 29, y + 46, 8, COLORS.muted, "center", 700);
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
            ctx.beginPath();
            ctx.moveTo(originX + offset, originY);
            ctx.lineTo(originX + offset, originY + span);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(originX, originY + offset);
            ctx.lineTo(originX + span, originY + offset);
            ctx.stroke();
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
            ctx.beginPath();
            ctx.arc(cx + 1, cy + 2, radius, 0, Math.PI * 2);
            ctx.fill();
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
          this.header("\u50CF\u7D20\u4E94\u5B50\u68CB", room ? `\u623F\u95F4 ${room.id}` : "\u6B63\u5728\u8FDB\u5165\u623F\u95F4", true, Boolean(room));
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
          this.button("undo", "\u6094\u4E00\u6B65", margin, actionY, actionWidth, 40, false, state.busy || room.status !== "active" || !room.moves.length);
          this.button("resign", "\u8BA4\u8F93", margin + actionWidth + 8, actionY, actionWidth, 40, false, state.busy || room.status !== "active");
          const inviteY = actionY + 51;
          this.button("share", room.status === "waiting" ? "\u2197 \u53D1\u7ED9\u5FAE\u4FE1\u597D\u53CB\uFF0C\u7B49 TA \u52A0\u5165" : "\u2197 \u5206\u4EAB\u8FD9\u5C40\u68CB", margin, inviteY, width, 45, true, state.busy);
          this.text(`\u4F60\u6267${selfSide === 1 ? "\u9ED1" : "\u767D"} \xB7 \u7B2C ${room.moves.length + (room.status === "finished" ? 0 : 1)} \u624B`, this.width / 2, inviteY + 60, 8, COLORS.muted, "center", 600);
          if (room.status === "finished") this.renderResult(state, selfSide);
        }
        renderResult(state, selfSide) {
          const room = state.room;
          const winner = room.winner;
          const ownResult = winner === 0 ? "\u548C\u68CB" : winner === selfSide ? "\u4F60\u8D62\u5566" : "\u597D\u53CB\u8D62\u5566";
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
          this.button("result-reset", "\u518D\u6765\u4E00\u5C40", x + 24, y + 132, width - 48, 42, true);
          this.text("\u8FD4\u56DE\u9996\u9875\u67E5\u770B\u6218\u7EE9", this.width / 2, y + 196, 10, COLORS.green, "center", 700);
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
      };
      module.exports = { Renderer };
    }
  });

  // minigame/src/app.js
  var require_app = __commonJS({
    "minigame/src/app.js"(exports, module) {
      "use strict";
      var { GameApi } = require_api();
      var {
        applyRoomIfNewer,
        boardIndexFromPoint,
        makeDeviceId,
        normalizeRoomCode,
        parseBoard
      } = require_core();
      var { Renderer } = require_renderer();
      var PixelGomokuApp2 = class {
        constructor({ platform: platform2, config: config2 }) {
          this.platform = platform2;
          this.config = config2;
          this.api = new GameApi(platform2, config2.API_BASE);
          this.renderer = null;
          this.pollTimer = null;
          this.pollInFlight = false;
          this.toastTimer = null;
          this.state = {
            screen: "loading",
            loadingText: "\u6B63\u5728\u51C6\u5907\u5F00\u53D1\u8EAB\u4EFD\u2026",
            busy: false,
            toast: "",
            user: null,
            history: [],
            activeRoom: null,
            room: null
          };
        }
        start() {
          this.renderer = new Renderer(this.platform, () => this.render());
          this.platform.onTap((x, y) => this.handleTap(x, y));
          this.platform.configureShare(() => this.state.room && this.state.room.id);
          this.platform.onShow(() => this.handleShow());
          this.platform.onHide(() => this.persistRoom());
          this.pollTimer = this.platform.setInterval(() => this.refreshRoom(false), this.config.POLL_MS);
          this.render();
          this.bootstrap();
        }
        key(name) {
          return `${this.config.STORAGE_PREFIX}${name}`;
        }
        render() {
          if (this.renderer) this.renderer.render(this.state);
        }
        setState(patch) {
          Object.assign(this.state, patch);
          this.render();
        }
        toast(message) {
          if (this.toastTimer) clearTimeout(this.toastTimer);
          this.setState({ toast: String(message || "") });
          this.toastTimer = setTimeout(() => this.setState({ toast: "" }), 2200);
        }
        async bootstrap() {
          let deviceId = this.platform.getStorage(this.key("deviceId"));
          if (!deviceId) {
            deviceId = makeDeviceId();
            this.platform.setStorage(this.key("deviceId"), deviceId);
          }
          let nickname = this.platform.getStorage(this.key("nickname"));
          if (!nickname) {
            nickname = `\u5FAE\u4FE1\u68CB\u624B${String(deviceId).slice(-4).toUpperCase()}`;
            this.platform.setStorage(this.key("nickname"), nickname);
          }
          try {
            let profile;
            const savedToken = this.platform.getStorage(this.key("authToken"));
            if (savedToken) {
              this.api.setToken(savedToken);
              try {
                profile = await this.api.me();
              } catch {
                profile = null;
              }
            }
            if (!profile) {
              const login = await this.api.devLogin(deviceId, nickname);
              this.platform.setStorage(this.key("authToken"), login.token);
              profile = {
                user: login.user,
                history: [],
                activeRoom: login.activeRoom
              };
            }
            this.setState({
              screen: "home",
              user: profile.user,
              history: profile.history || [],
              activeRoom: profile.activeRoom || null
            });
            const launchRoom = normalizeRoomCode(this.platform.launchQuery().room);
            if (launchRoom) await this.joinRoom(launchRoom);
            else await this.refreshProfile();
          } catch (caught) {
            this.setState({ screen: "home" });
            this.toast(this.errorMessage(caught, "\u5F00\u53D1\u670D\u52A1\u6682\u65F6\u6CA1\u8FDE\u4E0A"));
          }
        }
        errorMessage(caught, fallback) {
          return caught instanceof Error && caught.message ? caught.message : fallback;
        }
        async refreshProfile() {
          if (!this.api.token) return;
          try {
            const profile = await this.api.me();
            this.setState({
              user: profile.user,
              history: profile.history || [],
              activeRoom: profile.activeRoom || null
            });
          } catch {
          }
        }
        persistRoom() {
          const room = this.state.room;
          if (room) this.platform.setStorage(this.key("lastRoom"), room.id);
        }
        enterRoom(room) {
          const next = applyRoomIfNewer(this.state.room, room);
          this.platform.setStorage(this.key("lastRoom"), next.id);
          this.setState({
            screen: "game",
            room: next,
            activeRoom: next.status === "finished" ? null : {
              id: next.id,
              side: next.side,
              status: next.status
            }
          });
        }
        async createRoom() {
          if (!this.api.token || this.state.busy) return;
          this.setState({ busy: true });
          try {
            const result = await this.api.createRoom();
            this.enterRoom(result.room);
            this.toast("\u623F\u95F4\u5F00\u597D\u5566\uFF0C\u53D1\u7ED9\u597D\u53CB\u5427");
          } catch (caught) {
            this.toast(this.errorMessage(caught, "\u521B\u5EFA\u623F\u95F4\u5931\u8D25"));
          } finally {
            this.setState({ busy: false });
          }
        }
        async joinRoom(roomCode) {
          const roomId = normalizeRoomCode(roomCode);
          if (!roomId || this.state.busy) return;
          this.setState({ busy: true });
          try {
            const result = await this.api.joinRoom(roomId);
            this.enterRoom(result.room);
            this.toast("\u5DF2\u52A0\u5165\u597D\u53CB\u68CB\u5C40");
          } catch (caught) {
            this.toast(this.errorMessage(caught, "\u52A0\u5165\u623F\u95F4\u5931\u8D25"));
          } finally {
            this.setState({ busy: false });
          }
        }
        async promptAndJoin() {
          const code = await this.platform.promptRoomCode();
          if (code) await this.joinRoom(code);
        }
        async resumeRoom() {
          const active = this.state.activeRoom;
          if (!active || this.state.busy) return;
          this.setState({ busy: true });
          try {
            const result = await this.api.room(active.id);
            this.enterRoom(result.room);
          } catch (caught) {
            this.toast(this.errorMessage(caught, "\u68CB\u5C40\u6062\u590D\u5931\u8D25"));
            await this.refreshProfile();
          } finally {
            this.setState({ busy: false });
          }
        }
        async refreshRoom(showError) {
          const room = this.state.room;
          if (this.state.screen !== "game" || !room || this.pollInFlight) return;
          this.pollInFlight = true;
          try {
            const result = await this.api.room(room.id);
            const previousStatus = this.state.room && this.state.room.status;
            this.enterRoom(result.room);
            if (previousStatus !== "finished" && result.room.status === "finished") await this.refreshProfile();
          } catch (caught) {
            if (showError) this.toast(this.errorMessage(caught, "\u540C\u6B65\u68CB\u5C40\u5931\u8D25"));
          } finally {
            this.pollInFlight = false;
          }
        }
        async roomAction(action, index) {
          const room = this.state.room;
          if (!room || this.state.busy) return;
          this.setState({ busy: true });
          try {
            const result = await this.api.action(room.id, action, index);
            this.enterRoom(result.room);
            if (result.room.status === "finished") await this.refreshProfile();
          } catch (caught) {
            this.toast(this.errorMessage(caught, "\u64CD\u4F5C\u5931\u8D25"));
          } finally {
            this.setState({ busy: false });
          }
        }
        handleShow() {
          if (this.state.screen === "game") this.refreshRoom(false);
          else this.refreshProfile();
        }
        async handleTap(x, y) {
          const id = this.renderer.hitAt(x, y);
          if (!id || id === "modal-block" || this.state.busy) return;
          if (id === "create") return this.createRoom();
          if (id === "join") return this.promptAndJoin();
          if (id === "resume") return this.resumeRoom();
          if (id === "back" || id === "result-home") {
            this.setState({ screen: "home", room: null });
            return this.refreshProfile();
          }
          if (id === "share") {
            if (this.state.room) this.platform.shareRoom(this.state.room.id);
            return;
          }
          if (id === "resign") return this.roomAction("resign");
          if (id === "undo") return this.roomAction("undo");
          if (id === "reset" || id === "result-reset") return this.roomAction("reset");
          if (id === "board") {
            const room = this.state.room;
            if (!room || room.status !== "active") return;
            if (room.turn !== room.side) return this.toast("\u8FD8\u6CA1\u8F6E\u5230\u4F60");
            const index = boardIndexFromPoint(x, y, this.renderer.layout.board);
            if (index < 0) return;
            if (parseBoard(room.board)[index]) return this.toast("\u8FD9\u91CC\u5DF2\u7ECF\u6709\u68CB\u5B50\u4E86");
            return this.roomAction("move", index);
          }
        }
      };
      module.exports = { PixelGomokuApp: PixelGomokuApp2 };
    }
  });

  // minigame/src/config.js
  var require_config = __commonJS({
    "minigame/src/config.js"(exports, module) {
      "use strict";
      var API_BASE = typeof globalThis !== "undefined" && globalThis.__PIXEL_GOMOKU_API_BASE__ ? String(globalThis.__PIXEL_GOMOKU_API_BASE__).replace(/\/$/, "") : "http://127.0.0.1:3000";
      module.exports = {
        API_BASE,
        POLL_MS: 1400,
        STORAGE_PREFIX: "pixel-gomoku-dev:"
      };
    }
  });

  // minigame/game.js
  var { createPlatform } = require_platform();
  var { PixelGomokuApp } = require_app();
  var config = require_config();
  var platform = createPlatform(typeof wx === "undefined" ? null : wx);
  var app = new PixelGomokuApp({ platform, config });
  app.start();
  if (typeof GameGlobal !== "undefined") GameGlobal.pixelGomokuApp = app;
  if (typeof globalThis !== "undefined") globalThis.pixelGomokuApp = app;
})();
//# sourceMappingURL=bundle.js.map
