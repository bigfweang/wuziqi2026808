# 像素五子棋｜自托管版

这是之前那套像素风五子棋的服务器部署版，保留了：

- 15×15 像素棋盘与手机端界面
- 本机双人对局
- 创建联机房间与六位房间码
- 分享邀请链接、双方自动同步落子
- 悔一步、提示、认输、再来一局
- SQLite 本地持久化，重启服务器不会丢失房间数据

## 微信小游戏开发版（无需 AppID）

仓库现在同时包含 `minigame/` 原生 Canvas 小游戏客户端。账号未准备好时，可以先运行完整开发预览：

```bash
npm ci
npm run dev
```

打开：

```text
http://127.0.0.1:3000/minigame-preview/index.html
```

开发版已经具备稳定随机头像、模拟微信昵称、用户统计、日期历史、双方在线状态、分享房间参数和退出续局。浏览器预览连接真实 SQLite API，不是静态视觉稿；无痕窗口可模拟第二位用户。

微信小游戏源码、导入方式和账号接入清单见 [`minigame/README.md`](minigame/README.md)。正式 AppID、`wx.login`、真机分享和 HTTPS 合法域名在账号提供后接入；AppSecret 不进入客户端或 Git。

## 最快部署：Docker

服务器需要安装 Docker 与 Docker Compose。解压后进入项目目录：

```bash
docker compose up -d --build
```

浏览器打开：

```text
http://你的服务器IP:3000
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f pixel-gomoku
```

停止服务：

```bash
docker compose down
```

重新构建升级：

```bash
docker compose up -d --build
```

棋局数据保存在 Docker 卷 `gomoku-data` 中。普通的 `docker compose down` 不会删除它；不要执行 `docker compose down -v`，除非你确定要连数据一起清空。

## 修改端口

默认使用服务器的 3000 端口：

```bash
PORT=8080 docker compose up -d --build
```

此时通过 `http://服务器IP:8080` 访问。

## 绑定域名与 HTTPS

建议用 Nginx 或宝塔反向代理到 `127.0.0.1:3000`，并申请 HTTPS 证书。Nginx 核心配置示例：

```nginx
server {
    listen 80;
    server_name gomoku.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

微信内分享建议使用 HTTPS 域名。根页面仍是网页版本；`minigame/` 是新增的原生微信小游戏客户端。

## 不使用 Docker

要求 Node.js 24：

```bash
npm ci
npm run build
DATA_DIR=./data npm start
```

## 服务器建议

- Linux x86_64 或 ARM64
- 1 核 CPU、1 GB 内存即可轻量运行
- 对外开放所选端口，或只开放 80/443 并使用反向代理

## 健康检查

部署后访问：

```text
/api/health
```

正常会返回：

```json
{"ok":true,"service":"pixel-gomoku"}
```
