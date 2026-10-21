// Окно «Статы» v0.1 (14.10.2026) — «Древо сил». Спецификация: claude/SPEC_STATS_WINDOW.md.
// Цифры — живые из ежедневных заданий (getDailies / событие hub:dailies), тексты и раскладка — из hub/stats.json.
// Пока нет картинок слоёв, всё рисуется кодом; когда появятся — их имена вписываются в stats.json → art.

import { PATH_POINTS, gradeDay, koloDate } from "./kolo.js";

const SEEN_KEY = "gibrid.stats.seen.v1";
const SVG_NS = "http://www.w3.org/2000/svg";
const ART_DIR = "/assets/hub/ui/stats/";

// символы сил: линейные, на сетке 24 (как иконки хаба)
const SYMBOLS = {
  will: '<path d="M12 21v-6"/><path d="M12 15c-3-1-5-4-5-7 2 0 4 1 5 3 1-2 3-3 5-3 0 3-2 6-5 7z"/><path d="M12 11V4"/>',
  strength: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  agility: '<path d="M4 20L20 4"/><path d="M14 4h6v6"/><path d="M4 14l3 3M7 11l3 3"/>',
  endurance: '<path d="M3 19l6-10 4 6 3-4 5 8z"/>',
  order: '<path d="M4 4h16v16H4z"/><path d="M4 12h16M12 4v16"/>',
  morality: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  wisdom: '<path d="M3 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z"/>',
  valor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  intellect: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v1.5M5.5 4.5l1 1.2M18.5 4.5l-1 1.2"/>',
  honor: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"/>',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3"/><path d="M5 11h14v10H5z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(name, className, size = 24) {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("width", String(size));
  node.setAttribute("height", String(size));
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.6");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  if (className) node.setAttribute("class", className);
  node.innerHTML = SYMBOLS[name] ?? "";
  return node;
}
function fmt(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function art(file, className) {
  if (!file) return null;
  const img = el("img", className);
  img.src = ART_DIR + file;
  img.alt = "";
  img.draggable = false;
  return img;
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

// стадия цветка Воли по доле опыта внутри уровня: 1 бутон … 4 почти полный
export function flowerStage(share) {
  if (share >= 0.75) return 4;
  if (share >= 0.5) return 3;
  if (share >= 0.25) return 2;
  return 1;
}
// оттенок огня по уровню: 1–3 золото, 4–6 огонь, 7–9 белый жар, 10+ — полный цвет
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
    gain.will += (rec.done ?? 0) * reward;
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

function pathSummary(d, quests, character, openLevels) {
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
  const attrs = openLevels.reduce((sum, n) => sum + n, 0);
  const skills = character?.skills?.length ?? 0;
  return {
    days: history.length,
    deeds: history.reduce((sum, rec) => sum + (rec.done ?? 0), 0) + (d?.closed ? 0 : d?.done ?? 0),
    points,
    place: character?.rating?.place,
    of: character?.rating?.of,
    intellect: { value: attrs + skills, attrs, skills },
  };
}

// ---------- цветок Воли (кодом, пока нет картинок) ----------

function flowerSvg(stage) {
  const node = document.createElementNS(SVG_NS, "svg");
  node.setAttribute("viewBox", "-100 -100 200 200");
  node.setAttribute("class", "st-flower-svg");
  node.setAttribute("aria-hidden", "true");
  const petals = [0, 3, 5, 7, 9][stage];
  const open = [0, 0.35, 0.6, 0.82, 1][stage];
  let html = "";
  // завитки папоротника у основания
  html += '<path class="st-fern" d="M0 70 C -10 50 -30 40 -48 46 C -62 52 -58 70 -44 70 C -34 70 -32 58 -40 56"/>';
  html += '<path class="st-fern" d="M0 70 C 10 50 30 40 48 46 C 62 52 58 70 44 70 C 34 70 32 58 40 56"/>';
  html += '<path class="st-stem" d="M0 78 C 0 50 0 30 0 14"/>';
  // огненные лепестки-язычки
  const spread = 150 * open + 20;
  for (let i = 0; i < petals; i += 1) {
    const t = petals === 1 ? 0 : i / (petals - 1) - 0.5;
    const angle = t * spread;
    const len = 46 + 26 * open * (1 - Math.abs(t));
    html += `<path class="st-petal" transform="translate(0 14) rotate(${angle.toFixed(1)})" d="M0 0 C ${-10 * open - 6} ${-len * 0.4} ${-6 * open - 3} ${-len * 0.8} 0 ${-len} C ${6 * open + 3} ${-len * 0.8} ${10 * open + 6} ${-len * 0.4} 0 0z"/>`;
  }
  html += `<circle class="st-core" cx="0" cy="12" r="${6 + 8 * open}"/>`;
  node.innerHTML = html;
  return node;
}

// ---------- разбор силы: данные ----------

function parseDay(key) {
  const [y, m, d] = String(key ?? "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}
// сколько очков силы дал день: Воле — каждое дело, остальным — дела своей силы
function dayGain(rec, key, reward) {
  if (key === "will") return (rec.done ?? 0) * reward;
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
  const all = [lib.will, ...lib.attrs, ...lib.higher, ...(lib.intellect ? [lib.intellect] : [])];
  const byKey = Object.fromEntries(all.map((a) => [a.key, a]));
  const taskInfo = {};
  for (const g of ctx.dailies?.groups ?? []) for (const task of g.tasks ?? []) taskInfo[task.id] = task;
  const taskAttr = (id) => taskInfo[id]?.attr;
  let selected = lib.defaultSelected;
  let quests = {};
  let returnFocus = null;
  let view = "tree"; // tree — Древо сил, detail — разбор выбранной силы

  const backdrop = el("div", "st-backdrop");
  backdrop.hidden = true;
  const win = el("section", "st-window");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-modal", "true");
  win.setAttribute("aria-labelledby", "st-title");
  Object.assign(win.style, { left: `${W.x}px`, top: `${W.y}px`, width: `${W.w}px`, height: `${W.h}px` });
  // размер окна целиком: window.scale в stats.json (1 — во всю раскладку 1440×900), сжатие — от центра
  win.style.transform = `scale(${W.scale ?? 1})`;
  backdrop.append(win);
  ctx.stage.append(backdrop);

  // фон грота
  const bg = el("div", "st-bg");
  const bgArt = art(lib.art.bg, "st-art");
  if (bgArt) {
    bg.append(bgArt);
    win.classList.add("st-art-mode"); // живописный грот: рамки, корни и медальоны — с картинки, цифры и знаки — кодом
  }
  win.append(bg);

  // заголовок и крестик
  const head = el("div", "st-head");
  head.append(el("span", "st-dia"), el("h2", "st-title", t.title), el("span", "st-dia"));
  const titleNode = head.querySelector("h2");
  titleNode.id = "st-title";
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

  // древо: корни (SVG), Воля, медальоны
  const tree = el("div", "st-tree");
  const roots = document.createElementNS(SVG_NS, "svg");
  roots.setAttribute("class", "st-roots");
  roots.setAttribute("viewBox", `0 0 ${W.w} ${W.h}`);
  roots.setAttribute("aria-hidden", "true");
  const rootPaths = {};
  const { cx, cy } = lib.will;
  const curve = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12;
    const my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
    return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
  };
  for (const a of lib.attrs) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", curve(cx, cy, a.x, a.y));
    roots.append(p);
    rootPaths[a.key] = p;
  }
  const honor = lib.higher.find((h) => h.key === "honor");
  for (const h of lib.higher) {
    const p = document.createElementNS(SVG_NS, "path");
    const from = h.key === "honor" ? null : { x: cx, y: cy };
    p.setAttribute("d", from ? curve(from.x, from.y, h.x, h.y) : "");
    if (from) roots.append(p);
    rootPaths[h.key] = p;
    if (h.key !== "honor" && honor) {
      const q = document.createElementNS(SVG_NS, "path");
      q.setAttribute("d", curve(h.x, h.y, honor.x, honor.y));
      q.setAttribute("class", "dark");
      roots.append(q);
    }
  }
  tree.append(roots);

  // перетекание силы: по нарисованным корням от Воли к открытым силам бегут лёгкие искры (только в живописном гроте)
  const flow = document.createElementNS(SVG_NS, "svg");
  flow.setAttribute("class", "st-flow");
  flow.setAttribute("viewBox", `0 0 ${W.w} ${W.h}`);
  flow.setAttribute("aria-hidden", "true");
  const flowLines = {};
  const F = lib.flow ?? {};
  lib.attrs.forEach((a, i) => {
    const dx = a.x - cx;
    const dy = a.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const r0 = F.from ?? 150;
    const r1 = len - (F.to ?? 46);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", (cx + (dx / len) * r0).toFixed(1));
    line.setAttribute("y1", (cy + (dy / len) * r0).toFixed(1));
    line.setAttribute("x2", (cx + (dx / len) * r1).toFixed(1));
    line.setAttribute("y2", (cy + (dy / len) * r1).toFixed(1));
    line.setAttribute("pathLength", "100");
    line.style.animationDelay = `${(-i * (F.stagger ?? 0.9)).toFixed(2)}s`;
    flow.append(line);
    flowLines[a.key] = line;
  });
  if (F.enabled !== false) tree.append(flow); // автор, 15.10: «пунктир» — пока выключено, вернёмся позже

  // Воля: каменный круг с рунами → кольцо опыта → медальон → цветок
  const will = el("button", "st-will");
  will.type = "button";
  will.dataset.key = "will";
  Object.assign(will.style, { left: `${cx}px`, top: `${cy}px` });
  const runeBox = el("span", "st-runes");
  const runeNodes = [];
  for (let i = 0; i < lib.will.runes; i += 1) {
    const deg = (i / lib.will.runes) * 360 + (lib.will.runeStart ?? -90);
    const a = deg * (Math.PI / 180);
    const r = el("span", "st-rune");
    r.style.left = `${Math.cos(a) * lib.will.runeR}px`;
    r.style.top = `${Math.sin(a) * lib.will.runeR}px`;
    r.style.transform = `translate(-50%, -50%) rotate(${deg + 90}deg)`;
    runeBox.append(r);
    runeNodes.push(r);
  }
  const ring = document.createElementNS(SVG_NS, "svg");
  ring.setAttribute("class", "st-ring");
  const R = lib.will.ringR;
  ring.setAttribute("viewBox", `${-R - 14} ${-R - 14} ${2 * R + 28} ${2 * R + 28}`);
  ring.setAttribute("aria-hidden", "true");
  const C = 2 * Math.PI * R;
  ring.innerHTML = `<circle class="st-ring-track" r="${R}"/><circle class="st-ring-fire" r="${R}" stroke-dasharray="0 ${C}" transform="rotate(-90)"/>`;
  const ringFire = ring.querySelector(".st-ring-fire");
  // огненное кольцо с эталона: открывается по опыту против часовой стрелки, как нарисовано
  const ringArtImg = art(lib.art.willRingFire, "");
  const ringArt = ringArtImg ? el("span", "st-ring-art") : null;
  if (ringArt) {
    ringArt.append(ringArtImg);
    const size = lib.will.ringSize ?? 294;
    Object.assign(ringArt.style, { width: `${size}px`, height: `${size}px` });
    ring.style.display = "none";
  }
  const medal = el("span", "st-will-medal");
  const flowerBox = el("span", "st-flower");
  const flowerArt = art(lib.art.willFlower, "st-flower-art");
  if (flowerArt) {
    flowerBox.classList.add("has-art");
    flowerBox.append(flowerArt);
    const size = lib.will.flowerSize ?? 220;
    Object.assign(flowerBox.style, { width: `${size}px`, height: `${size}px` });
  }
  medal.append(flowerBox);
  const willLabel = el("span", "st-will-label");
  // подпись — в нарисованной табличке под Волей (will.labelR — ниже центра); без числа в JSON — по-старому, под кольцом
  if (lib.will.labelR != null) {
    willLabel.classList.add("in-plaque");
    willLabel.style.top = `calc(50% + ${lib.will.labelR}px)`;
  }
  will.append(runeBox, ring, ...(ringArt ? [ringArt] : []), medal, willLabel);
  tree.append(will);

  // Интеллект — второе ядро: сумма всех сил и навыков. Круг и точка: Воля — точка (ты), Интеллект — круг вокруг неё.
  // Каменный круг вокруг Воли светится голубым в бороздах (art.intelRing); чем больше Интеллект — тем ярче.
  let intel = null;
  if (lib.intellect) {
    intel = el("button", "st-intel");
    intel.type = "button";
    intel.dataset.key = "intellect";
    const size = lib.intellect.ringSize ?? 488;
    Object.assign(intel.style, { left: `${cx}px`, top: `${cy}px`, width: `${size}px`, height: `${size}px` });
    const ringImg = art(lib.art.intelRing, "st-intel-ring");
    if (ringImg) intel.append(ringImg);
    const label = el("span", "st-intel-label");
    label.style.top = `${size / 2 - (lib.intellect.labelR ?? 226)}px`;
    intel.append(label);
    tree.insertBefore(intel, will);
  }

  // медальоны сил
  const nodes = {};
  for (const a of [...lib.attrs, ...lib.higher]) {
    const locked = a.group === "higher";
    const b = el("button", `st-node${locked ? " locked" : ""}${a.dev ? " dev" : ""}${a.rare ? " rare" : ""}`);
    b.type = "button";
    b.dataset.key = a.key;
    Object.assign(b.style, { left: `${a.x}px`, top: `${a.y}px` });
    const m = el("span", "st-medal");
    m.append(symbolOf(a.key, "st-sym", 40));
    if (locked) {
      const lock = el("span", "st-lock");
      lock.append(svg("lock", "", 16));
      m.append(lock);
    }
    const name = el("span", "st-name", a.name);
    const nameNum = el("span", "st-name-n");
    name.append(nameNum);
    if (locked) { b.tabIndex = -1; b.setAttribute("aria-hidden", "true"); }
    const row = el("span", "st-row");
    const level = el("span", "st-lv");
    const bar = el("span", "st-bar");
    const fill = el("span", "st-fill");
    bar.append(fill);
    if (locked) row.append(el("span", "st-hint", t.lockedShort));
    else if (a.dev) row.append(el("span", "st-hint", t.dev));
    else row.append(level, bar);
    b.append(m, name, row);
    tree.append(b);
    nodes[a.key] = { button: b, level, fill, nameNum };
  }
  win.append(tree);

  // правая доска: выбранная сила
  const B = lib.boards;
  const sel = el("div", "st-board st-selected");
  Object.assign(sel.style, { left: `${B.selected.x}px`, top: `${B.selected.y}px`, width: `${B.selected.w}px`, height: `${B.selected.h}px` });
  const path = el("div", "st-board st-path");
  Object.assign(path.style, { left: `${B.path.x}px`, top: `${B.path.y}px`, width: `${B.path.w}px`, height: `${B.path.h}px` });
  win.append(sel, path);
  const detail = el("div", "st-detail");
  detail.hidden = true;
  win.append(detail);

  // Телефон лёжа (16.10): окно поверх экрана; древо — картиной по высоте экрана слева,
  // доски — справа столбиком, крупно (в увеличении), листаются. Нажатия ловит то же окно — логика не меняется.
  const phoneMq = window.matchMedia("(orientation: landscape) and (max-height: 540px)");
  const side = el("div", "st-ph-side");
  const deskWinStyle = win.getAttribute("style") ?? "";
  let phone = false;
  let sideWide = 0;
  // 17.10: доски справа и разбор силы на телефоне — крупно, но целиком: увеличение подбирается, пока всё не влезет (от 1,8 до 1,3)
  function fitZoom(box, place) {
    for (let z = 1.8; z >= 1.3; z -= 0.1) {
      place(z);
      if (box.scrollHeight <= box.clientHeight + 1) return;
    }
  }
  function fitPhone() {
    if (!phone) return;
    if (!side.hidden) {
      fitZoom(side, (z) => Object.assign(side.style, { zoom: z, left: `${1000 / z}px`, top: `${150 / z}px`, bottom: `${10 / z}px`, width: `${(sideWide - 1020) / z}px` }));
    }
    if (!detail.hidden) {
      fitZoom(detail, (z) => Object.assign(detail.style, { zoom: z, top: `${130 / z}px` }));
      // списки, что листаются («Откуда прибавка», «Открыто на пути»): низ тает, пока ниже есть ещё
      for (const box of detail.querySelectorAll(".st-deed-list, .st-ladder")) {
        const mark = () => box.classList.toggle("st-more", box.scrollTop + box.clientHeight < box.scrollHeight - 4);
        if (!box.dataset.more) {
          box.dataset.more = "1";
          box.addEventListener("scroll", mark, { passive: true });
        }
        mark();
      }
    }
  }
  function applyMode() {
    phone = phoneMq.matches;
    win.classList.toggle("st-phone", phone);
    backdrop.classList.toggle("st-phone-bd", phone);
    (phone ? document.body : ctx.stage).append(backdrop);
    if (phone) {
      const s = window.innerHeight / W.h;
      const wide = Math.max(W.w, window.innerWidth / s);
      win.setAttribute("style", `left:0;top:0;width:${wide}px;height:${W.h}px;transform:scale(${s});transform-origin:0 0`);
      sideWide = wide;
      if (sel.parentElement !== side) side.append(sel, path);
      if (side.parentElement !== win) win.append(side);
    } else {
      win.setAttribute("style", deskWinStyle);
      detail.style.removeProperty("zoom");
      detail.style.removeProperty("top");
      if (sel.parentElement === side) win.insertBefore(path, detail), win.insertBefore(sel, path);
      side.remove();
    }
  }
  phoneMq.addEventListener("change", () => {
    if (!backdrop.hidden) applyMode();
  });
  window.addEventListener("resize", () => {
    if (!backdrop.hidden && phone) applyMode();
  });

  // символ силы: картинка из art.icons (живописная чеканка), иначе — линии кодом
  function symbolOf(key, className, size) {
    const file = lib.art?.icons?.[key];
    if (!file) return svg(key, className, size);
    const img = art(file, `${className} st-sym-art`);
    const k = size * 1.7 * (lib.art?.iconScale?.[key] ?? 1);
    Object.assign(img.style, { width: `${Math.round(k)}px`, height: `${Math.round(k)}px` });
    return img;
  }

  // ---------- отрисовка ----------

  function stateOf(key, d) {
    const max = d?.max ?? 100;
    const flask = d?.flasks?.[key];
    return { level: flask?.level ?? 0, progress: flask?.progress ?? 0, max };
  }

  function renderSelected(d, gain, sum) {
    const a = byKey[selected] ?? lib.will;
    const locked = a.group === "higher";
    sel.replaceChildren();
    const top = el("div", "st-sel-head");
    top.append(el("h3", "st-sel-name", a.name), el("span", "st-sel-group", t.groups[a.group] ?? ""));
    sel.append(top);
    if (a.key === "intellect") {
      // итог, а не сила: число, из чего сложено, как растёт; полоски и разбора нет
      const lvRow = el("div", "st-sel-lvrow");
      lvRow.append(el("span", "st-sel-lv", String(sum.intellect.value)), el("span", "st-sel-gain none", fmt(t.intellectParts, { a: sum.intellect.attrs, s: sum.intellect.skills })));
      sel.append(lvRow, el("h4", "st-sel-sub", t.grows), el("p", "st-sel-text", a.grows ?? ""));
      return;
    }
    if (locked) {
      const box = el("div", "st-sel-locked");
      box.append(svg("lock", "", 22), el("span", "", t.locked));
      sel.append(box, el("p", "st-sel-hint", t.lockedHint));
    } else if (a.dev) {
      const box = el("div", "st-sel-locked");
      box.append(el("span", "", t.devLong));
      sel.append(box);
    } else {
      const s = stateOf(a.key, d);
      const lvRow = el("div", "st-sel-lvrow");
      const n = gain[a.key] ?? 0;
      lvRow.append(
        el("span", "st-sel-lv", String(s.level)),
        el("span", "st-sel-lvcap", t.level),
        el("span", `st-sel-gain${n ? "" : " none"}`, fmt(n ? t.gain : t.gainNone, { n, days: lib.gainDays })),
      );
      const barRow = el("div", "st-sel-barrow");
      const bar = el("span", "st-bar big");
      const fill = el("span", "st-fill");
      fill.style.width = `${Math.min(100, (s.progress / s.max) * 100)}%`;
      bar.append(fill);
      barRow.append(bar, el("span", "st-sel-prog", fmt(t.progress, { p: s.progress, max: s.max })));
      sel.append(lvRow, barRow);
    }
    if (locked) return; // будущее не раскрываем: у закрытой силы — только замок
    sel.append(el("h4", "st-sel-sub", t.grows), el("p", "st-sel-text", a.grows ?? ""));
    // только то, что уже открыто; что впереди — тайна (эпохи, страницы книги)
    const level = stateOf(a.key, d).level;
    const opened = (a.ladder ?? []).filter((r) => r.level <= level).sort((x, y) => y.level - x.level);
    sel.append(el("h4", "st-sel-sub", t.opened));
    if (opened.length) {
      const list = el("ul", "st-sel-list");
      for (const r of opened.slice(0, 2)) list.append(el("li", "", r.text));
      sel.append(list);
    } else {
      sel.append(el("p", "st-sel-text", t.openedNone));
    }
    if (!locked && !a.dev) {
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
    grid.append(
      cell(sum.days, t.days),
      cell(sum.deeds, t.deeds),
      cell(sum.points, t.pathPoints),
      cell(sum.place ? fmt(t.placeValue, { place: sum.place, of: sum.of }) : "—", t.place, true),
    );
    path.append(grid);
  }

  function renderDetail(d) {
    const a = byKey[selected] ?? lib.will;
    const s = stateOf(a.key, d);
    const reward = d?.reward ?? 5;
    const records = [...(d?.history ?? [])];
    const today = todayRecord(d, taskAttr);
    if (today) records.push(today);
    detail.replaceChildren();

    // 1. медальон, уровень, график по неделям, итоги
    const c1 = el("div", "st-col");
    const big = el("div", "st-box st-big");
    const medal = el("span", `st-medal st-medal-big${a.key === "will" ? " will" : ""}`);
    medal.append(symbolOf(a.key, "st-sym", 60));
    const lv = el("div", "st-sel-lvrow");
    lv.append(el("span", "st-sel-lv", String(s.level)), el("span", "st-sel-lvcap", t.level));
    const barRow = el("div", "st-sel-barrow");
    const bar = el("span", "st-bar big");
    const fill = el("span", "st-fill");
    fill.style.width = `${Math.min(100, (s.progress / s.max) * 100)}%`;
    bar.append(fill);
    barRow.append(bar, el("span", "st-sel-prog", fmt(t.progress, { p: s.progress, max: s.max })));
    big.append(medal, lv, barRow, el("p", "st-sel-next", fmt(t.toNext, { next: s.level + 1, left: s.max - s.progress })));

    const weeks = weeklyGains(records, a.key, reward, lib.chartWeeks ?? 9);
    const top = Math.max(1, ...weeks.map((w) => w.gain));
    const chart = el("div", "st-box st-chart");
    chart.append(el("h4", "st-sel-sub", t.chartTitle));
    const cols = el("div", "st-chart-cols");
    weeks.forEach((w, i) => {
      const last = i === weeks.length - 1;
      const col = el("div", `st-chart-col${last ? " now" : ""}`);
      const b = el("span", "st-chart-bar");
      b.style.height = `${Math.round((w.gain / top) * 120)}px`;
      col.append(el("span", "st-chart-val", w.gain ? String(w.gain) : ""), b, el("span", "st-chart-lbl", last ? t.chartNow : fmt(t.chartWeek, { m: w.month, w: w.week })));
      cols.append(col);
    });
    chart.append(cols);
    const total = records.reduce((sum, rec) => sum + (a.key === "will" ? rec.done ?? 0 : rec.attrs?.[a.key] ?? 0), 0);
    const sums = el("div", "st-box st-sums");
    sums.append(el("p", "", fmt(t.totalDeeds, { n: total })), el("p", "", fmt(t.bestWeek, { n: top === 1 && !weeks.some((w) => w.gain) ? 0 : top })));
    c1.append(big, chart, sums);

    // 2. откуда прибавка — дела по дням, новые сверху
    const c2 = el("div", "st-box st-col st-deeds");
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
      } else {
        item.append(el("div", "st-deed-task", fmt(t.deedCount, { n: gain / reward })));
      }
      item.append(el("div", "st-deed-trust", t.deedTrust));
      list.append(item);
    }
    if (!shown) list.append(el("p", "st-empty", t.deedsEmpty));
    c2.append(list);

    // 3. что открывает — лестница снизу вверх, прокрутка
    const c3 = el("div", "st-box st-col st-ladder-box");
    c3.append(el("h4", "st-sel-sub", t.ladderTitle));
    const scroller = el("div", "st-ladder");
    // будущее не раскрываем: открытые ступени + одна запечатанная следующая
    const all = [...(a.ladder ?? [])];
    const nextLevel = Math.min(...all.filter((r) => r.level > s.level).map((r) => r.level));
    const rungs = all.filter((r) => r.level <= s.level || r.level === nextLevel).sort((x, y) => y.level - x.level);
    for (const r of rungs) {
      const state = r.level <= s.level ? "done" : "next";
      const rung = el("div", `st-rung ${state}`);
      const badge = el("span", "st-rung-badge", state === "done" ? String(r.level) : "?");
      const body = el("div", "st-rung-body");
      if (state === "done") body.append(el("span", "st-rung-text", r.text), el("span", "st-rung-state", t.ladderDone));
      else body.append(el("span", "st-rung-text", t.ladderSecret), el("span", "st-rung-state", fmt(t.ladderSecretState, { n: r.level })));
      rung.append(badge, body);
      scroller.append(rung);
    }
    if (!rungs.length) scroller.append(el("p", "st-empty", t.openedNone));
    c3.append(scroller);
    detail.append(c1, c2, c3);
    window.requestAnimationFrame(() => {
      const target = scroller.querySelector(".next") ?? scroller.querySelector(".done");
      if (target) scroller.scrollTop = target.offsetTop - scroller.clientHeight / 2 + target.offsetHeight / 2;
    });
  }

  function render(flash = {}) {
    const d = getDailies();
    const isDetail = view === "detail";
    win.classList.toggle("st-detail-mode", isDetail);
    tree.hidden = isDetail;
    sel.hidden = isDetail;
    path.hidden = isDetail;
    side.hidden = isDetail;
    detail.hidden = !isDetail;
    back.hidden = !isDetail;
    titleNode.textContent = isDetail ? (byKey[selected] ?? lib.will).name : t.title;
    if (isDetail) {
      renderDetail(d);
      fitPhone();
      return;
    }
    const gain = gainByAttr(d, lib.gainDays);
    const empty = !(d?.history?.length) && !(d?.done);
    win.classList.toggle("st-empty-state", empty);

    // Воля
    const w = stateOf("will", d);
    const share = w.max ? Math.min(1, w.progress / w.max) : 0;
    const stage = w.level >= 10 ? 4 : flowerStage(share);
    ringFire.setAttribute("stroke-dasharray", `${(C * share).toFixed(1)} ${C.toFixed(1)}`);
    ringArt?.style.setProperty("--st-ring-p", `${(share * 360).toFixed(1)}deg`);
    will.dataset.tier = fireTier(w.level);
    will.dataset.stage = String(stage);
    runeNodes.forEach((r, i) => r.classList.toggle("lit", i < Math.min(w.level, lib.will.runes)));
    if (flowerArt) {
      // цветок с картинки: стадия — размер и яркость (бутон мал и тускл, почти полный — во всю силу)
      const st = empty ? 1 : stage;
      flowerBox.style.setProperty("--st-flower-scale", String([0, 0.5, 0.66, 0.82, 1][st]));
      flowerBox.style.setProperty("--st-flower-bright", String([0, 0.55, 0.72, 0.88, 1.05][st]));
    } else {
      flowerBox.replaceChildren(flowerSvg(empty ? 1 : stage));
    }
    willLabel.textContent = fmt(t.willLabel, { name: lib.will.name, level: w.level });
    will.setAttribute("aria-label", `${lib.will.name}: ${t.level} ${w.level}, ${fmt(t.progress, { p: w.progress, max: w.max })}`);
    will.classList.toggle("selected", selected === "will");

    // основные и высшие
    const openLevels = [w.level];
    for (const a of [...lib.attrs, ...lib.higher]) {
      const node = nodes[a.key];
      node.button.classList.toggle("selected", selected === a.key);
      const locked = a.group === "higher";
      rootPaths[a.key]?.setAttribute("class", locked || a.dev ? "dark" : "lit");
      if (flowLines[a.key]) {
        // искра бежит к открытой силе; к силе в разработке — нет; к выбранной — ярче
        flowLines[a.key].classList.toggle("off", locked || !!a.dev);
        flowLines[a.key].classList.toggle("selected", selected === a.key);
      }
      if (locked || a.dev) {
        node.button.setAttribute("aria-label", `${a.name}: ${locked ? t.lockedShort : t.dev}`);
        continue;
      }
      const s = stateOf(a.key, d);
      openLevels.push(s.level);
      node.level.textContent = String(s.level);
      node.nameNum.textContent = String(s.level);
      node.fill.style.width = `${Math.min(100, (s.progress / s.max) * 100)}%`;
      node.button.setAttribute("aria-label", `${a.name}: ${t.level} ${s.level}, ${fmt(t.progress, { p: s.progress, max: s.max })}`);
    }

    const sum = pathSummary(d, quests, ctx.character, openLevels);
    if (intel) {
      intel.classList.toggle("selected", selected === "intellect");
      intel.style.setProperty("--st-intel-glow", String(Math.min(1, 0.4 + sum.intellect.value / (lib.intellect.full ?? 60))));
      intel.querySelector(".st-intel-label").textContent = fmt(t.willLabel, { name: lib.intellect.name, level: sum.intellect.value });
      intel.setAttribute("aria-label", `${lib.intellect.name}: ${sum.intellect.value} — ${fmt(t.intellectParts, { a: sum.intellect.attrs, s: sum.intellect.skills })}`);
    }
    renderSelected(d, gain, sum);
    renderPath(sum, empty);
    fitPhone();

    // вспышка нового уровня (с прошлого открытия окна)
    for (const key of Object.keys(flash)) {
      const target = key === "will" ? will : nodes[key]?.button;
      if (!target) continue;
      target.classList.remove("st-levelup");
      void target.offsetWidth;
      target.classList.add("st-levelup");
      window.setTimeout(() => target.classList.remove("st-levelup"), 1400);
    }
    if (flash.will) roots.classList.add("st-surge");
    window.setTimeout(() => roots.classList.remove("st-surge"), 1400);
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
    view = "tree";
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

  close.addEventListener("click", hide);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || backdrop.hidden) return;
    if (view === "detail") {
      view = "tree";
      render();
      return;
    }
    hide();
  });
  win.addEventListener("click", (event) => {
    const el0 = event.target instanceof Element ? event.target : null;
    if (el0?.closest("[data-back]")) {
      view = "tree";
      render();
      return;
    }
    const go = el0?.closest("[data-detail]");
    if (go) {
      selected = go.dataset.detail;
      view = "detail";
      render();
      back.focus();
      return;
    }
    const target = el0 ? el0.closest("[data-key]") : null;
    if (target?.classList.contains("locked")) return; // закрытая сила — пустое гнездо, не выбирается
    // двойной щелчок по открытой силе — сразу разбор
    const lib0 = target ? byKey[target.dataset.key] : null;
    if (lib0 && event.detail >= 2 && lib0.group !== "higher" && lib0.group !== "core" && !lib0.dev) {
      selected = lib0.key;
      view = "detail";
      render();
      back.focus();
      return;
    }
    if (!target || !win.contains(target)) return;
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
