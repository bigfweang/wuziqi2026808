const { inviteQuery, normalizeRoomCode } = require("./core");

function createPlatform(wxApi) {
  if (!wxApi) throw new Error("微信小游戏运行时不可用");
  const isPreview = Boolean(wxApi.__isPreview);

  function systemInfo() {
    const legacy = typeof wxApi.getSystemInfoSync === "function" ? wxApi.getSystemInfoSync() : {};
    const windowInfo = typeof wxApi.getWindowInfo === "function" ? wxApi.getWindowInfo() : legacy;
    return {
      width: Number(windowInfo.windowWidth || legacy.windowWidth || 390),
      height: Number(windowInfo.windowHeight || legacy.windowHeight || 844),
      pixelRatio: Math.max(1, Math.min(3, Number(legacy.pixelRatio || 1))),
      safeArea: windowInfo.safeArea || legacy.safeArea || null,
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
          else reject(new Error(body.error || `请求失败（${response.statusCode}）`));
        },
        fail(error) {
          reject(new Error(error && error.errMsg ? error.errMsg : "网络连接失败"));
        },
      });
    });
  }

  function getStorage(key) {
    try { return wxApi.getStorageSync(key); } catch { return ""; }
  }

  function setStorage(key, value) {
    try { wxApi.setStorageSync(key, value); } catch {}
  }

  function removeStorage(key) {
    try { wxApi.removeStorageSync(key); } catch {}
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
        title: "加入好友棋局",
        content: "",
        editable: true,
        placeholderText: "输入 6 位房间码",
        confirmText: "加入",
        success(result) {
          resolve(result.confirm ? normalizeRoomCode(result.content) : "");
        },
        fail() { resolve(""); },
      });
    });
  }

  function promptRoomPassword(title, confirmText) {
    return new Promise((resolve) => {
      wxApi.showModal({
        title,
        content: "",
        editable: true,
        placeholderText: "可选：4–16 位密码；无密码可留空",
        confirmText,
        success(result) {
          resolve(result.confirm ? String(result.content || "").trim() : null);
        },
        fail() { resolve(null); },
      });
    });
  }

  async function promptCreateRoom() {
    const password = await promptRoomPassword("创建好友棋局", "创建");
    return password === null ? null : { password };
  }

  async function promptJoinRoom(prefilledRoomCode = "") {
    const roomCode = normalizeRoomCode(prefilledRoomCode) || await promptRoomCode();
    if (!roomCode) return null;
    const password = await promptRoomPassword(`加入房间 ${roomCode}`, "加入");
    return password === null ? null : { roomCode, password };
  }

  function sharePayload(roomId) {
    return roomId ? {
      title: `来和我下一盘像素五子棋｜房间 ${roomId}`,
      query: inviteQuery(roomId),
    } : { title: "像素五子棋｜落子无声，友情有回声" };
  }

  function shareRoom(roomId) {
    const payload = sharePayload(roomId);
    if (typeof wxApi.shareAppMessage === "function") wxApi.shareAppMessage(payload);
    return payload;
  }

  function configureShare(getRoomId) {
    if (typeof wxApi.showShareMenu === "function") {
      wxApi.showShareMenu({ menus: ["shareAppMessage"], withShareTicket: true });
    }
    if (typeof wxApi.onShareAppMessage === "function") {
      wxApi.onShareAppMessage(() => sharePayload(getRoomId()));
    }
  }


  function launchQuery() {
    try {
      return (wxApi.getLaunchOptionsSync && wxApi.getLaunchOptionsSync().query) || {};
    } catch {
      return {};
    }
  }

  function createImage(canvas, source) {
    const image = canvas && typeof canvas.createImage === "function"
      ? canvas.createImage()
      : typeof Image !== "undefined" ? new Image() : null;
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
    promptCreateRoom,
    promptJoinRoom,
    shareRoom,
    configureShare,
    launchQuery,
    onShow: (callback) => wxApi.onShow && wxApi.onShow(callback),
    onHide: (callback) => wxApi.onHide && wxApi.onHide(callback),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
  };
}

module.exports = { createPlatform };
