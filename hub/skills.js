// Окно «Навыки» v0.1 (16.10.2026). Решения автора — claude/DECISIONS_OCT.md (16.10).
// Слева — список навыков по направлениям (с прокруткой), справа — круг равновесия:
// шесть направлений тремя парами противовесов, внутри — «форма» игрока и точка-центр тяжести.
// Перекос считается по направлению целиком: ушёл далеко вперёд пары — направление тормозит, потом замирает.
// Мастерство — заглушка в браузере (gibrid.skills.v1) до сервера. Тексты — hub.texts.json → skills, правила — skills.json.

const STORE_KEY = "gibrid.skills.v1";
const CARE_KEY = "gibrid.care.v1"; // отметки заботы за сегодня: { "2026-10-16": { skillId: [номера пунктов] } }
const WARDS_KEY = "gibrid.wards.v1"; // подопечные навыков (растения, питомцы) — заглушка в браузере до сервера
const SVG_NS = "http://www.w3.org/2000/svg";
const ART_DIR = "/assets/hub/ui/skills/";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function sv(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
function fmt(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function place(node, box) {
  if (!box) return;
  for (const k of ["x", "y", "w", "h"]) if (box[k] !== undefined) node.style[{ x: "left", y: "top", w: "width", h: "height" }[k]] = `${box[k]}px`;
}
// центр тяжести многоугольника (по площади); вырожденная форма — среднее вершин
function centroidOf(pts) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const k = x1 * y2 - x2 * y1;
    a += k;
    cx += (x1 + x2) * k;
    cy += (y1 + y2) * k;
  }
  if (Math.abs(a) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}
function loadWards() {
  try {
    return JSON.parse(window.localStorage.getItem(WARDS_KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}
function saveWards(w) {
  try {
    window.localStorage.setItem(WARDS_KEY, JSON.stringify(w));
  } catch {
    /* браузер не дал записать — подопечные живут до закрытия окна */
  }
}
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function today() {
  return dayKey(new Date());
}
function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}
// сезон по месяцу (северное полушарие; позже — по региону игрока)
export function seasonOf(date = new Date()) {
  const m = date.getMonth();
  return m <= 1 || m === 11 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}
function everyOf(item, season) {
  const e = typeof item === "string" ? 1 : item.every ?? 1;
  return typeof e === "number" ? e : e[season] ?? 1;
}
// отметки заботы: { skillId: { номерПункта: ["2026-10-14", "2026-10-16", …] } } — последние даты
function loadCare() {
  try {
    const v = JSON.parse(window.localStorage.getItem(CARE_KEY) ?? "null");
    return v && v.v === 2 ? v.done : {};
  } catch {
    return {};
  }
}
function saveCare(done) {
  try {
    window.localStorage.setItem(CARE_KEY, JSON.stringify({ v: 2, done }));
  } catch {
    /* не записалось — отметки живут до закрытия окна */
  }
}
// план на сегодня: какие пункты нужны сегодня, какие сделаны, когда следующий
export function carePlan(items, done = {}, day = today(), season = seasonOf(new Date(`${day}T12:00:00`))) {
  return items.map((item, i) => {
    const dates = done[i] ?? [];
    const doneToday = dates.includes(day);
    const before = dates.filter((x) => x < day).sort().pop();
    const every = everyOf(item, season);
    const wait = before ? every - daysBetween(before, day) : 0;
    return { i, text: typeof item === "string" ? item : item.text, every, doneToday, due: doneToday || wait <= 0, wait };
  });
}
// день по навыку засчитывается только целиком: сделано всё, что нужно сегодня
export function careClosed(plan) {
  const due = plan.filter((p) => p.due);
  return due.length > 0 && due.every((p) => p.doneToday);
}
function loadMastery() {
  try {
    return JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}

// Расчёт равновесия: мастерство направлений, статусы, точка. Чистая функция — её проверяют тесты.
export function balanceOf(lib, mastery) {
  const R = lib.rules;
  const val = Object.fromEntries(lib.blocks.map((b) => [b.key, 0]));
  for (const s of lib.skills) val[s.block] += Math.max(0, Math.min(100, Number(mastery[s.id]) || 0));
  const total = Object.values(val).reduce((a, b) => a + b, 0);
  const newcomer = total < R.newcomer;
  const status = {};
  for (const b of lib.blocks) {
    const gap = val[b.key] - val[b.pair];
    if (newcomer) status[b.key] = { kind: "free", rate: 1, gap };
    else if (gap > R.freezeGap) status[b.key] = { kind: "frozen", rate: 0, gap };
    else if (gap > R.slowGap) status[b.key] = { kind: "slow", rate: R.slowRate, gap };
    else status[b.key] = { kind: "normal", rate: 1, gap };
  }
  if (!newcomer) {
    for (const b of lib.blocks) {
      const pairKind = status[b.pair].kind;
      if ((pairKind === "frozen" || pairKind === "slow") && status[b.key].kind === "normal") status[b.key] = { kind: "up", rate: R.catchUp, gap: status[b.key].gap };
    }
  }
  // точка — центр тяжести (доля радиуса 0..1)
  let x = 0;
  let y = 0;
  for (const b of lib.blocks) {
    const a = (b.angle * Math.PI) / 180;
    x += Math.cos(a) * val[b.key];
    y += Math.sin(a) * val[b.key];
  }
  const px = total ? (x / total) * 0.95 : 0;
  const py = total ? (y / total) * 0.95 : 0;
  const offset = Math.hypot(px, py);
  const balanced = total > 0 && offset <= R.balanceRing;
  return { val, total, newcomer, status, point: { x: px, y: py }, offset, balanced };
}

export function initSkills(ctx, getDailies) {
  const lib = ctx.skills;
  const t = ctx.texts.skills;
  const W = lib.window;
  const blockBy = Object.fromEntries(lib.blocks.map((b) => [b.key, b]));
  let returnFocus = null;

  const backdrop = el("div", "sk-backdrop");
  backdrop.hidden = true;
  const win = el("section", "sk-window");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-modal", "true");
  win.setAttribute("aria-labelledby", "sk-title");
  Object.assign(win.style, { left: `${W.x}px`, top: `${W.y}px`, width: `${W.w}px`, height: `${W.h}px`, transform: `scale(${W.scale ?? 1})` });
  backdrop.append(win);
  ctx.stage.append(backdrop);

  // живописный режим: фон от ChatGPT, живое — по нарисованным доскам и кругу (skills.json → art, layout)
  const L = lib.art?.bg ? lib.layout ?? {} : null;
  if (L) {
    win.classList.add("sk-art");
    const bg = el("img", "sk-bg");
    bg.src = ART_DIR + lib.art.bg;
    bg.alt = "";
    bg.draggable = false;
    win.append(bg);
  }

  const head = el("div", "sk-head");
  const title = el("h2", "sk-title", t.title);
  title.id = "sk-title";
  head.append(el("span", "sk-dia"), title, el("span", "sk-dia"));
  const close = el("button", "sk-close", "✕");
  close.type = "button";
  close.setAttribute("aria-label", ctx.texts.close);
  win.append(head, close);
  if (L) {
    place(head, L.title);
    if (L.close) Object.assign(close.style, { left: `${L.close.x}px`, top: `${L.close.y}px`, right: "auto" });
  }

  // слева — список
  const side = el("div", "sk-side");
  const sideHead = el("div", "sk-side-head");
  const sideCount = el("span", "sk-side-count");
  sideHead.append(el("h3", "", t.mine), sideCount);
  const list = el("div", "sk-list");
  side.append(sideHead, list);

  // справа — Интеллект, круг, строка состояния
  const intel = el("div", "sk-intel");
  const circleBox = el("div", "sk-circle");
  const state = el("div", "sk-state");
  const card = el("div", "sk-card");
  card.hidden = true;
  // рамка карточки (21.10): ромбы по углам — отдельным слоем, чтобы прокрутка карточки их не обрезала
  const cardFrame = el("div", "sk-card-wrap");
  cardFrame.hidden = true;
  const frameIn = el("div", "sk-card-frame");
  for (let i = 0; i < 4; i += 1) frameIn.append(el("i"));
  cardFrame.append(frameIn);
  win.append(side, intel, circleBox, card, cardFrame, state);
  let openId = null; // навык, чья карточка открыта
  const C = L?.circle;
  if (L) {
    place(side, L.side);
    place(intel, L.intel);
    place(state, L.state);
    place(card, L.card);
    place(cardFrame, L.card);
    Object.assign(circleBox.style, { left: `${C.cx - 310}px`, top: `${C.cy - 300}px` });
  }

  // Телефон лёжа (16.10): окно не ужимается вместе с большой картиной хаба, а раскладывается по экрану
  // настоящими пикселями — список слева, круг или карточка справа. Позиции «по нарисованному» — только на компьютере.
  const phoneMq = window.matchMedia("(orientation: landscape) and (max-height: 540px)");
  let phone = false;
  const placed = [win, head, close, side, intel, state, card, circleBox];
  const deskStyle = new Map(placed.map((node) => [node, node.getAttribute("style") ?? ""]));
  // 17.10: при живописном фоне телефон показывает ту же картину, что компьютер, целиком — вписанной в экран;
  // по краям — тот же грот, размытый. Раскладка «настоящими пикселями» остаётся только для окна без картины.
  let ppBg = null;
  function applyMode() {
    const small = phoneMq.matches;
    const pp = small && Boolean(L);
    phone = small && !L;
    win.classList.toggle("sk-phone", phone);
    win.classList.toggle("sk-pphone", pp);
    backdrop.classList.toggle("sk-phone-bd", phone);
    backdrop.classList.toggle("sk-pphone-bd", pp);
    (small ? document.body : ctx.stage).append(backdrop);
    for (const node of placed) node.setAttribute("style", phone ? "" : deskStyle.get(node));
    if (pp) {
      if (!ppBg) {
        ppBg = el("div", "sk-pp-bg");
        ppBg.style.backgroundImage = `url("${ART_DIR + lib.art.bg}")`;
      }
      backdrop.prepend(ppBg);
      const sc = Math.min(window.innerWidth / W.w, window.innerHeight / W.h);
      // маленький телефон: картина та же, но список, карточка и подсказка — крупнее (листаются внутри своих досок)
      win.classList.toggle("sk-pp-small", sc < 0.5);
      win.setAttribute("style", `left:50%;top:50%;width:${W.w}px;height:${W.h}px;margin:0;transform:translate(-50%, -50%) scale(${sc});transform-origin:50% 50%`);
    } else ppBg?.remove();
  }
  phoneMq.addEventListener("change", () => {
    applyMode();
    if (!backdrop.hidden) render();
  });
  window.addEventListener("resize", () => {
    if (phoneMq.matches && L) applyMode();
  });

  function mightOf() {
    const d = getDailies();
    return Object.values(d?.flasks ?? {}).reduce((sum, f) => sum + (f.level ?? 0), 0);
  }

  function renderList(mastery, bal) {
    const keepScroll = list.scrollTop;
    list.replaceChildren();
    const order = lib.listOrder ? lib.listOrder.map((k) => blockBy[k]).filter(Boolean) : lib.blocks;
    for (const b of order) {
      const st = bal.status[b.key];
      const grp = el("div", `sk-grp ${st.kind}`);
      grp.append(el("span", "", b.name), el("em", "", fmt(t.status[st.kind], { pair: blockBy[b.pair].acc ?? blockBy[b.pair].name })));
      const wrap = el("div", `sk-items ${st.kind}`);
      for (const s of lib.skills.filter((x) => x.block === b.key)) {
        const m = Math.max(0, Math.min(100, Number(mastery[s.id]) || 0));
        const row = el("div", `sk-row${m ? "" : " zero"}`);
        // пояснение навыка — в нижней табличке, пока навык под мышью или в фокусе
        if (s.desc) {
          row.tabIndex = 0;
          row.title = s.desc;
          const show = () => showSkill(s);
          const back = () => renderState(lastBal);
          row.addEventListener("mouseenter", show);
          row.addEventListener("focus", show);
          row.addEventListener("mouseleave", back);
          row.addEventListener("blur", back);
        }
        if (s.card) row.classList.add("has-card");
        if (s.id === openId) row.classList.add("open");
        row.addEventListener("click", () => openCard(s.id));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openCard(s.id);
          }
        });
        const bar = el("span", "sk-bar");
        const fill = el("i");
        fill.style.width = `${m}%`;
        bar.append(fill);
        const mid = el("div", "sk-mid");
        mid.append(el("span", "sk-name", s.name), bar);
        const ic = el("span", "sk-ic");
        if (L && s.art) {
          const img = el("img");
          img.src = ART_DIR + s.art;
          img.alt = "";
          ic.append(img);
        } else ic.textContent = s.icon ?? "◆";
        row.append(ic, mid, el("span", "sk-num", String(m)));
        wrap.append(row);
      }
      list.append(grp, wrap);
    }
    const started = lib.skills.filter((s) => (Number(mastery[s.id]) || 0) > 0).length;
    sideCount.textContent = fmt(t.count, { n: started, of: lib.skills.length });
    // список не прыгает наверх при каждом обновлении; открытый навык всегда виден
    list.scrollTop = keepScroll;
    const openRow = list.querySelector(".sk-row.open");
    if (openRow) {
      // вручную, а не scrollIntoView: тот двигает и саму сцену хаба
      const top = openRow.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      const k = list.getBoundingClientRect().height / list.clientHeight || 1;
      const y = top / k;
      if (y < list.scrollTop) list.scrollTop = y - 8;
      else if (y + openRow.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = y + openRow.offsetHeight - list.clientHeight + 8;
    }
  }

  function renderCircle(bal) {
    const CC = phone ? null : C;
    const painted = Boolean(L) && !phone;
    // на телефоне круг меньше, чтобы подписи стояли снаружи кольца и не обрезались
    const R = CC?.R ?? (phone ? 165 : 200);
    const svg = sv("svg", { viewBox: "-310 -300 620 600", width: 620, height: 600, class: "sk-svg", "aria-hidden": "true" });
    const P = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
    const angs = lib.blocks.map((b) => b.angle);
    // обод, паутина и гнёзда нарисованы на фоне — кодом только без картинки
    if (!painted) {
      svg.append(sv("circle", { r: R + 16, class: "sk-rim-bg" }), sv("circle", { r: R + 16, class: "sk-rim" }), sv("circle", { r: R + 5, class: "sk-rim-in" }));
      for (const r of [R / 3, (2 * R) / 3, R]) svg.append(sv("polygon", { points: angs.map((a) => P(a, r).join(",")).join(" "), class: "sk-web" }));
      for (const a of angs) {
        const [x, y] = P(a, R);
        svg.append(sv("line", { x1: 0, y1: 0, x2: x, y2: y, class: "sk-axis" }));
        const [nx, ny] = P(a, R + 16);
        svg.append(sv("circle", { cx: nx, cy: ny, r: 7, class: "sk-node" }));
      }
    }
    // форма игрока: самое сильное направление — на 85 % радиуса (шкала растёт вместе с игроком), минимум 20
    const top = Math.max(20, Math.max(...Object.values(bal.val)) / 0.85);
    if (bal.total > 0) {
      const pts = lib.blocks.map((b) => P(b.angle, (R * bal.val[b.key]) / top));
      svg.append(sv("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "sk-shape" }));
      for (const [x, y] of pts) svg.append(sv("circle", { cx: x, cy: y, r: 4, class: "sk-vert" }));
    }
    const ring = lib.rules.balanceRing * R;
    svg.append(sv("circle", { r: ring, class: "sk-core" }), sv("circle", { r: ring, class: "sk-core-line" }));
    if (!painted) {
      const label = sv("text", { x: 0, y: ring + 22, class: "sk-core-label", "text-anchor": "middle" });
      label.textContent = t.balance;
      svg.append(label);
    }
    // точка — центр тяжести самой формы: всегда внутри неё и тянется к перекосу
    let px = 0;
    let py = 0;
    if (bal.total > 0) [px, py] = centroidOf(lib.blocks.map((b) => P(b.angle, (R * bal.val[b.key]) / top)));
    if (!bal.balanced && bal.total > 0) svg.append(sv("line", { x1: 0, y1: 0, x2: px, y2: py, class: "sk-pull" }));
    const dot = sv("g", { class: `sk-dot${bal.balanced || bal.total === 0 ? " calm" : ""}` });
    dot.append(sv("circle", { cx: px, cy: py, r: 22, class: "sk-dot-glow" }), sv("circle", { cx: px, cy: py, r: 11, class: "sk-dot-core" }));
    const tip = sv("title");
    tip.textContent = t.dotTip;
    dot.append(tip);
    svg.append(dot);
    // знаки направлений в нарисованных гнёздах (22.10): тёмный медальон + знак; состояние — замерло / догоняет
    const SK = L?.sockets;
    if (painted && SK && lib.art?.dirIcons) {
      for (const b of lib.blocks) {
        const at = SK[b.key];
        const src = lib.art.dirIcons[b.key];
        if (!at || !src) continue;
        const x = at[0] - CC.cx;
        const y = at[1] - CC.cy;
        const st = bal.status[b.key].kind;
        const g = sv("g", { class: `sk-dir ${st}` });
        g.append(sv("circle", { cx: x, cy: y, r: SK.r + 3, class: "sk-dir-halo" }), sv("circle", { cx: x, cy: y, r: SK.r, class: "sk-dir-plate" }));
        g.append(sv("image", { href: ART_DIR + src, x: x - SK.icon / 2, y: y - SK.icon / 2, width: SK.icon, height: SK.icon, class: "sk-dir-ic" }));
        const tip = sv("title");
        tip.textContent = b.name;
        g.append(tip);
        svg.append(g);
      }
    }
    // подписи направлений со статусом
    for (const b of lib.blocks) {
      const vert = Math.abs(Math.cos((b.angle * Math.PI) / 180)) < 0.1;
      // верх и низ: знак в гнезде стоит прямо над подписью — подпись чуть внутрь (22.10)
      const [x, y] = P(b.angle, (CC?.label ?? R + (phone ? 34 : 44)) - (painted && SK && vert ? 30 : 0));
      const st = bal.status[b.key].kind;
      // в живописном круге боковые подписи прижаты внутрь, чтобы не лезть на обод
      // живописный круг: боковые подписи внутрь; круг кодом на телефоне — наружу, чтобы не ложились на кольцо
      const side = Math.abs(x) > 40 && (painted || phone) ? ((x > 0) === painted ? "end" : "start") : "middle";
      const ty = phone && Math.abs(x) <= 40 ? (y < 0 ? y - 6 : y + 24) : y + 8;
      const txt = sv("text", { x, y: ty, class: `sk-lab ${st}`, "text-anchor": side });
      txt.textContent = b.name + ({ frozen: " ⏸", slow: " ↓", up: " ↑" }[st] ?? "");
      svg.append(txt);
    }
    circleBox.replaceChildren(svg);
    // плашки под подписями направлений (22.10): мерим текст, когда круг уже на экране
    if (painted) window.requestAnimationFrame(() => {
      for (const txt of svg.querySelectorAll(".sk-lab")) {
        const box = txt.getBBox();
        if (!box.width) continue;
        const plate = sv("rect", { x: box.x - 10, y: box.y - 3, width: box.width + 20, height: box.height + 6, rx: 3, class: "sk-lab-plate" });
        svg.insertBefore(plate, txt);
      }
    });
  }

  let lastBal = null;
  function showSkill(s) {
    state.replaceChildren(el("p", "sk-skill-desc", `${s.name} — ${s.desc.charAt(0).toLowerCase()}${s.desc.slice(1)}`));
    if (s.from) state.append(el("p", "sk-sub", fmt(t.grows, { from: s.from })));
  }

  function renderState(bal) {
    if (!bal) return;
    state.replaceChildren();
    if (bal.total === 0) {
      state.append(el("p", "", t.empty));
      return;
    }
    if (bal.newcomer) {
      state.append(el("p", "", fmt(t.newcomer, { left: lib.rules.newcomer - bal.total })));
      return;
    }
    if (bal.balanced) {
      state.append(el("p", "sk-ok", fmt(t.balanced, { p: Math.round(lib.rules.balanceBonus * 100) })));
      return;
    }
    // сначала замершие, потом тормозящие
    const lines = [];
    for (const kind of ["frozen", "slow"]) {
      for (const b of lib.blocks) {
        if (bal.status[b.key].kind !== kind) continue;
        const pb = blockBy[b.pair];
        const v = { name: b.name, pair: pb.name, pairAcc: pb.acc ?? pb.name, a: bal.val[b.key], b: bal.val[b.pair], p: Math.round((1 - lib.rules.slowRate) * 100) };
        lines.push(fmt(kind === "frozen" ? t.lineFrozen : t.lineSlow, v));
      }
    }
    if (!lines.length) lines.push(t.lineOff);
    for (const [i, line] of lines.entries()) state.append(el("p", i ? "sk-sub" : "", line));
  }

  // Источник заботы: сервер игры (/api/care — вход из окна Telegram или хранитель на localhost)
  // или браузер (пробная версия без сервера). Сервер не ответил — работаем по-старому, в браузере.
  let server = null; // { season, skills: { [skillId]: состояние навыка } }
  async function careFetch(method, url, body) {
    try {
      const headers = { "Content-Type": "application/json" };
      const initData = window.Telegram?.WebApp?.initData;
      if (initData) headers.Authorization = `tma ${initData}`;
      const res = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return { error: json?.error?.code ?? String(res.status) };
      return { data: json.data };
    } catch {
      return null;
    }
  }
  async function syncServer() {
    const r = await careFetch("GET", "/api/care/me");
    server = r?.data ? { season: r.data.season, skills: Object.fromEntries(r.data.skills.map((x) => [x.skill, x])) } : null;
  }
  // Одна картина заботы для карточки — откуда бы ни пришли данные.
  function careOf(s) {
    const cfg = s.card ?? {};
    const st = server?.skills[s.id];
    if (st) {
      const apply = async (method, url, body) => {
        const r = await careFetch(method, url, body);
        if (r?.data) server.skills[s.id] = r.data;
        else await syncServer();
        render();
        return Boolean(r?.data);
      };
      return {
        source: "server",
        season: server.season,
        wards: st.wards,
        plan: st.plan.map((p) => ({ ...p, i: p.item })),
        add: (name, kind) => apply("POST", `/api/care/skills/${s.id}/wards`, { name, ...(kind ? { kind } : {}) }),
        remove: (w) => apply("DELETE", `/api/care/skills/${s.id}/wards/${w.id}`),
        toggle: (p) => apply("POST", `/api/care/skills/${s.id}/marks`, { item: p.i, done: !p.doneToday }),
      };
    }
    const wards = loadWards();
    const mine = wards[s.id] ?? [];
    return {
      source: "browser",
      season: seasonOf(),
      wards: mine,
      plan: carePlan(cfg.care ?? [], mine.length ? loadCare()[s.id] ?? {} : {}),
      add: async (name, kind) => {
        mine.push({ name, kind });
        wards[s.id] = mine;
        saveWards(wards);
        render();
        return true;
      },
      remove: async (w) => {
        const i = mine.indexOf(w);
        if (i >= 0) mine.splice(i, 1);
        wards[s.id] = mine;
        saveWards(wards);
        render();
        return true;
      },
      toggle: async (p) => {
        const now = loadCare();
        const mineDone = (now[s.id] ??= {});
        const dates = new Set(mineDone[p.i] ?? []);
        const d = today();
        if (dates.has(d)) dates.delete(d);
        else dates.add(d);
        mineDone[p.i] = [...dates].sort().slice(-5);
        saveCare(now);
        render();
        return true;
      },
    };
  }

  // карточка навыка: вход (если подопечных нет) или подопечные + забота
  function openCard(id) {
    openId = id;
    render();
  }
  function renderCard(mastery) {
    const C = t.card;
    const s = lib.skills.find((x) => x.id === openId);
    const cfg = s.card ?? {};
    const m = Math.max(0, Math.min(100, Number(mastery[s.id]) || 0));
    const care = careOf(s);
    const mine = care.wards;
    card.replaceChildren();
    const backBtn = el("button", "sk-card-back", C.back);
    backBtn.type = "button";
    backBtn.addEventListener("click", () => {
      openId = null;
      render();
    });
    const head = el("div", "sk-card-head");
    const ic = el("span", "sk-card-ic");
    if (L && s.art) {
      const img = el("img");
      img.src = ART_DIR + s.art;
      img.alt = "";
      ic.append(img);
    } else ic.textContent = s.icon ?? "◆";
    const ttl = el("div", "sk-card-ttl");
    ttl.append(el("h3", "", s.name), el("p", "", s.desc ?? ""));
    const mm = el("div", "sk-card-m");
    mm.append(el("b", "", String(m)), el("span", "", `${C.mastery} · ${C.step}`));
    head.append(ic, ttl, mm);
    card.append(backBtn, head);

    if (s.card) {
      const wardsBox = el("div", "sk-card-sec");
      wardsBox.append(el("h4", "", cfg.wardsTitle ?? C.wards));
      if (mine.length) {
        const chips = el("div", "sk-wards");
        mine.forEach((w) => {
          const chip = el("span", "sk-ward");
          chip.append(el("b", "", w.name), el("i", "", w.kind ?? ""));
          const rm = el("button", "sk-ward-rm", "×");
          rm.type = "button";
          rm.title = C.remove;
          rm.addEventListener("click", () => care.remove(w));
          chip.append(rm);
          chips.append(chip);
        });
        wardsBox.append(chips);
      }
      // ввод в навык: вопрос и поля; после первого подопечного остаётся строкой «добавить ещё»
      const form = el("form", `sk-ask${mine.length ? " more" : ""}`);
      if (!mine.length) form.append(el("p", "sk-ask-q", cfg.ask));
      const name = el("input");
      name.placeholder = cfg.namePh;
      name.maxLength = 40;
      const kind = el("input");
      kind.placeholder = cfg.kindPh;
      kind.maxLength = 40;
      const add = el("button", "sk-ask-add", C.add);
      add.type = "submit";
      const fields = el("div", "sk-ask-row");
      fields.append(name, kind, add);
      form.append(fields);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const n = name.value.trim();
        if (!n) {
          name.focus();
          return;
        }
        const first = !mine.length;
        care.add(n, kind.value.trim()).then((done) => {
          if (done && first) state.replaceChildren(el("p", "sk-ok", fmt(C.opened, { name: s.name })));
        });
      });
      wardsBox.append(form);
      if (!mine.length && cfg.none) wardsBox.append(el("p", "sk-ask-none", cfg.none));
      card.append(wardsBox);

      const careBox = el("div", "sk-card-sec");
      const ch = el("h4", "", cfg.careTitle ?? C.care);
      ch.append(el("em", "", C.careNote));
      careBox.append(ch);
      const season = care.season;
      const plan = care.plan;
      const due = plan.filter((p) => p.due);
      const soon = plan.filter((p) => !p.due);
      const closed = mine.length > 0 && careClosed(plan);
      const ul = el("ul", `sk-care${mine.length ? "" : " off"}${closed ? " closed" : ""}`);
      const who = mine.length && cfg.perWard !== false ? ` — ${mine.map((w) => w.name).join(", ")}` : "";
      const rhythm = (p) => (p.every === 1 ? C.daily : fmt(C.every, { n: p.every }));
      for (const p of mine.length ? due : plan) {
        const li = el("li", p.doneToday ? "done" : "");
        const box = el("button", "sk-care-box");
        box.type = "button";
        box.disabled = !mine.length;
        box.setAttribute("aria-pressed", String(p.doneToday));
        box.append(el("span", "sk-care-mark"), el("span", "sk-care-t", p.text + who), el("em", "sk-care-r", rhythm(p)));
        box.addEventListener("click", () => care.toggle(p));
        li.append(box);
        ul.append(li);
      }
      careBox.append(ul);
      if (mine.length && soon.length) {
        const sn = el("p", "sk-care-soon");
        sn.textContent = `${C.soon}: ` + soon.map((p) => `${p.text.toLowerCase()} — ${fmt(C.inDays, { n: p.wait })}`).join(" · ");
        careBox.append(sn);
      }
      if (!mine.length) careBox.append(el("p", "sk-care-sum", cfg.careOff ?? C.careOff));
      else if (!due.length) careBox.append(el("p", "sk-care-sum ok", C.rest));
      else careBox.append(el("p", `sk-care-sum${closed ? " ok" : ""}`, closed ? C.closed : fmt(C.progress, { done: due.filter((p) => p.doneToday).length, all: due.length })));
      ch.querySelector("em").textContent = `${C.seasons[season]} · ${C.careNote}`;
      card.append(careBox);
    } else {
      card.append(el("p", "sk-card-empty", C.empty));
    }
    card.append(el("p", "sk-card-book", C.book));
  }

  function render() {
    const mastery = loadMastery();
    const bal = balanceOf(lib, mastery);
    lastBal = bal;
    const skillsSum = Object.values(bal.val).reduce((a, b) => a + b, 0);
    const might = mightOf();
    const base = might + skillsSum;
    const value = bal.balanced ? Math.round(base * (1 + lib.rules.balanceBonus)) : base;
    const parts = fmt(t.parts, { a: might, s: skillsSum }) + (bal.balanced ? fmt(t.bonusOn, { p: Math.round(lib.rules.balanceBonus * 100) }) : fmt(t.bonusOff, { p: Math.round(lib.rules.balanceBonus * 100) }));
    intel.replaceChildren(el("span", "sk-intel-name", t.intellect), el("b", "sk-intel-num", String(value)));
    // в живописном окне табличка маленькая — состав Интеллекта в подсказке
    if (L) intel.title = parts;
    else intel.append(el("i", "sk-intel-parts", parts));
    renderList(mastery, bal);
    renderCircle(bal);
    renderState(bal);
    circleBox.hidden = Boolean(openId);
    // на телефоне карточке нужна вся высота — строку равновесия прячем, пока карточка открыта
    state.hidden = phone && Boolean(openId);
    card.hidden = !openId;
    cardFrame.hidden = !openId || !L || phone;
    if (openId) renderCard(mastery);
  }

  function open() {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    applyMode();
    backdrop.hidden = false;
    render();
    syncServer().then(() => {
      if (!backdrop.hidden) render();
    });
    close.focus();
  }
  function hide() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    returnFocus?.focus();
  }
  close.addEventListener("click", hide);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) hide();
  });
  document.addEventListener("hub:dailies", () => {
    if (!backdrop.hidden) render();
  });

  return {
    open,
    close: hide,
    get isOpen() {
      return !backdrop.hidden;
    },
  };
}
