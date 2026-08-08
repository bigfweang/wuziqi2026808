class GameApi {
  constructor(platform, baseUrl) {
    this.platform = platform;
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
      headers: this.headers(Boolean(data)),
    });
  }

  async devLogin(deviceId, nickname) {
    const response = await this.call("/api/auth/session", "POST", {
      mode: "dev",
      deviceId,
      nickname,
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
}

module.exports = { GameApi };
