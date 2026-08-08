import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "public/minigame-preview/bundle.js");
await mkdir(dirname(outfile), { recursive: true });
await build({
  entryPoints: [resolve(root, "minigame/game.js")],
  outfile,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: ["chrome90"],
  sourcemap: true,
  logLevel: "info",
});
