# Server Hermes deployment handoff

## Goal

Deploy the GitHub branch `feature/wechat-minigame-prototype` to the existing service behind `https://game.lmbostudio.cn`, preserving all current SQLite data and the existing Caddy TLS setup.

## Non-negotiable guardrails

- Inspect the current deployment, service manager, Docker state, Caddy configuration, ports, and data mounts before changing anything. Do not guess paths.
- Never run `docker compose down -v`, remove the data volume, delete the SQLite directory, or use destructive Docker prune commands.
- Back up the current SQLite data and relevant deployment/Caddy configuration before deployment, then verify the backups are readable.
- Do not put an AppSecret in Git, source files, shell history, logs, or chat. A replacement AppSecret, once reset by the owner, belongs only in a server-side environment/secret store with restricted permissions.
- Do not rewrite Git history or force-push.
- If the working tree on the server contains uncommitted changes, preserve it and deploy from a separate release checkout rather than overwriting it.

## Discovery and backup

1. Identify the current repository/release directory and current commit.
2. Identify whether the live service uses Docker Compose, a named Docker volume, systemd, PM2, or another mechanism.
3. Record the current Caddy upstream for `game.lmbostudio.cn` and keep it unchanged unless a port change is proven necessary.
4. Locate the active SQLite data mount and make a timestamped backup without stopping or deleting the source. Use a SQLite-safe backup method or stop the application briefly if required for consistency.
5. Record a rollback target: previous image/tag/commit plus the unchanged data volume.

## Candidate verification

1. Fetch `origin/feature/wechat-minigame-prototype` and deploy its current remote HEAD from a clean release checkout.
2. Confirm Node.js 24 when building outside Docker.
3. Run:
   - `npm ci`
   - `npm run build`
   - `npx -y node@24 --test minigame/test/*.test.js`
   - `npx -y node@24 scripts/smoke-test.mjs`
   - `npx -y node@24 scripts/profile-flow-test.mjs`
   - `npm audit --omit=dev`
4. Stop if any command fails; do not switch live traffic.

## Deployment

The repository Dockerfile already copies `.next/standalone`, `.next/static`, and `public/`. Prefer the existing deployment mechanism. For Docker Compose, update in place with the existing volume:

```bash
ALLOW_DEV_AUTH=1 docker compose up -d --build
```

`ALLOW_DEV_AUTH=1` is a temporary test-only setting because formal `wx.login` is not implemented yet. It must remain explicit and must be disabled after formal WeChat login is connected. Do not expose any AppSecret to the container until the formal server-side login implementation exists.

Do not use `docker compose down -v`.

## Post-deployment checks

1. Wait for the service/container health check to become healthy.
2. Verify externally:
   - `https://game.lmbostudio.cn/`
   - `https://game.lmbostudio.cn/api/health`
   - `https://game.lmbostudio.cn/minigame-preview/index.html`
3. Verify the health response is `{"ok":true,"service":"pixel-gomoku"}`.
4. Verify existing data is still present and a new development profile/room flow works.
5. Verify Caddy still serves a valid certificate and proxies to the intended local upstream.
6. Report the deployed commit, deployment mechanism, data backup path, live health result, and rollback target. Never include secret values in the report.

## Rollback

If health, profile flow, room persistence, or Caddy routing fails, restore the previous release/image while keeping the same data volume. Re-run external health and home-page checks after rollback.
