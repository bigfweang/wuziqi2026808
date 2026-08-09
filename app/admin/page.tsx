"use client";

import { useEffect, useState, type FormEvent } from "react";

const AVATARS = [
  "01-face-short-hair.png",
  "02-face-bob.png",
  "03-face-curly.png",
  "04-face-glasses.png",
  "05-face-bangs.png",
  "06-face-spiky.png",
  "07-face-beard.png",
  "08-face-bun.png",
  "09-face-mustache.png",
];

const PAGE_SIZE = 30;

type AdminStats = {
  totalUsers: number;
  registeredUsers: number;
  devUsers: number;
  newUsers24h: number;
  onlineUsers: number;
  totalMatches: number;
  activeRooms: number;
};

type UserStats = { wins: number; losses: number; draws: number; total: number };

type AdminUser = {
  id: string;
  account: string | null;
  provider: string;
  nickname: string;
  avatarId: number;
  passwordSet: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  online: boolean;
  stats: UserStats;
};

type UserListPayload = {
  users: AdminUser[];
  total: number;
  limit: number;
  offset: number;
};

class AdminApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function adminRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: { error?: string } & Partial<T> = {};
  try { data = text ? JSON.parse(text) as typeof data : {}; } catch {}
  if (!response.ok) throw new AdminApiError(data.error || "后台请求失败", response.status);
  return data as T;
}

