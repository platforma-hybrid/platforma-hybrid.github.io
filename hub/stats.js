// Окно «Силы» v2 (21.10.2026) — круг равновесия, как в «Навыках», на своём фоне (bg_powers).
// Шесть сил тремя парами противовесов: Мощь ↔ Нравственность, Ловкость ↔ Порядок, Выносливость ↔ Покой.
// Точку в центре держит Воля: чем она выше, тем шире кольцо равновесия; сдал день в равновесии — Воле прибавка.
// Перекос мягкий: ничего не замораживает, только видно и подсказывает. Решения — claude/DECISIONS_OCT.md.
// Цифры — живые из ежедневных заданий (getDailies / событие hub:dailies), тексты и раскладка — из hub/stats.json.
// Разбор силы (второй экран) — на фоне bg_powers_detail: медальон и столбики, «Откуда прибавка», лестница.

import { PATH_POINTS, gradeDay, koloDate } from "./kolo.js";
import { fractionalLevel, levelNeed } from "./levels.js";

const SEEN_KEY = "gibrid.stats.seen.v1";
const SVG_NS = "http://www.w3.org/2000/svg";
const ART_DIR = "/assets/hub/ui/stats/";

// символы сил кодом — если нет картинки в art.icons
const SYMBOLS = {
  will: '<path d="M12 21v-6"/><path d="M12 15c-3-1-5-4-5-7 2 0 4 1 5 3 1-2 3-3 5-3 0 3-2 6-5 7z"/><path d="M12 11V4"/>',
  strength: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  agility: '<path d="M4 20L20 4"/><path d="M14 4h6v6"/><path d="M4 14l3 3M7 11l3 3"/>',
  endurance: '<path d="M3 19l6-10 4 6 3-4 5 8z"/>',
  order: '<path d="M4 4h16v16H4z"/><path d="M4 12h16M12 4v16"/>',
  morality: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  calm: '<path d="M15 4a7 7 0 1 0 5 11A6 6 0 0 1 15 4z"/><path d="M3 20c2-1.2 4-1.2 6 0s4 1.2 6 0 4-1.2 6 0"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

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
function svg(name, className, size = 24) {
  const node = sv("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
  if (className) node.setAttribute("class", className);
  node.innerHTML = SYMBOLS[name] ?? "";
  return node;
}
function fmt(template, values) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function place(node, box) {
  if (!box) return;
  Object.assign(node.style, { left: `${box.x}px`, top: `${box.y}px`, ...(box.w ? { width: `${box.w}px` } : {}), ...(box.h ? { height: `${box.h}px` } : {}) });
}
function loadSeen() {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}
function saveSeen(levels) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(levels));
  } catch {
    // хранилище недоступно — вспышку нового уровня просто не покажем
  }
}

// ---------- данные ----------

// (окно v1) стадия цветка и оттенок огня — оставлены для совместимости проверок
export function flowerStage(share) {
  if (share >= 0.75) return 4;
  if (share >= 0.5) return 3;
  if (share >= 0.25) return 2;
  return 1;
}
export function fireTier(level) {
  if (level >= 10) return "full";
  if (level >= 7) return "white";
  if (level >= 4) return "ember";
  return "gold";
}

// прибавка за последние N дней: история + сегодняшние отметки; правило заданий дня — +reward Воле и +reward своей силе
export function gainByAttr(d, days) {
  const reward = d?.reward ?? 5;
  const gain = { will: 0 };
  const recent = (d?.history ?? []).slice(-(days - 1));
  for (const rec of recent) {
    gain.will += (rec.done ?? 0) * reward + (rec.willBonus ?? 0);
    for (const [key, n] of Object.entries(rec.attrs ?? {})) gain[key] = (gain[key] ?? 0) + n * reward;
  }
  if (!d?.closed) {
    const done = new Set(d?.doneIds ?? []);
    for (const task of d?.tasks ?? []) {
      if (!done.has(task.id)) continue;
      gain.will += reward;
      if (task.attr && task.attr !== "dev") gain[task.attr] = (gain[task.attr] ?? 0) + reward;
    }
  }
  return gain;
}

