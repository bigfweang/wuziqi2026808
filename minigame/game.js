const { createPlatform } = require("./src/platform");
const { PixelGomokuApp } = require("./src/app");
const config = require("./src/config");

const platform = createPlatform(typeof wx === "undefined" ? null : wx);
const app = new PixelGomokuApp({ platform, config });

app.start();

if (typeof GameGlobal !== "undefined") GameGlobal.pixelGomokuApp = app;
if (typeof globalThis !== "undefined") globalThis.pixelGomokuApp = app;
