const { createPlatform } = require("./src/platform");
const { PixelGomokuApp } = require("./src/app");
const { GameServerBridge } = require("./src/gameserver-bridge");
const config = require("./src/config");

const platform = createPlatform(typeof wx === "undefined" ? null : wx);
let app = null;
const gameServer = config.GAMESERVER_BRIDGE && typeof wx !== "undefined"
  ? new GameServerBridge({
    wxApi: wx,
    platform,
    onStatus: (event, detail) => app && app.gameServerStatus(event, detail),
  })
  : null;
app = new PixelGomokuApp({ platform, config, gameServer });

app.start();

if (typeof GameGlobal !== "undefined") GameGlobal.pixelGomokuApp = app;
if (typeof globalThis !== "undefined") globalThis.pixelGomokuApp = app;
