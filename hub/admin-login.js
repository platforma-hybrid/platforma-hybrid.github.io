const SESSION_KEY = "hub.admin-session.v1";
export const ADMIN_LOGIN_PARAM = "admin-login";

const REQUEST_ID = /^[A-Za-z0-9_-]{32}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

function readSession() {
  try {
    const session = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? "null");
    return session && typeof session.origin === "string" && SECRET.test(session.secret) ? session : null;
  } catch {
    return null;
  }
}

function clearSecret() {
  try { window.sessionStorage.removeItem(SESSION_KEY); } catch { /* сеанс в этом браузере недоступен */ }
}

async function apiOrigin(local) {
  if (local) return window.location.origin;
  try {
    const response = await fetch("/hub/admin-login.json", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) return "";
    const config = await response.json();
    const url = new URL(config.apiOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.origin;
  } catch {
    return "";
  }
}

async function request(origin, action, { method = "GET", secret, body } = {}) {
  const response = await fetch(`${origin}/api/hub-admin/${action}`, {
    method,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) return null;
  const result = await response.json();
  return result.success ? result.data : null;
}

export async function readAdminAccess(local, showLogin) {
  const saved = readSession();
  if (!saved && !showLogin) return { origin: "", secret: "", authenticated: false };
  const origin = await apiOrigin(local);
  if (saved && origin && origin === saved.origin) {
    try {
      const session = await request(origin, "session", { secret: saved.secret });
      if (session?.authenticated === true) {
        return { origin, secret: saved.secret, authenticated: true, expiresAt: session.expiresAt };
      }
    } catch { /* без ответа сервера панель не открывается */ }
  }
  if (saved) clearSecret();
  return { origin, secret: "", authenticated: false };
}

function hubUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete(ADMIN_LOGIN_PARAM);
  url.searchParams.delete("edit");
  if (["localhost", "127.0.0.1"].includes(url.hostname)) url.searchParams.set("admin", "0");
  return url;
}

export function watchAdminSession(access) {
  const returnToHub = () => {
    clearSecret();
    window.location.replace(hubUrl());
  };
  const expiresAt = Number(access.expiresAt);
  if (Number.isFinite(expiresAt)) window.setTimeout(returnToHub, Math.max(0, expiresAt - Date.now()));
  return async () => {
    try { await request(access.origin, "session", { method: "DELETE", secret: access.secret }); }
    catch { /* локальный выход доступен и без сети */ }
    finally { returnToHub(); }
  };
}

export function openAdminLogin(ctx, origin) {
  const text = ctx.texts.adminLogin;
  const dialog = document.createElement("dialog");
  dialog.className = "hub-admin-entry";
  dialog.setAttribute("aria-labelledby", "hub-admin-title");
  const heading = document.createElement("h2");
  heading.id = "hub-admin-title";
  heading.tabIndex = -1;
  heading.textContent = text.title;
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "hub-admin-close";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", ctx.texts.close);
  dismiss.addEventListener("click", () => dialog.close());
  const root = document.createElement("div");
  root.className = "hub-admin-login";
  const prompt = document.createElement("p");
  prompt.textContent = text.prompt;
  const launch = document.createElement("a");
  launch.className = "hub-admin-confirm";
  launch.textContent = text.confirm;
  launch.target = "_blank";
  launch.rel = "noopener noreferrer";
  const note = document.createElement("small");
  note.textContent = text.saved;
  const code = document.createElement("strong");
  code.className = "hub-admin-code";
  code.hidden = true;
  const status = document.createElement("p");
  status.className = "hub-admin-status";
  status.setAttribute("role", "status");
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "hub-admin-confirm";
  retry.textContent = text.retry;
  retry.hidden = true;
  root.append(prompt, launch, note, code, status, retry);

  let active = true;
  let pending = null;
  let waiting = false;
  const close = () => {
    active = false;
    window.history.replaceState(null, "", hubUrl());
    dialog.remove();
  };
  const fail = (message) => {
    pending = null;
    waiting = false;
    launch.removeAttribute("href");
    code.hidden = true;
    status.textContent = message;
    retry.hidden = !origin;
  };

  async function prepare() {
    retry.hidden = true;
    status.textContent = text.preparing;
    try {
      pending = await request(origin, "request", { method: "POST" });
      if (!active || !root.isConnected) return;
      if (!pending || !REQUEST_ID.test(pending.id) || !SECRET.test(pending.secret) || !/^\d{6}$/.test(pending.code)) {
        fail(text.unavailable);
        return;
      }
      launch.href = `https://t.me/HybridEcho_bot?start=hub_admin_${pending.id}`;
      status.textContent = "";
    } catch {
      fail(text.unavailable);
    }
  }

  async function poll() {
    if (!active || !root.isConnected || !pending) return;
    if (Date.now() >= pending.expiresAt) {
      fail(text.expired);
      return;
    }
    try {
      const session = await request(origin, "claim", { method: "POST", secret: pending.secret, body: { id: pending.id } });
      if (!active || !root.isConnected) return;
      if (!session) {
        fail(text.expired);
        return;
      }
      if (session.authenticated === true) {
        try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ origin, secret: pending.secret })); }
        catch { fail(text.storageUnavailable); return; }
        window.location.replace(hubUrl());
        return;
      }
    } catch {
      status.textContent = text.reconnecting;
    }
    window.setTimeout(poll, 2500);
  }

  launch.addEventListener("click", (event) => {
    if (!pending || !launch.hasAttribute("href")) {
      event.preventDefault();
      return;
    }
    code.textContent = text.code.replace("{code}", pending.code);
    code.hidden = false;
    status.textContent = text.waiting;
    if (!waiting) {
      waiting = true;
      void poll();
    }
  });
  retry.addEventListener("click", () => void prepare());
  dialog.append(dismiss, heading, root);
  document.body.append(dialog);
  dialog.addEventListener("close", close, { once: true });
  dialog.showModal();
  heading.focus();
  if (origin) void prepare();
  else fail(text.unavailable);
}
