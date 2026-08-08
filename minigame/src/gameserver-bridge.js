const ROOM_EXT_PREFIX = "pixel-gomoku:";
const MESSAGE_TYPE = "pixel-gomoku-gsm-v1";

function dataOf(result) {
  return result && result.data ? result.data : result || {};
}

function safeCode(error) {
  return error && (error.errCode || error.code) ? String(error.errCode || error.code) : "";
}

function operationError(stage, error) {
  const code = safeCode(error);
  return new Error(`微信联机${stage}失败${code ? `（${code}）` : ""}`);
}

function callbackOperation(invoke) {
  return new Promise((resolve, reject) => {
    invoke({ success: resolve, fail: reject });
  });
}

class GameServerBridge {
  constructor({ wxApi, platform, onStatus = () => {} }) {
    this.wxApi = wxApi;
    this.platform = platform;
    this.onStatus = onStatus;
    this.manager = null;
    this.readyPromise = null;
    this.listenersReady = false;
    this.roomId = "";
    this.role = "";
    this.api = null;
    this.reconnectPending = false;
  }

  status(event, detail = {}) {
    this.onStatus(event, detail);
  }

  isDeviceRuntime() {
    if (!this.wxApi || this.platform.isPreview) return false;
    try {
      const deviceInfo = typeof this.wxApi.getDeviceInfo === "function"
        ? this.wxApi.getDeviceInfo()
        : {};
      if (String(deviceInfo.platform || "").toLowerCase() === "devtools") return false;
    } catch {}
    return typeof this.wxApi.getGameServerManager === "function";
  }

  attachListeners() {
    if (this.listenersReady || !this.manager) return;
    this.listenersReady = true;
    if (typeof this.manager.onBroadcast === "function") {
      this.manager.onBroadcast((result) => {
        let message;
        try { message = JSON.parse(String(result && result.msg || "")); } catch { return; }
        if (!message || message.type !== MESSAGE_TYPE || message.roomId !== this.roomId) return;
        if (message.event === "ping" && this.role === "host") {
          this.status("peer-message", { role: "host" });
          this.broadcast("ack");
        } else if (message.event === "ack" && this.role === "guest") {
          this.status("peer-message", { role: "guest" });
        }
      });
    }
    if (typeof this.manager.onDisconnect === "function") {
      this.manager.onDisconnect((error) => {
        void this.reconnectAfterDisconnect(error);
      });
    }
  }

  async reconnectAfterDisconnect(error) {
    if (!this.roomId || !this.role || !this.api || this.reconnectPending) return false;
    const roomId = this.roomId;
    const role = this.role;
    const side = role === "host" ? 1 : 2;
    this.status("room-disconnected", { roomId, role, errCode: safeCode(error) });
    try {
      return await this.reconnectRoom(roomId, side, this.api);
    } catch {
      this.status("room-reconnect-failed", { roomId, role });
      return false;
    }
  }

  ensureReady() {
    if (!this.isDeviceRuntime()) return Promise.resolve(false);
    if (this.readyPromise) return this.readyPromise;
    this.manager = this.wxApi.getGameServerManager();
    this.readyPromise = this.manager.login()
      .then(() => {
        this.attachListeners();
        this.status("login-ok");
        return true;
      })
      .catch((error) => {
        this.status("login-failed", { errCode: safeCode(error) });
        throw operationError("登录", error);
      });
    return this.readyPromise;
  }

  broadcast(event) {
    if (!this.manager || !this.roomId) return;
    this.manager.broadcastInRoom({
      msg: JSON.stringify({ type: MESSAGE_TYPE, event, roomId: this.roomId }),
      success: () => this.status("broadcast-sent", { event, role: this.role }),
      fail: (error) => this.status("broadcast-failed", { event, errCode: safeCode(error) }),
    });
  }

  async hostRoom(roomId, api) {
    if (!await this.ensureReady()) return false;
    let result;
    try {
      result = await callbackOperation(({ success, fail }) => this.manager.createRoom({
        maxMemberNum: 2,
        startPercent: 100,
        needUserInfo: false,
        gameLastTime: 600,
        roomExtInfo: `${ROOM_EXT_PREFIX}${roomId}`,
        success,
        fail,
      }));
    } catch (error) {
      throw operationError("建房", error);
    }
    const accessInfo = String(dataOf(result).accessInfo || "");
    if (!accessInfo) throw new Error("微信联机建房失败（缺少房间凭证）");
    await api.registerGameServerRoom(roomId, accessInfo, 600);
    this.roomId = roomId;
    this.role = "host";
    this.api = api;
    this.status("host-ready", { roomId });
    return true;
  }

  async guestRoom(roomId, api) {
    if (!await this.ensureReady()) return false;
    const broker = await api.gameServerRoom(roomId);
    try {
      await callbackOperation(({ success, fail }) => this.manager.joinRoom({
        accessInfo: broker.accessInfo,
        success,
        fail,
      }));
    } catch (error) {
      throw operationError("加入", error);
    }
    this.roomId = roomId;
    this.role = "guest";
    this.api = api;
    this.status("guest-ready", { roomId });
    this.broadcast("ping");
    return true;
  }

  async lastRoomInfo() {
    try {
      return dataOf(await callbackOperation(({ success, fail }) => {
        this.manager.getLastRoomInfo({ success, fail });
      }));
    } catch {
      return {};
    }
  }

  async reconnectRoom(roomId, side, api) {
    if (this.reconnectPending) return false;
    this.reconnectPending = true;
    try {
      if (!await this.ensureReady()) return false;
      const lastRoom = await this.lastRoomInfo();
      const roomExtInfo = lastRoom.roomInfo && lastRoom.roomInfo.roomExtInfo;
      if (lastRoom.accessInfo && roomExtInfo === `${ROOM_EXT_PREFIX}${roomId}`) {
        try {
          await this.manager.reconnect({ accessInfo: lastRoom.accessInfo });
        } catch (error) {
          throw operationError("重连", error);
        }
        this.roomId = roomId;
        this.role = side === 1 ? "host" : "guest";
        this.api = api;
        this.status("room-reconnected", { roomId, role: this.role });
        if (this.role === "guest") this.broadcast("ping");
        return true;
      }
      return side === 1 ? this.hostRoom(roomId, api) : this.guestRoom(roomId, api);
    } finally {
      this.reconnectPending = false;
    }
  }
}

module.exports = { GameServerBridge, MESSAGE_TYPE, ROOM_EXT_PREFIX };
