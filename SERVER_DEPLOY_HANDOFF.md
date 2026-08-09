# Server Hermes deployment handoff

## Goal

Deploy the standalone web game from GitHub branch `feature/web-game` to the existing service behind `https://game.lmbostudio.cn`, preserving all current SQLite data and the existing Caddy TLS setup. The release must contain commit `7bf475d` or a later descendant; older web candidates do not contain the final state-machine fixes.

## Non-negotiable guardrails

- Inspect the current deployment, service manager, Docker state, Caddy configuration, ports, and data mounts before changing anything. Do not guess paths.
- Never run `docker compose down -v`, remove the data volume, delete the SQLite directory, or use destructive Docker prune commands.
- Back up the current SQLite data and relevant deployment/Caddy configuration before deployment, then verify the backups are readable.
- Do not put an AppSecret in Git, source files, shell history, logs, or chat. A replacement AppSecret, once reset by the owner, belongs only in a server-side environment/secret store with restricted permissions.
- Do not rewrite Git history or force-push.
- If the working tree on the server contains uncommitted changes, preserve it and deploy from a separate release checkout rather than overwriting it.
- Keep the application port bound to loopback (`127.0.0.1:3000`). Caddy is the only public ingress and supplies the client IP used by room rate limits.

## Discovery and backup

1. Identify the current repository/release directory and current commit.
2. Identify whether the live service uses Docker Compose, a named Docker volume, systemd, PM2, or another mechanism.
3. Record the current Caddy upstream for `game.lmbostudio.cn` and keep it unchanged unless a port change is proven necessary.
4. Locate the active SQLite data mount and make a timestamped backup without stopping or deleting the source. Use a SQLite-safe backup method or stop the application briefly if required for consistency.
5. Record a rollback target: previous image/tag/commit plus the unchanged data volume.

## Candidate verification

1. Fetch `origin/feature/web-game` and deploy its current remote HEAD from a clean release checkout. Verify `git merge-base --is-ancestor 7bf475d HEAD` succeeds before building.
2. Confirm Node.js 24 when building outside Docker.
3. Run:
   - `npm ci`
   - `npm run build`
   - `npx -y node@24 scripts/web-auth-flow-test.mjs`
   - `npx -y node@24 --test minigame/test/*.test.js`
   - `npx -y node@24 scripts/gameserver-broker-test.mjs`
   - `npx -y node@24 scripts/smoke-test.mjs`
   - `npx -y node@24 scripts/profile-flow-test.mjs`
   - `npm audit --omit=dev`
4. Stop if any command fails; do not switch live traffic.

## Deployment

The repository Dockerfile already copies `.next/standalone`, `.next/static`, and `public/`. Prefer the existing deployment mechanism. For Docker Compose, update in place with the existing volume:

```bash
ALLOW_DEV_AUTH=0 docker compose up -d --build
```

If Docker requires `sudo`, preserve the production authentication flag with `sudo env` (plain `sudo` may filter it):

```bash
sudo env ALLOW_DEV_AUTH=0 docker compose up -d --build
```

`ALLOW_DEV_AUTH` must be `0` in production. Browser users register with a local account and password; password hashes use asynchronous `scrypt`, and the browser session is an HttpOnly/Secure/SameSite=Lax cookie. Do not expose any WeChat AppSecret to the container.

Production scope for this release is the standalone web game, including opening the HTTPS invitation inside WeChat. The legacy native Mini Game client still calls the disabled `mode=dev` path and therefore is not production-authenticated when `ALLOW_DEV_AUTH=0`; do not claim that native client as live until real WeChat login is implemented.

Do not use `docker compose down -v`.

## Post-deployment checks

1. Wait for the service/container health check to become healthy.
2. Verify externally:
   - `https://game.lmbostudio.cn/`
   - `https://game.lmbostudio.cn/api/health`
3. Verify the home page title is `像素五子棋｜独立在线对战` and shows the login/register entry when no cookie is present.
4. Verify the health response is `{"ok":true,"service":"pixel-gomoku"}`.
5. Verify unauthenticated `GET /api/me` and room creation return `401`, while `POST /api/auth/session` with `mode=dev` returns `403`.
6. Through the HTTPS UI, verify: register → refresh remains logged in → create a password room → copy invitation → open the URL in another browser/WeChat → register or log in → enter password → join. Also verify resign requires confirmation, dismissing a result still leaves a visible `再来一局` action, and a full-board draw can be reset.
7. Verify existing rooms and matches are still present, `PRAGMA user_version` is `3`, and `PRAGMA integrity_check` is `ok`.
8. Verify Caddy still serves a valid certificate and proxies to the intended local upstream.
9. Report the deployed commit, deployment mechanism, data backup path, live health result, and rollback target. Never include account passwords or secret values in the report.

## Rollback

If health, profile flow, room persistence, or Caddy routing fails, restore the previous release/image while keeping the same data volume. Re-run external health and home-page checks after rollback.
