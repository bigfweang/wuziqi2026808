(() => {
  const canvas = document.getElementById("game-canvas");
  const touchEndHandlers = [];
  const showHandlers = [];
  const hideHandlers = [];
  let shareHandler = null;

  function viewport() {
    return {
      windowWidth: Math.min(390, window.innerWidth),
      windowHeight: window.innerHeight,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
    };
  }

  canvas.addEventListener("pointerup", (event) => {
    const rect = canvas.getBoundingClientRect();
    const info = viewport();
    const x = (event.clientX - rect.left) * (info.windowWidth / rect.width);
    const y = (event.clientY - rect.top) * (info.windowHeight / rect.height);
    const payload = { changedTouches: [{ clientX: x, clientY: y, x, y }] };
    touchEndHandlers.forEach((handler) => handler(payload));
  });

  window.addEventListener("focus", () => showHandlers.forEach((handler) => handler({})));
  window.addEventListener("blur", () => hideHandlers.forEach((handler) => handler({})));

  window.wx = {
    __isPreview: true,
    createCanvas: () => canvas,
    getSystemInfoSync: viewport,
    getWindowInfo: viewport,
    getLaunchOptionsSync() {
      return { query: Object.fromEntries(new URLSearchParams(location.search)) };
    },
    getStorageSync(key) { return localStorage.getItem(key) || ""; },
    setStorageSync(key, value) { localStorage.setItem(key, String(value)); },
    removeStorageSync(key) { localStorage.removeItem(key); },
    onTouchEnd(handler) { touchEndHandlers.push(handler); },
    onShow(handler) { showHandlers.push(handler); },
    onHide(handler) { hideHandlers.push(handler); },
    showShareMenu() {},
    onShareAppMessage(handler) { shareHandler = handler; },
    shareAppMessage(payload) {
      const share = payload || (shareHandler && shareHandler()) || {};
      const url = new URL(location.href);
      url.search = share.query || "";
      const text = `${share.title || "像素五子棋"}\n${url}`;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
      const notice = document.getElementById("dev-notice");
      notice.textContent = `开发预览：邀请链接已复制｜${url.searchParams.get("room") || ""}`;
    },
    showModal(options) {
      const content = window.prompt(options.placeholderText || options.title || "请输入", options.content || "");
      if (options.success) options.success({ confirm: content !== null, cancel: content === null, content: content || "" });
    },
    request(options) {
      const init = { method: options.method || "GET", headers: options.header || {} };
      if (options.data !== undefined && init.method !== "GET") init.body = JSON.stringify(options.data);
      fetch(options.url, init)
        .then(async (response) => {
          let data;
          try { data = await response.json(); } catch { data = { error: "服务返回格式错误" }; }
          options.success && options.success({ statusCode: response.status, data });
        })
        .catch((error) => options.fail && options.fail({ errMsg: error.message }));
    },
  };

  window.__PIXEL_GOMOKU_API_BASE__ = location.origin;
})();
