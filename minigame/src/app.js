const { GameApi } = require("./api");
const {
  applyRoomIfNewer,
  boardIndexFromPoint,
  makeDeviceId,
  normalizeRoomCode,
  parseBoard,
} = require("./core");
const { Renderer } = require("./renderer");

class PixelGomokuApp {
  constructor({ platform, config, gameServer = null }) {
    this.platform = platform;
    this.config = config;
    this.gameServer = gameServer;
    this.api = new GameApi(platform, config.API_BASE);
    this.renderer = null;
    this.pollTimer = null;
    this.pollInFlight = false;
    this.toastTimer = null;
    this.state = {
      screen: "loading",
      loadingText: "正在准备开发身份…",
      busy: false,
      toast: "",
      user: null,
      history: [],
      activeRoom: null,
      room: null,
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
      nickname = `微信棋手${String(deviceId).slice(-4).toUpperCase()}`;
      this.platform.setStorage(this.key("nickname"), nickname);
    }

    try {
      let profile;
      const savedToken = this.platform.getStorage(this.key("authToken"));
      if (savedToken) {
        this.api.setToken(savedToken);
        try { profile = await this.api.me(); } catch { profile = null; }
      }
      if (!profile) {
        const login = await this.api.devLogin(deviceId, nickname);
        this.platform.setStorage(this.key("authToken"), login.token);
        profile = {
          user: login.user,
          history: [],
          activeRoom: login.activeRoom,
        };
      }
      this.setState({
        screen: "home",
        user: profile.user,
        history: profile.history || [],
        activeRoom: profile.activeRoom || null,
      });
      const launchRoom = normalizeRoomCode(this.platform.launchQuery().room);
      if (launchRoom) await this.promptAndJoin(launchRoom);
      else await this.refreshProfile();
    } catch (caught) {
      this.setState({ screen: "home" });
      this.toast(this.errorMessage(caught, "开发服务暂时没连上"));
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
        activeRoom: profile.activeRoom || null,
      });
    } catch {}
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
        status: next.status,
      },
    });
  }

  async createRoom() {
    if (!this.api.token || this.state.busy) return;
    this.setState({ busy: true });
    try {
      const creation = await this.platform.promptCreateRoom();
      if (!creation) return;
      const result = await this.api.createRoom(creation.password);
      this.enterRoom(result.room);
      let gameServerReady = false;
      if (this.gameServer) {
        try { gameServerReady = await this.gameServer.hostRoom(result.room.id, this.api); } catch {}
      }
      this.toast(gameServerReady
        ? `房间 ${result.room.id} 已创建，好友可直接输入房间号`
        : `房间 ${result.room.id} 已创建，可直接输入房间号加入`);
    } catch (caught) {
      this.toast(this.errorMessage(caught, "创建房间失败"));
    } finally {
      this.setState({ busy: false });
    }
  }

  async joinRoom(roomCode, password = "") {
    const roomId = normalizeRoomCode(roomCode);
    if (!roomId || this.state.busy) return;
    this.setState({ busy: true });
    try {
      const result = await this.api.joinRoom(roomId, password);
      this.enterRoom(result.room);
      let gameServerReady = false;
      if (this.gameServer) {
        try { gameServerReady = await this.gameServer.guestRoom(roomId, this.api); } catch {}
      }
      this.toast(gameServerReady ? "已通过房间号加入微信联机" : "已加入好友棋局");
    } catch (caught) {
      this.toast(this.errorMessage(caught, "加入房间失败"));
    } finally {
      this.setState({ busy: false });
    }
  }

  async promptAndJoin(prefilledRoomCode = "") {
    const join = await this.platform.promptJoinRoom(prefilledRoomCode);
    if (join) await this.joinRoom(join.roomCode, join.password);
  }

  async resumeRoom() {
    const active = this.state.activeRoom;
    if (!active || this.state.busy) return;
    this.setState({ busy: true });
    try {
      const result = await this.api.room(active.id);
      this.enterRoom(result.room);
      await this.reconnectGameServer(result.room);
    } catch (caught) {
      this.toast(this.errorMessage(caught, "棋局恢复失败"));
      await this.refreshProfile();
    } finally {
      this.setState({ busy: false });
    }
  }

  gameServerStatus(event, detail) {
    if (event === "peer-message") {
      this.toast(detail && detail.role === "host"
        ? "好友已通过微信房间连上"
        : "已收到房主的微信联机回执");
    } else if (event === "room-disconnected") {
      this.toast("微信联机短暂断开，正在恢复");
    } else if (event === "room-reconnect-failed") {
      this.toast("微信联机恢复失败，棋局仍可继续");
    }
  }

  async reconnectGameServer(room) {
    if (!this.gameServer || !room || room.status === "finished") return false;
    try {
      return await this.gameServer.reconnectRoom(room.id, room.side, this.api);
    } catch {
      this.gameServerStatus("room-reconnect-failed", { role: room.side === 1 ? "host" : "guest" });
      return false;
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
      if (showError) this.toast(this.errorMessage(caught, "同步棋局失败"));
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
      this.toast(this.errorMessage(caught, "操作失败"));
    } finally {
      this.setState({ busy: false });
    }
  }

  async handleShow() {
    if (this.state.screen === "game") {
      await this.refreshRoom(false);
      await this.reconnectGameServer(this.state.room);
    } else {
      await this.refreshProfile();
    }
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
      if (room.turn !== room.side) return this.toast("还没轮到你");
      const index = boardIndexFromPoint(x, y, this.renderer.layout.board);
      if (index < 0) return;
      if (parseBoard(room.board)[index]) return this.toast("这里已经有棋子了");
      return this.roomAction("move", index);
    }
  }
}

module.exports = { PixelGomokuApp };