// Равновесие сил. Чистая функция — её зовёт и доска заданий (бонус Воле при сдаче дня).
// flasks — колбы из ежедневок; очки силы = число × max + прогресс. Сила «в разработке» и её пара в равновесие не входят.
export function powersBalance(lib, flasks, max = 100) {
  const B = lib.balance ?? {};
  // max — число (старая ровная шкала) или лестница уровней (24.10); по лестнице считаем по видимым числам:
  // «сотые уровня» (7 и половина пути → 750), чтобы пороги равновесия остались прежними
  const pts = (key) => {
    const f = flasks?.[key];
    if (!f) return 0;
    return typeof max === "number" ? (f.level ?? 0) * max + (f.progress ?? 0) : fractionalLevel(max, f) * 100;
  };
  const val = Object.fromEntries(lib.attrs.map((a) => [a.key, pts(a.key)]));
  const byKey = Object.fromEntries(lib.attrs.map((a) => [a.key, a]));
  const counted = lib.attrs.filter((a) => !a.dev && !byKey[a.pair]?.dev);
  const total = counted.reduce((sum, a) => sum + val[a.key], 0);
  const will = flasks?.will?.level ?? 0;
  const ring = Math.min(B.ringMax ?? 0.3, (B.ringBase ?? 0.15) + (B.ringPerWill ?? 0.01) * will);
  // форма (доли радиуса): «зерно» SEED, от него силы растут наружу, самая сильная — до 0,85.
  // Пара с силой «в разработке» остаётся на зерне. Точка — центр тяжести формы: всегда внутри неё.
  const SEED = 0.32;
  const isCounted = new Set(counted.map((a) => a.key));
  const shown = (key) => (isCounted.has(key) ? val[key] : 0);
  const top = Math.max(40, ...lib.attrs.map((a) => shown(a.key)));
  const reach = Object.fromEntries(lib.attrs.map((a) => [a.key, SEED + (0.85 - SEED) * (shown(a.key) / top)]));
  let x = 0;
  let y = 0;
  let w = 0;
  for (const a of counted) {
    const r = (a.angle * Math.PI) / 180;
    const k = reach[a.key];
    x += Math.cos(r) * k * k;
    y += Math.sin(r) * k * k;
    w += k;
  }
  const px = total && w ? x / w : 0;
  const py = total && w ? y / w : 0;
  const offset = Math.hypot(px, py);
  const newcomer = total < (B.newcomer ?? 30);
  const balanced = total > 0 && !newcomer && offset <= ring;
  // куда тянет: сила с самым большим перевесом над своей парой
  let lead = null;
  for (const a of counted) {
    const gap = val[a.key] - val[a.pair];
    if (gap > 0 && (!lead || gap > lead.gap)) lead = { key: a.key, pair: a.pair, gap };
  }
  return { val, total, will, ring, seed: SEED, reach, point: { x: px, y: py }, offset, newcomer, balanced, lead, counted: isCounted, devPairs: lib.attrs.filter((a) => a.dev).map((a) => [a.key, a.pair]) };
}

function pathSummary(d, quests, character) {
  const history = d?.history ?? [];
  const now = koloDate();
  let dayPoints = 0;
  for (const rec of history) {
    const [y, m, day] = String(rec.day ?? "").split("-").map(Number);
    if (!y) continue;
    if (koloDate(new Date(y, m - 1, day)).year !== now.year) continue;
    dayPoints += PATH_POINTS[gradeDay(rec, d.total)] ?? 0;
  }
  const points = dayPoints + (quests.fullWeeks ?? 0) * PATH_POINTS.week + (quests.fullMonths ?? 0) * PATH_POINTS.month;
  return {
    days: history.length,
    deeds: history.reduce((sum, rec) => sum + (rec.done ?? 0), 0) + (d?.closed ? 0 : d?.done ?? 0),
    points,
    place: character?.rating?.place,
    of: character?.rating?.of,
  };
}

// ---------- разбор силы: данные ----------