function avatarUrl(avatarId: number) {
  const index = Math.max(1, Math.min(9, avatarId)) - 1;
  return `/avatars/pixel-64/${AVATARS[index]}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [initializing, setInitializing] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editAvatarId, setEditAvatarId] = useState(1);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadDashboard(queryValue = activeQuery, offsetValue = offset) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        query: queryValue,
        limit: String(PAGE_SIZE),
        offset: String(offsetValue),
      });
      const [statsPayload, usersPayload] = await Promise.all([
        adminRequest<{ stats: AdminStats }>("/api/admin/stats"),
        adminRequest<UserListPayload>(`/api/admin/users?${params}`),
      ]);
      setStats(statsPayload.stats);
      setUsers(usersPayload.users);
      setTotal(usersPayload.total);
      setOffset(usersPayload.offset);
      setActiveQuery(queryValue);
    } catch (caught) {
      if (caught instanceof AdminApiError && caught.status === 401) {
        setAuthenticated(false);
        setStats(null);
        setUsers([]);
      } else {
        setError(caught instanceof Error ? caught.message : "后台数据加载失败");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void adminRequest<{ authenticated: boolean; configured: boolean }>("/api/admin/session")
      .then((payload) => {
        if (cancelled) return;
        setConfigured(payload.configured);
        setAuthenticated(payload.authenticated);
      })
      .catch((caught) => {
        if (cancelled) return;
        if (caught instanceof AdminApiError && caught.status === 503) setConfigured(false);
        else if (!(caught instanceof AdminApiError && caught.status === 401)) {
          setError(caught instanceof Error ? caught.message : "无法连接管理后台");
        }
      })
      .finally(() => { if (!cancelled) setInitializing(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authenticated) void loadDashboard("", 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await adminRequest("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      setAdminPassword("");
      setAuthenticated(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    setSubmitting(true);
    setError("");
    try {
      await adminRequest("/api/admin/session", { method: "DELETE" });
      setAuthenticated(false);
      setStats(null);
      setUsers([]);
      setSelectedUser(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void loadDashboard(query.trim(), 0);
  }

  function openEditor(user: AdminUser) {
    setSelectedUser(user);
    setEditNickname(user.nickname);
    setEditAvatarId(user.avatarId);
    setNewPassword("");
    setError("");
    setNotice("");
  }

  function replaceUser(updated: AdminUser) {
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
    setSelectedUser(updated);
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const payload = await adminRequest<{ user: AdminUser }>("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "profile",
          userId: selectedUser.id,
          nickname: editNickname,
          avatarId: editAvatarId,
        }),
      });
      replaceUser(payload.user);
      setNotice("名字和头像已更新");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "资料修改失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault();
    if (!selectedUser) return;
    if (!window.confirm(`确认重置“${selectedUser.nickname}”的密码？该用户现有登录会话会立即退出。`)) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const payload = await adminRequest<{ user: AdminUser }>("/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "password", userId: selectedUser.id, password: newPassword }),
      });
      replaceUser(payload.user);
      setNewPassword("");
      setNotice("密码已重置，用户的旧会话已退出");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "密码重置失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (initializing) {
    return <main className="admin-shell"><div className="admin-state-card">正在连接管理后台…</div></main>;
  }

  if (!configured) {
    return <main className="admin-shell"><div className="admin-state-card admin-state-card--wide"><span className="admin-kicker">ADMIN DISABLED</span><h1>管理后台尚未启用</h1><p>请在服务器环境中设置至少 16 个字符的 <code>ADMIN_PASSWORD</code>，然后重新构建并启动服务。密码只保存在服务器环境变量中，不要写入仓库。</p><a href="/">返回游戏</a></div></main>;
  }

  if (!authenticated) {
    return <main className="admin-shell admin-shell--login"><section className="admin-login-card"><div className="admin-mark">管</div><span className="admin-kicker">PIXEL GOMOKU</span><h1>管理后台</h1><p>用户数据与账号维护</p>{error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}<form onSubmit={login}><label>管理员密码<input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} autoComplete="current-password" minLength={16} maxLength={256} required autoFocus /></label><button className="admin-primary" disabled={submitting}>{submitting ? "验证中…" : "进入后台"}</button></form><a className="admin-back-link" href="/">← 返回游戏</a></section></main>;
  }

  const statItems = stats ? [
    ["注册用户", stats.registeredUsers],
    ["全部身份", stats.totalUsers],
    ["24h 新增", stats.newUsers24h],
    ["当前在线", stats.onlineUsers],
    ["完成对局", stats.totalMatches],
    ["进行中房间", stats.activeRooms],
  ] as const : [];

  return <main className="admin-shell"><div className="admin-container"><header className="admin-topbar"><div><span className="admin-kicker">PIXEL GOMOKU / ADMIN</span><h1>用户管理</h1></div><div className="admin-top-actions"><a href="/">打开游戏</a><button onClick={logout} disabled={submitting}>退出后台</button></div></header>
    {error && <div className="admin-alert admin-alert--error" role="alert">{error}</div>}
    {notice && <div className="admin-alert admin-alert--success" role="status">{notice}</div>}
    <section className="admin-stat-grid" aria-label="用户统计">{statItems.map(([label, value]) => <article className="admin-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className="admin-panel"><div className="admin-panel-head"><div><span className="admin-kicker">USER DATA</span><h2>用户列表</h2><p>共 {total} 位，密码只显示设置状态，不能查看原文。</p></div><button className="admin-secondary" onClick={() => void loadDashboard()} disabled={loading}>{loading ? "刷新中…" : "刷新数据"}</button></div>
      <form className="admin-search" onSubmit={search}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号或名字" maxLength={64} aria-label="搜索账号或名字" /><button className="admin-primary" disabled={loading}>搜索</button></form>
      <div className="admin-user-head" aria-hidden="true"><span>用户</span><span>账号</span><span>状态</span><span>战绩</span><span>操作</span></div>
      <div className="admin-user-list">{users.map((user) => <article className="admin-user-row" key={user.id}><div className="admin-user-main"><img src={avatarUrl(user.avatarId)} alt="" /><div><strong>{user.nickname}</strong><small>注册于 {formatDate(user.createdAt)}</small></div></div><div className="admin-account"><span>{user.account || "开发身份"}</span><small>{user.provider === "local" ? "本地账号" : user.provider}</small></div><div className="admin-status"><span className={user.online ? "online" : "offline"}>{user.online ? "在线" : "离线"}</span><small>{user.passwordSet ? "密码已设置" : "无登录密码"}</small></div><div className="admin-record"><strong>{user.stats.wins}胜 {user.stats.losses}负</strong><small>{user.stats.draws}和 / {user.stats.total}局</small></div><button className="admin-secondary" onClick={() => openEditor(user)}>管理</button></article>)}</div>
      {!loading && users.length === 0 && <div className="admin-empty">没有找到符合条件的用户</div>}
      <div className="admin-pagination"><span>{total ? `${offset + 1}–${Math.min(offset + users.length, total)} / ${total}` : "0 / 0"}</span><div><button onClick={() => void loadDashboard(activeQuery, Math.max(0, offset - PAGE_SIZE))} disabled={loading || offset === 0}>上一页</button><button onClick={() => void loadDashboard(activeQuery, offset + PAGE_SIZE)} disabled={loading || offset + users.length >= total}>下一页</button></div></div>
    </section>
  </div>
  {selectedUser && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedUser(null); }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-edit-title"><header><div><span className="admin-kicker">EDIT USER</span><h2 id="admin-edit-title">管理 {selectedUser.nickname}</h2></div><button className="admin-close" onClick={() => setSelectedUser(null)} aria-label="关闭">×</button></header><div className="admin-user-summary"><img src={avatarUrl(editAvatarId)} alt="" /><div><strong>{selectedUser.account || "开发身份"}</strong><small>ID：{selectedUser.id}</small></div></div>
    <form className="admin-edit-form" onSubmit={saveProfile}><h3>资料</h3><label>名字<input value={editNickname} onChange={(event) => setEditNickname(event.target.value)} maxLength={16} required /></label><fieldset><legend>头像</legend><div className="admin-avatar-grid">{AVATARS.map((file, index) => <button type="button" key={file} className={editAvatarId === index + 1 ? "selected" : ""} onClick={() => setEditAvatarId(index + 1)} aria-label={`选择头像 ${index + 1}`}><img src={`/avatars/pixel-64/${file}`} alt="" /></button>)}</div></fieldset><button className="admin-primary" disabled={submitting}>{submitting ? "保存中…" : "保存资料"}</button></form>
    <form className="admin-edit-form admin-password-form" onSubmit={resetPassword}><h3>重置密码</h3><p>原密码经过 scrypt 哈希，后台无法查看。设置新密码后，该用户所有旧会话会立即退出。</p>{selectedUser.provider === "local" ? <><label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={64} autoComplete="new-password" required /></label><button className="admin-danger" disabled={submitting}>{submitting ? "处理中…" : "重置密码"}</button></> : <div className="admin-inline-note">开发身份没有网页登录密码。</div>}</form>
    {(error || notice) && <div className={`admin-alert ${error ? "admin-alert--error" : "admin-alert--success"}`}>{error || notice}</div>}
  </section></div>}
  </main>;
}