function parseDay(key) {
  const [y, m, d] = String(key ?? "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}
// сколько очков силы дал день: Воле — каждое дело (и бонус равновесия), остальным — дела своей силы
function dayGain(rec, key, reward) {
  if (key === "will") return (rec.done ?? 0) * reward + (rec.willBonus ?? 0);
  return (rec.attrs?.[key] ?? 0) * reward;
}
// сегодняшний день как запись истории (ещё не закрыт)
function todayRecord(d, taskAttr) {
  if (!d || d.closed) return null;
  const attrs = {};
  for (const id of d.doneIds ?? []) {
    const attr = taskAttr(id);
    if (attr && attr !== "dev") attrs[attr] = (attrs[attr] ?? 0) + 1;
  }
  return { day: d.day, done: (d.doneIds ?? []).length, ids: [...(d.doneIds ?? [])], attrs, today: true };
}
// прибавка по неделям коло: последние n недель (последняя — текущая)
export function weeklyGains(records, key, reward, n, now = koloDate()) {
  const weeks = [];
  let y = now.year, m = now.month, w = now.week;
  for (let i = 0; i < n; i += 1) {
    weeks.unshift({ year: y, month: m, week: w, gain: 0 });
    w -= 1;
    if (w < 1) { m -= 1; w = 3; if (m < 1) { m = 12; y -= 1; } }
  }
  for (const rec of records) {
    const date = parseDay(rec.day);
    if (!date) continue;
    const k = koloDate(date);
    const slot = weeks.find((x) => x.year === k.year && x.month === k.month && x.week === k.week);
    if (slot) slot.gain += dayGain(rec, key, reward);
  }
  return weeks;
}

// ---------- окно ----------

export function initStats(ctx, getDailies) {
  const lib = ctx.stats;
  const t = ctx.texts.stats;
  const W = lib.window;
  const L = lib.layout;
  const C = L.circle;
  const willLib = lib.will;
  const all = [willLib, ...lib.attrs];
  const byKey = Object.fromEntries(all.map((a) => [a.key, a]));
  const taskInfo = {};
  for (const g of ctx.dailies?.groups ?? []) for (const task of g.tasks ?? []) taskInfo[task.id] = task;
  const taskAttr = (id) => taskInfo[id]?.attr;
  let selected = lib.defaultSelected;
  let quests = {};
  let returnFocus = null;
  let view = "circle"; // circle — круг сил, detail — разбор выбранной силы

  const backdrop = el("div", "st-backdrop");
  backdrop.hidden = true;
  const win = el("section", "st-window st-v2");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-modal", "true");
  win.setAttribute("aria-labelledby", "st-title");
  const deskStyle = `left:${W.x}px;top:${W.y}px;width:${W.w}px;height:${W.h}px;transform:scale(${W.scale ?? 1})`;
  win.setAttribute("style", deskStyle);
  backdrop.append(win);
  ctx.stage.append(backdrop);

  // два фона: круг и разбор
  const bgMain = el("img", "st-v2-bg");
  bgMain.src = ART_DIR + lib.art.bg;
  const bgDetail = el("img", "st-v2-bg");
  bgDetail.src = ART_DIR + (lib.art.detailBg ?? lib.art.bg);
  for (const img of [bgMain, bgDetail]) {
    img.alt = "";
    img.draggable = false;
  }
  win.append(bgMain, bgDetail);

  // заголовок, «назад», крестик
  const head = el("div", "st-head");
  const titleNode = el("h2", "st-title", t.title);
  titleNode.id = "st-title";
  head.append(el("span", "st-dia"), titleNode, el("span", "st-dia"));
  place(head, L.title);
  const back = el("button", "st-back");
  back.type = "button";
  back.dataset.back = "1";
  back.append(el("span", "st-back-arrow", "‹"), el("span", "", t.back));
  back.hidden = true;
  const close = el("button", "st-close");
  close.type = "button";
  close.setAttribute("aria-label", ctx.texts.close);
  close.append(svg("close", "", 22));
  win.append(head, back, close);

  // ----- главный экран: доска слева, круг, строка внизу -----
  const main = el("div", "st-main");
  const board = el("div", "st-left");
  place(board, L.board);
  const sel = el("div", "st-selected");
  const path = el("div", "st-path");
  board.append(sel, path);

  const circle = el("div", "st-circle");
  const ring = el("div", "st-state");
  place(ring, L.state);
  main.append(board, circle, ring);
  win.append(main);

  // гнёзда со знаками и таблички с именами — по нарисованному фону
  const P = (deg, r) => [C.cx + Math.cos((deg * Math.PI) / 180) * r, C.cy + Math.sin((deg * Math.PI) / 180) * r];
  const nodes = {};
  for (const a of lib.attrs) {
    // центр гнезда — по картинке (stats.json → attrs[].socket), иначе по кругу
    const [sx, sy] = a.socket ? [a.socket.x, a.socket.y] : P(a.angle, C.socketR);
    const socket = el("button", `st-socket${a.dev ? " dev" : ""}`);
    socket.type = "button";
    socket.dataset.key = a.key;
    Object.assign(socket.style, { left: `${sx}px`, top: `${sy}px` });
    socket.append(symbolOf(a.key, "st-sym", 22));
    const plaque = el("button", `st-plaque${a.dev ? " dev" : ""}${a.name.length > 11 ? " long" : ""}`);
    plaque.type = "button";
    plaque.dataset.key = a.key;
    place(plaque, a.plaque);
    const name = el("span", "st-plaque-name", a.name);
    const num = el("span", "st-plaque-n");
    plaque.append(name, num);
    main.append(socket, plaque);
    nodes[a.key] = { socket, plaque, num };
  }

  // ----- разбор силы -----
  const detail = el("div", "st-detail");
  detail.hidden = true;
  win.append(detail);

  // Телефон лёжа: та же картина целиком, вписанная в экран (как «Навыки»); по краям — тот же фон, размытый.
  const phoneMq = window.matchMedia("(orientation: landscape) and (max-height: 540px)");
  let ppBg = null;
  function applyMode() {
    const pp = phoneMq.matches;
    win.classList.toggle("st-pp", pp);
    backdrop.classList.toggle("st-pp-bd", pp);
    (pp ? document.body : ctx.stage).append(backdrop);
    if (pp) {
      if (!ppBg) ppBg = el("div", "st-pp-bg");
      ppBg.style.backgroundImage = `url("${ART_DIR + (view === "detail" ? lib.art.detailBg ?? lib.art.bg : lib.art.bg)}")`;
      backdrop.prepend(ppBg);
      const sc = Math.min(window.innerWidth / W.w, window.innerHeight / W.h);
      win.classList.toggle("st-pp-small", sc < 0.5);
      win.setAttribute("style", `left:50%;top:50%;width:${W.w}px;height:${W.h}px;margin:0;transform:translate(-50%, -50%) scale(${sc});transform-origin:50% 50%`);
    } else {
      ppBg?.remove();
      win.classList.remove("st-pp-small");
      win.setAttribute("style", deskStyle);
    }
  }
  phoneMq.addEventListener("change", () => {
    if (!backdrop.hidden) applyMode();
  });
  window.addEventListener("resize", () => {
    if (!backdrop.hidden && phoneMq.matches) applyMode();
  });

  // символ силы: картинка из art.icons (живописная чеканка), иначе — линии кодом
  function symbolOf(key, className, size) {
    const file = lib.art?.icons?.[key];
    if (!file) return svg(key, className, size);
    const img = el("img", `${className} st-sym-art`);
    img.src = ART_DIR + file;
    img.alt = "";
    img.draggable = false;
    const k = size * 1.7 * (lib.art?.iconScale?.[key] ?? 1);
    Object.assign(img.style, { width: `${Math.round(k)}px`, height: `${Math.round(k)}px` });
    return img;
  }

  // ---------- отрисовка ----------

  function stateOf(key, d) {
    const flask = d?.flasks?.[key];
    const level = flask?.level ?? 0;
    return { level, progress: flask?.progress ?? 0, max: levelNeed(d?.curve ?? d?.max ?? 100, level) };
  }

  function renderCircle(bal, hasForm = true) {
    const R = C.R;
    const box = sv("svg", { viewBox: `0 0 ${W.w} ${W.h}`, class: "st-circle-svg", "aria-hidden": "true" });
    // пока все силы 0 — формы нет, как в «Навыках»: только кольцо и точка в центре (автор, 22.10)
    if (!hasForm) {
      const rr0 = bal.ring * R;
      box.append(sv("circle", { cx: C.cx, cy: C.cy, r: rr0, class: "st-core" }), sv("circle", { cx: C.cx, cy: C.cy, r: rr0, class: "st-core-line" }));
      const dot0 = sv("g", { class: "st-dot calm" });
      dot0.append(sv("circle", { cx: C.cx, cy: C.cy, r: 22, class: "st-dot-glow" }), sv("circle", { cx: C.cx, cy: C.cy, r: 10, class: "st-dot-core" }));
      box.append(dot0);
      circle.replaceChildren(box);
      return;
    }
    // форма игрока (21.10): «зерно» — малый шестиугольник, силы растут от него наружу; самая сильная — до 85 % радиуса.
    // Форма рисует то же, что считает точка: пара с силой «в разработке» остаётся на зерне (число — на табличке).
    const pts = lib.attrs.map((a) => P(a.angle, R * bal.reach[a.key]));
    box.append(sv("polygon", { points: lib.attrs.map((a) => P(a.angle, R * bal.seed).join(",")).join(" "), class: "st-seed" }));
    box.append(sv("polygon", { points: pts.map((p) => p.join(",")).join(" "), class: "st-shape" }));
    lib.attrs.forEach((a, i) => box.append(sv("circle", { cx: pts[i][0], cy: pts[i][1], r: 4, class: `st-vert${bal.counted.has(a.key) ? "" : " off"}` })));
    // кольцо равновесия — его держит Воля
    const rr = bal.ring * R;
    box.append(sv("circle", { cx: C.cx, cy: C.cy, r: rr, class: "st-core" }), sv("circle", { cx: C.cx, cy: C.cy, r: rr, class: "st-core-line" }));
    // точка — центр тяжести сил
    // точка — центр тяжести самой формы: всегда внутри неё и тянется к перекосу (как в «Навыках»)
    const px = C.cx + bal.point.x * R;
    const py = C.cy + bal.point.y * R;
    const calm = bal.balanced || bal.newcomer;
    if (!calm) box.append(sv("line", { x1: C.cx, y1: C.cy, x2: px, y2: py, class: "st-pull" }));
    const dot = sv("g", { class: `st-dot${calm ? " calm" : ""}` });
    dot.append(sv("circle", { cx: px, cy: py, r: 22, class: "st-dot-glow" }), sv("circle", { cx: px, cy: py, r: 10, class: "st-dot-core" }));
    box.append(dot);
    circle.replaceChildren(box);
  }

  function renderState(bal) {
    ring.replaceChildren();
    const w = el("div", "st-state-will");
    w.append(el("span", "st-state-will-name", t.willName), el("span", "st-state-will-n", String(bal.will)));
    w.title = t.dotTip;
    const ringInfo = el("span", "st-state-ring", fmt(t.ringInfo, { p: Math.round(bal.ring * 100) }));
    w.append(ringInfo);
    const msg = el("div", "st-state-msg");
    const B = lib.balance ?? {};
    if (bal.total === 0) msg.append(el("p", "", t.empty));
    else if (bal.newcomer) msg.append(el("p", "", fmt(t.newcomer, { n: B.newcomer ?? 30, left: (B.newcomer ?? 30) - bal.total })));
    else if (bal.balanced) msg.append(el("p", "st-ok", fmt(t.balanced, { p: Math.round((B.willBonus ?? 0.1) * 100) })));
    else if (bal.lead) {
      msg.append(el("p", "st-warn", fmt(t.pull, { name: t.acc[bal.lead.key], pairAcc: t.accPair[bal.lead.pair] })));
      msg.append(el("p", "st-sub", t.pullSub));
    }
    ring.append(w, msg);
    ring.classList.toggle("ok", bal.balanced);
    ring.classList.toggle("warn", !bal.balanced && !bal.newcomer && bal.total > 0);
  }

  function renderSelected(d, gain) {
    const a = byKey[selected] ?? lib.attrs[0];
    sel.replaceChildren();
    const top = el("div", "st-sel-head");
    top.append(el("h3", "st-sel-name", a.name), el("span", "st-sel-group", a.pair ? fmt(t.pairOf, { pair: byKey[a.pair]?.name ?? "" }) : ""));
    sel.append(top);
    if (a.dev) {
      const box = el("div", "st-sel-locked");
      box.append(el("span", "", t.devLong));
      sel.append(box);
    } else {
      const s = stateOf(a.key, d);
      const lvRow = el("div", "st-sel-lvrow");
      const n = gain[a.key] ?? 0;
      lvRow.append(el("span", "st-sel-lv", String(s.level)), el("span", `st-sel-gain${n ? "" : " none"}`, fmt(n ? t.gain : t.gainNone, { n, days: lib.gainDays })));
      const barRow = el("div", "st-sel-barrow");
      const bar = el("span", "st-bar big");
      const fill = el("span", "st-fill");
      fill.style.width = `${Math.min(100, (s.progress / s.max) * 100)}%`;
      bar.append(fill);
      barRow.append(bar, el("span", "st-sel-prog", fmt(t.progress, { p: s.progress, max: s.max })));
      sel.append(lvRow, barRow);
    }
    sel.append(el("h4", "st-sel-sub", t.grows), el("p", "st-sel-text", a.grows ?? ""));
    // сила «в разработке» и её пара — вне равновесия: говорим об этом в карточке, а не в нижней строке
    const devSide = a.dev ? a : byKey[a.pair]?.dev ? byKey[a.pair] : null;
    if (devSide) sel.append(el("p", "st-sel-note", fmt(t.devPair, { dev: devSide.name, pair: byKey[devSide.pair].name })));
    // только то, что уже открыто; что впереди — тайна
    const level = stateOf(a.key, d).level;
    const opened = (a.ladder ?? []).filter((r) => r.level <= level).sort((x, y) => y.level - x.level);
    sel.append(el("h4", "st-sel-sub", t.opened));
    if (opened.length) {
      const list = el("ul", "st-sel-list");
      for (const r of opened.slice(0, 2)) list.append(el("li", "", r.text));
      sel.append(list);
    } else sel.append(el("p", "st-sel-text", t.openedNone));
    if (!a.dev) {
      const go = el("button", "st-go");
      go.type = "button";
      go.dataset.detail = a.key;
      go.append(el("span", "", t.detailOpen), el("span", "st-go-arrow", "›"));
      sel.append(go);
    }
  }

  function renderPath(sum, empty) {
    path.replaceChildren(el("h3", "st-path-title", t.pathTitle));
    if (empty) {
      path.append(el("p", "st-empty", t.empty));
      return;
    }
    const grid = el("div", "st-path-grid");
    const cell = (value, label, hot) => {
      const c = el("div", "st-path-cell");
      c.append(el("span", `st-path-num${hot ? " hot" : ""}`, String(value)), el("span", "st-path-label", label));
      return c;
    };
    grid.append(cell(sum.days, t.days), cell(sum.deeds, t.deeds), cell(sum.points, t.pathPoints), cell(sum.place ? fmt(t.placeValue, { place: sum.place, of: sum.of }) : "—", t.place, true));
    path.append(grid);
  }

  function renderDetail(d) {
    const a = byKey[selected] ?? lib.attrs[0];
    const s = stateOf(a.key, d);
    const reward = d?.reward ?? 5;
    const records = [...(d?.history ?? [])];
    const today = todayRecord(d, taskAttr);
    if (today) records.push(today);
    detail.replaceChildren();

    // 1. левая доска: знак в медальоне, число, полоска, столбики по неделям, итоги
    const c1 = el("div", "st-d-left");
    const medal = el("div", "st-d-medal");
    medal.append(symbolOf(a.key, "st-sym", 80));
    const info = el("div", "st-d-info");
    const lv = el("div", "st-sel-lvrow");
    lv.append(el("span", "st-sel-lv", String(s.level)), el("span", "st-sel-next", fmt(t.toNext, { next: s.level + 1, left: s.max - s.progress })));
    const barRow = el("div", "st-sel-barrow");
    const bar = el("span", "st-bar big");
    const fill = el("span", "st-fill");
    fill.style.width = `${Math.min(100, (s.progress / s.max) * 100)}%`;
    bar.append(fill);
    barRow.append(bar, el("span", "st-sel-prog", fmt(t.progress, { p: s.progress, max: s.max })));
    const weeks = weeklyGains(records, a.key, reward, lib.chartWeeks ?? 9);
    const topGain = Math.max(1, ...weeks.map((w) => w.gain));
    const chart = el("div", "st-chart");
    chart.append(el("h4", "st-sel-sub", t.chartTitle));
    const cols = el("div", "st-chart-cols");
    weeks.forEach((w, i) => {
      const last = i === weeks.length - 1;
      const col = el("div", `st-chart-col${last ? " now" : ""}`);
      const b = el("span", "st-chart-bar");
      b.style.height = `${Math.round((w.gain / topGain) * 110)}px`;
      col.append(el("span", "st-chart-val", w.gain ? String(w.gain) : ""), b, el("span", "st-chart-lbl", last ? t.chartNow : fmt(t.chartWeek, { m: w.month, w: w.week })));
      cols.append(col);
    });
    chart.append(cols);
    const total = records.reduce((sum, rec) => sum + (a.key === "will" ? rec.done ?? 0 : rec.attrs?.[a.key] ?? 0), 0);
    const best = weeks.some((w) => w.gain) ? topGain : 0;
    const sums = el("div", "st-sums");
    sums.append(el("p", "", fmt(t.totalDeeds, { n: total })), el("p", "", fmt(t.bestWeek, { n: best })));
    info.append(lv, barRow, chart, sums);
    c1.append(info);

    // 2. средняя доска: откуда прибавка — дела по дням, новые сверху
    const c2 = el("div", "st-d-mid");
    c2.append(el("h4", "st-sel-sub", t.deedsTitle));
    const list = el("div", "st-deed-list");
    let shown = 0;
    for (const rec of [...records].reverse()) {
      const gain = dayGain(rec, a.key, reward);
      if (!gain) continue;
      if (shown >= (lib.deedsLimit ?? 40)) break;
      shown += 1;
      const date = parseDay(rec.day);
      const k = date ? koloDate(date) : null;
      const item = el("div", `st-deed${rec.today ? " today" : ""}`);
      const headRow = el("div", "st-deed-head");
      headRow.append(el("span", "st-deed-day", rec.today ? t.deedToday : k ? fmt(t.deedDay, { m: k.month, w: k.week, d: k.wday }) : rec.day), el("span", "st-deed-gain", `+${gain}`));
      item.append(headRow);
      const ids = (rec.ids ?? []).filter((id) => a.key === "will" || taskAttr(id) === a.key);
      if (ids.length) {
        for (const id of ids) {
          const row = el("div", "st-deed-task");
          row.append(el("span", "", taskInfo[id]?.name ?? id), el("span", "st-deed-plus", `+${reward}`));
          item.append(row);
        }
      } else item.append(el("div", "st-deed-task", fmt(t.deedCount, { n: gain / reward })));
      item.append(el("div", "st-deed-trust", t.deedTrust));
      list.append(item);
    }
    if (!shown) list.append(el("p", "st-empty", t.deedsEmpty));
    c2.append(list);
    const markMore = () => list.classList.toggle("st-more", list.scrollTop + list.clientHeight < list.scrollHeight - 4);
    list.addEventListener("scroll", markMore, { passive: true });

    // 3. правая доска: лестница по нарисованным гнёздам, снизу вверх — открытые ступени и одна запечатанная следующая
    const c3 = el("div", "st-d-right");
    c3.append(el("h4", "st-sel-sub", t.ladderTitle));
    const D = lib.detailLayout;
    const allRungs = [...(a.ladder ?? [])].sort((x, y) => x.level - y.level);
    const opened = allRungs.filter((r) => r.level <= s.level);
    const next = allRungs.find((r) => r.level > s.level);
    const slots = D.ladder.sockets.length;
    const rungs = [...opened.slice(-(next ? slots - 1 : slots)), ...(next ? [next] : [])];
    D.ladder.sockets.forEach((sy, i) => {
      // гнёзда в данных — сверху вниз; ступени кладём снизу вверх
      const r = rungs[D.ladder.sockets.length - 1 - i];
      const rung = el("div", `st-rung2${r ? (r.level <= s.level ? " done" : " next") : " empty"}`);
      Object.assign(rung.style, { top: `${sy - D.right.y}px`, left: `${D.ladder.x - D.right.x}px` });
      const badge = el("span", "st-rung2-badge", r ? (r.level <= s.level ? String(r.level) : "?") : "");
      const body = el("div", "st-rung2-body");
      if (r && r.level <= s.level) body.append(el("span", "st-rung-text", r.text), el("span", "st-rung-state", t.ladderDone));
      else if (r) body.append(el("span", "st-rung-text", t.ladderSecret), el("span", "st-rung-state", fmt(t.ladderSecretState, { n: r.level })));
      rung.append(badge, body);
      c3.append(rung);
    });
    if (!rungs.length) c3.append(el("p", "st-empty st-rung2-none", t.openedNone));

    place(c1, D.left);
    place(c2, D.mid);
    place(c3, D.right);
    place(medal, D.medal);
    detail.append(medal, c1, c2, c3);
    window.requestAnimationFrame(markMore);
  }

  function render(flash = {}) {
    const d = getDailies();
    const isDetail = view === "detail";
    win.classList.toggle("st-detail-mode", isDetail);
    main.hidden = isDetail;
    bgMain.hidden = isDetail;
    bgDetail.hidden = !isDetail;
    detail.hidden = !isDetail;
    back.hidden = !isDetail;
    const DL = lib.detailLayout;
    place(head, isDetail ? DL.title : L.title);
    place(close, isDetail ? DL.close : L.close);
    if (isDetail) place(back, DL.back);
    titleNode.textContent = isDetail ? (byKey[selected] ?? lib.attrs[0]).name : t.title;
    if (ppBg) ppBg.style.backgroundImage = `url("${ART_DIR + (isDetail ? lib.art.detailBg ?? lib.art.bg : lib.art.bg)}")`;
    if (isDetail) {
      renderDetail(d);
      return;
    }
    const gain = gainByAttr(d, lib.gainDays);
    const empty = !(d?.history?.length) && !(d?.done);
    win.classList.toggle("st-empty-state", empty);
    const bal = powersBalance(lib, d?.flasks, d?.curve ?? d?.max ?? 100);
    for (const a of lib.attrs) {
      const node = nodes[a.key];
      const on = selected === a.key;
      node.socket.classList.toggle("selected", on);
      node.plaque.classList.toggle("selected", on);
      if (a.dev) {
        node.num.textContent = "";
        node.plaque.setAttribute("aria-label", `${a.name}: ${t.dev}`);
        node.plaque.title = t.dev;
        continue;
      }
      const s = stateOf(a.key, d);
      node.num.textContent = String(s.level);
      node.plaque.setAttribute("aria-label", `${a.name}: ${s.level}, ${fmt(t.progress, { p: s.progress, max: s.max })}`);
      node.socket.setAttribute("aria-label", a.name);
    }
    renderCircle(bal, lib.attrs.some((a) => !a.dev && stateOf(a.key, d).level > 0));
    renderState(bal);
    renderSelected(d, gain);
    renderPath(pathSummary(d, quests, ctx.character), empty);

    // вспышка нового уровня (с прошлого открытия окна)
    for (const key of Object.keys(flash)) {
      const target = key === "will" ? ring.querySelector(".st-state-will") : nodes[key]?.plaque;
      if (!target) continue;
      target.classList.remove("st-levelup");
      void target.offsetWidth;
      target.classList.add("st-levelup");
      window.setTimeout(() => target.classList.remove("st-levelup"), 1400);
    }
  }

  function levelsNow() {
    const d = getDailies();
    const out = {};
    for (const key of Object.keys(d?.flasks ?? {})) out[key] = d.flasks[key].level ?? 0;
    return out;
  }

  function open() {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const seen = loadSeen();
    const now = levelsNow();
    const flash = {};
    for (const [key, level] of Object.entries(now)) if (seen[key] !== undefined && level > seen[key]) flash[key] = true;
    saveSeen(now);
    view = "circle";
    applyMode();
    backdrop.hidden = false;
    render(flash);
    close.focus();
  }
  function hide() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    returnFocus?.focus();
  }
  function toDetail(key) {
    selected = key;
    view = "detail";
    applyMode();
    render();
    back.focus();
  }
  function toCircle() {
    view = "circle";
    applyMode();
    render();
  }

  close.addEventListener("click", hide);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target === ppBg) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || backdrop.hidden) return;
    if (view === "detail") return toCircle();
    hide();
  });
  win.addEventListener("click", (event) => {
    const el0 = event.target instanceof Element ? event.target : null;
    if (el0?.closest("[data-back]")) return toCircle();
    const go = el0?.closest("[data-detail]");
    if (go) return toDetail(go.dataset.detail);
    const target = el0 ? el0.closest("[data-key]") : null;
    if (!target || !win.contains(target)) return;
    const a = byKey[target.dataset.key];
    // двойной щелчок по силе — сразу разбор
    if (a && event.detail >= 2 && !a.dev) return toDetail(a.key);
    selected = target.dataset.key;
    render();
  });
  document.addEventListener("hub:dailies", () => {
    if (!backdrop.hidden) render();
  });
  document.addEventListener("hub:quests", (event) => {
    quests = event.detail ?? {};
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
