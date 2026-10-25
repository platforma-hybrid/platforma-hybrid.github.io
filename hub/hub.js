// Main Hub v0.1: собирает сцену из слоёв по hub.layout.json.
// Тексты — hub.texts.json, данные персонажа — mock.character.json (позже — API).
// Параметры адреса: ?edit=1 — режим правки раскладки, ?anim=0 — без анимаций.

import { createKolo, monthStats } from "./kolo.js";
import { initQuests } from "./quests.js";
import { initAchievements } from "./achievements.js";
import { initStats, powersBalance } from "./stats.js";
import { initSkills } from "./skills.js";
import { initPhone } from "./phone.js";
import { addPoints, fractionalLevel, levelNeed, migrateFlask } from "./levels.js";

const params = new URLSearchParams(window.location.search);
const ICONS = "/assets/hub/icons/";

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name, className = "icon") {
  const img = el("img", className);
  img.src = `${ICONS}${name}.svg`;
  img.alt = "";
  img.draggable = false;
  return img;
}

// Кнопка, которая открывает окно-заглушку или ведёт на карту.
function actionButton(className, action, label) {
  const button = el("button", className);
  button.type = "button";
  button.dataset.action = action;
  if (label) button.setAttribute("aria-label", label);
  return button;
}

// ---------- компоненты интерфейса (слой L5) ----------

// ---------- туман войны: облака на вращающемся шаре ----------
// Купол — верхняя половина шара. Из картинки тумана один раз строится «карта облаков» по долготе и широте
// (берётся только середина картинки, без светлого ободка), карта зацикливается мягким наложением,
// чтобы не было шва и зеркала. Каждый кадр карта сдвигается по долготе — облака плывут по шару.
// Геометрия купола в долях рамки: центр по x, линия основания, радиусы (item.fogSphere переопределяет).
const FOG_SPHERE = { cx: 0.5, base: 0.655, rx: 0.405, ry: 0.628 };
const FOG_TURN_S = 150; // полный оборот, секунд
const FOG_SRC_LON = Math.PI / 3; // из картинки берём долготы ±60° — без ободка по краям
const FOG_SRC_LAT = (62 * Math.PI) / 180; // и широты до 62° — без ободка сверху
const FOG_PERIOD = Math.PI; // карта облаков повторяется дважды за оборот
const FOG_LAT_MIN = (-20 * Math.PI) / 180; // низ купола уходит в колодец чуть ниже «экватора»
const FOG_POLE = [(50 * Math.PI) / 180, (78 * Math.PI) / 180]; // к макушке вращение плавно сменяется неподвижным туманом

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`[hub] не загрузилась картинка ${src}`));
    img.src = src;
  });
}

async function spinFog(canvas, item) {
  const w = Math.round(item.w);
  const h = Math.round(item.h);
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext("2d");
  const [fogImg, maskImg] = await Promise.all([loadImage(item.fog), item.fogMask ? loadImage(item.fogMask) : null]);
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  const src = read(fogImg);
  const mask = maskImg ? read(maskImg) : null;
  const geo = { ...FOG_SPHERE, ...(item.fogSphere ?? {}) };
  const cx = geo.cx * w;
  const base = geo.base * h;
  const rx = geo.rx * w;
  const ry = geo.ry * h;

  // 1) карта облаков TW × TH (долгота 0…2π, широта FOG_LAT_MIN…π/2)
  const TW = 1024;
  const TH = 256;
  const tex = new Float32Array(TW * TH * 4);
  const sample = (lon, lat, out, k) => {
    const sx = Math.min(w - 1, Math.max(0, Math.round(cx + Math.sin(lon) * Math.cos(lat) * rx)));
    const sy = Math.min(h - 1, Math.max(0, Math.round(base - Math.sin(lat) * ry)));
    const s = (sy * w + sx) * 4;
    for (let c = 0; c < 4; c++) out[c] += src[s + c] * k;
  };
  const acc = [0, 0, 0, 0];
  for (let ty = 0; ty < TH; ty++) {
    const lat = Math.min(FOG_LAT_MIN + ((ty + 0.5) / TH) * (Math.PI / 2 - FOG_LAT_MIN), FOG_SRC_LAT);
    for (let tx = 0; tx < TW; tx++) {
      // фаза внутри периода 0…1; два сэмпла, сдвинутые на полпериода, смешиваются «треугольником» — шва нет
      const phase = (((tx + 0.5) / TW) * (2 * Math.PI) / FOG_PERIOD) % 1;
      const pa = phase;
      const pb = (phase + 0.5) % 1;
      const ka = 1 - Math.abs(pa * 2 - 1); // 0 на краях своего отрезка, 1 в середине
      const kb = 1 - ka;
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      sample((pa * 2 - 1) * FOG_SRC_LON, lat, acc, ka);
      sample((pb * 2 - 1) * FOG_SRC_LON, lat, acc, kb);
      tex.set(acc, (ty * TW + tx) * 4);
    }
  }

  // 2) для каждой точки купола — её место на карте (долгота в долях оборота, строка широты)
  const idx = [];
  const lonT = [];
  const rowT = [];
  const still = [];
  const smooth = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  for (let y = 0; y < h; y++) {
    const v = Math.max(Math.sin(FOG_LAT_MIN), (base - y) / ry);
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask && mask[p * 4 + 3] < 4) continue;
      const u = (x - cx) / rx;
      const zz = 1 - u * u - v * v;
      if (zz <= 0) continue;
      idx.push(p);
      lonT.push(Math.atan2(u, Math.sqrt(zz)) / (2 * Math.PI));
      const lat = Math.asin(Math.min(1, v));
      rowT.push(Math.min(TH - 1, Math.max(0, Math.floor(((lat - FOG_LAT_MIN) / (Math.PI / 2 - FOG_LAT_MIN)) * TH))) * TW);
      still.push(smooth(FOG_POLE[0], FOG_POLE[1], lat));
    }
  }
  const out = ctx2d.createImageData(w, h);
  const dst = out.data;

  const draw = (turn) => {
    for (let i = 0; i < idx.length; i++) {
      let f = (lonT[i] + turn) % 1;
      if (f < 0) f += 1;
      const t = (rowT[i] + Math.floor(f * TW)) * 4;
      const d = idx[i] * 4;
      const k = still[i];
      const m = 1 - k;
      dst[d] = tex[t] * m + src[d] * k;
      dst[d + 1] = tex[t + 1] * m + src[d + 1] * k;
      dst[d + 2] = tex[t + 2] * m + src[d + 2] * k;
      const a = tex[t + 3] * m + src[d + 3] * k;
      dst[d + 3] = mask ? (a * mask[d + 3]) / 255 : a;
    }
    ctx2d.putImageData(out, 0, 0);
  };

  const noMotion = document.body.classList.contains("no-anim") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (noMotion) return draw(0);
  const start = performance.now();
  let last = 0;
  const tick = (now) => {
    if (!canvas.isConnected) return;
    // ~30 кадров в секунду хватает: облака двигаются медленно
    if (now - last > 33 && !document.hidden) {
      last = now;
      draw((now - start) / 1000 / FOG_TURN_S);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const components = {
  titlePlank(box, { texts }) {
    const plank = el("div", "wood plank title-plank");
    plank.append(el("h1", "gold-text", texts.title));
    box.append(plank);
  },

  verifiedBadge(box, { texts, character }) {
    if (!character.verified) return;
    const badge = el("div", "wood verified");
    badge.append(icon("check"), el("span", "", texts.verified), icon("check"));
    box.append(badge);
  },

  mail(box, { texts, character }) {
    const button = actionButton("mail-button", "modal:mail", texts.mailLabel);
    button.append(icon("mail"));
    const unread = character.mail?.unread ?? 0;
    if (unread > 0) button.append(el("span", "mail-badge", String(unread)));
    box.append(button);
  },

  // Меню: кольцо Воли + золотая рейка с пунктами (04.10.2026).
  // Кольцо и счётчик «Задания» берут живые данные из ежедневных заданий (событие hub:dailies).
  menu(box, { texts }) {
    box.classList.add("passthrough");
    const nav = el("nav", "menu-ring");
    nav.setAttribute("aria-label", "Меню персонажа");

    const SEGS = 36, R = 118, C = 130;
    const svgNS = "http://www.w3.org/2000/svg";
    const p = (r, a) => `${(C + r * Math.cos(a)).toFixed(1)},${(C + r * Math.sin(a)).toFixed(1)}`;
    let segs = "";
    for (let i = 0; i < SEGS; i++) {
      const a0 = ((-90 + (i * 360) / SEGS + 1.6) * Math.PI) / 180;
      const a1 = ((-90 + ((i + 1) * 360) / SEGS - 1.6) * Math.PI) / 180;
      const r1 = R - 4, r2 = R - 22;
      segs += `<path class="mr-seg" d="M${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r2, a1)} A${r2},${r2} 0 0 0 ${p(r2, a0)} Z"/>`;
    }
    let ticks = "";
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 * Math.PI) / 180;
      const x = C + (R + 6) * Math.cos(a), y = C + (R + 6) * Math.sin(a);
      ticks += `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" transform="rotate(45 ${x} ${y})" fill="url(#mrGold)" stroke="#2a1a0e" stroke-width="2"/>`;
    }
    const ring = el("button", "menu-ring-will");
    ring.type = "button";
    ring.dataset.action = "stats";
    ring.innerHTML = `
      <svg class="mr-svg" width="260" height="260" viewBox="0 0 260 260" aria-hidden="true">
        <defs>
          <linearGradient id="mrGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#e3b860"/><stop offset="1" stop-color="#8a5a1c"/></linearGradient>
          <linearGradient id="mrEmber" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ff8a1c"/></linearGradient>
          <radialGradient id="mrWood" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#4a2e18"/><stop offset="1" stop-color="#1c1009"/></radialGradient>
          <filter id="mrGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <circle cx="${C}" cy="${C}" r="${R + 6}" fill="rgba(10,6,3,.55)" stroke="url(#mrGold)" stroke-width="6"/>
        ${segs}
        <circle cx="${C}" cy="${C}" r="${R - 30}" fill="url(#mrWood)" stroke="url(#mrGold)" stroke-width="5"/>
        <circle cx="${C}" cy="${C}" r="${R - 40}" fill="none" stroke="rgba(227,184,96,.35)" stroke-width="2" stroke-dasharray="3 7"/>
        ${ticks}
      </svg>`;
    const center = el("span", "mr-center");
    const willLabel = el("span", "mr-label", texts.menuWill);
    const willLevel = el("span", "mr-level gold-text", "0");
    const willProg = el("span", "mr-prog", "0 / 100");
    center.append(willLabel, willLevel, willProg);
    ring.append(center);
    nav.append(ring);

    // рейка с ромбами
    const TOP = 286, H = 62, GAP = 16, RAIL = 22, BTN_X = RAIL + 26;
    const lastY = TOP + (texts.menu.length - 1) * (H + GAP) + H / 2;
    const rail = document.createElementNS(svgNS, "svg");
    rail.setAttribute("class", "mr-rail");
    rail.setAttribute("width", "440");
    rail.setAttribute("height", String(lastY + 20));
    let railInner = `<path d="M${C} ${C + R + 6} L${C} ${TOP - 18} Q${C} ${TOP - 8} ${C - 10} ${TOP - 8} L${RAIL + 10} ${TOP - 8} Q${RAIL} ${TOP - 8} ${RAIL} ${TOP + 2} L${RAIL} ${lastY}" fill="none" stroke="url(#mrGold)" stroke-width="4"/>`;
    texts.menu.forEach((_, i) => {
      const y = TOP + i * (H + GAP) + H / 2;
      railInner += `<line x1="${RAIL}" y1="${y}" x2="${BTN_X}" y2="${y}" stroke="url(#mrGold)" stroke-width="4"/>`;
      railInner += `<rect x="${RAIL - 8}" y="${y - 8}" width="16" height="16" transform="rotate(45 ${RAIL} ${y})" fill="url(#mrGold)" stroke="#2a1a0e" stroke-width="2"/>`;
    });
    rail.innerHTML = railInner;
    nav.append(rail);

    let tasksMeta = null;
    texts.menu.forEach((entry, i) => {
      const button = actionButton("wood menu-item mr-item", entry.action ?? `modal:${entry.id}`);
      button.style.top = `${TOP + i * (H + GAP)}px`;
      button.style.left = `${BTN_X}px`;
      button.append(icon(entry.icon), el("span", "gold-text", entry.label));
      if (entry.id === "tasks") {
        tasksMeta = el("span", "mr-meta", "");
        button.append(tasksMeta);
      }
      nav.append(button);
    });
    box.append(nav);

    const segNodes = [...ring.querySelectorAll(".mr-seg")];
    function update(d) {
      if (!d) return;
      const will = d.will ?? { level: 0, progress: 0 };
      willLevel.textContent = String(will.level);
      const need = levelNeed(d.curve ?? d.max, will.level);
      willProg.textContent = `${will.progress} / ${need}`;
      const lit = Math.round((SEGS * will.progress) / need);
      segNodes.forEach((node, i) => node.classList.toggle("on", i < lit));
      if (tasksMeta) tasksMeta.textContent = `${d.done} ${texts.dailies.of} ${d.total}${d.closed ? " ✓" : ""}`;
    }
    update(lastDailies);
    document.addEventListener("hub:dailies", (event) => update(event.detail));
  },

  // Коло года с жерновом + меню столбиком (04.10.2026, claude/SPEC_KOLO.md)
  kolo(box, { texts, character }) {
    createKolo(box, { texts, character, getDailies: () => lastDailies, actionButton, icon });
  },

  characterCard(box, { texts, character }) {
    const card = el("section", "card");
    card.setAttribute("aria-label", texts.modals.character.title);

    const portrait = actionButton("wood portrait", "modal:character", texts.modals.character.title);
    const img = el("img");
    img.src = character.portrait;
    img.alt = "";
    img.draggable = false;
    portrait.append(img);

    const name = actionButton("wood arrow-plank card-name", "modal:character");
    name.append(el("span", "gold-text", character.name));

    // звание + отметка верификации (переехала сюда из плашки под заголовком)
    const title = el("div", "card-title");
    title.append(el("span", "card-title-text", character.title));
    if (character.verified) {
      const mark = el("span", "card-verified");
      mark.append(icon("check"), el("span", "", texts.verifiedShort));
      title.append(mark);
    }

    const skills = el("div", "card-skills");
    for (const skill of character.skills) {
      const row = actionButton("wood arrow-plank card-row", `modal:skill:${skill.id}`);
      row.append(icon(skill.icon), el("span", "gold-text", skill.name));
      skills.append(row);
    }

    const info = el("div", "card-info");
    info.append(name, title, skills);
    card.append(portrait, info);
    box.append(card);
    // пустые места карточки пропускают клик к слоям ниже (книга под табличкой имени)
    box.classList.add("passthrough");
  },

  // Ежедневные задания: полоса под главной табличкой, раскрывается в табличку с заданиями,
  // кошельком опыта и колбами. Спецификация — claude/SPEC_DAILIES.md (вариант А).
  dailies(box, ctx) {
    createDailies(box, ctx);
  },

  statusPlank(box, { texts, character }) {
    const plank = actionButton("wood plank status-plank", "modal:status");
    plank.append(el("span", "status-label", texts.statusLabel), el("span", "status-value", character.status));
    box.append(plank);
  },

  inventory(box, { texts, character }) {
    const panel = el("section", "wood inventory");
    panel.setAttribute("aria-label", texts.inventoryTitle);
    const body = el("div", "inventory-body");
    const silhouette = el("div", "silhouette");
    silhouette.append(icon("silhouette", ""));
    const grid = el("div", "inv-grid");
    for (const slot of character.inventory.slice(0, 8)) {
      const button = actionButton("inv-slot", "modal:inventory", slot.name);
      button.title = slot.name;
      button.append(icon(slot.icon));
      grid.append(button);
    }
    body.append(silhouette, grid);
    panel.append(el("div", "inventory-title gold-text", texts.inventoryTitle), body);
    box.append(panel);
  },

  locationPlank(box, { character }) {
    // нижняя табличка — точное место (Бельбекская долина); позже — по GPS
    const button = actionButton("wood plank plank-button location-plank", "modal:location");
    const loc = character.location || {};
    button.append(el("span", "gold-text location-name", loc.name || ""));
    box.append(button);
  },

  // верхняя табличка — крупная область (Полуостров Крым; в Петербурге будет своё), ведёт на карту мира
  planetPlank(box, { texts, character }) {
    const button = actionButton("wood plank plank-button location-plank", "world");
    const region = character.location?.region || texts.planet;
    button.setAttribute("aria-label", `${region} — ${texts.planet}`);
    button.append(el("span", "gold-text location-name", region));
    box.append(button);
  },

  planetMarker(box) {
    box.append(el("div", "planet-marker"));
    box.style.pointerEvents = "none";
  },

  // Планета-купол. Кликается только сам купол (.planet-hit, эллипс), а не прямоугольник картинки.
  planet(box, { texts }, item) {
    box.classList.add("planet");
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.src = item.src;
    if (item.fit) img.style.objectFit = item.fit;
    const hit = actionButton("planet-hit", "world", texts.planet);
    box.append(img);
    // туман войны поверх купола (item.fog): та же рамка, что у планеты, поэтому всегда совпадает с ней.
    // Облака «вращаются вместе с планетой»: картинка тумана натягивается на шар и медленно поворачивается.
    if (item.fog) {
      const fog = el("canvas", "planet-fog");
      if (typeof item.fogOpacity === "number") fog.style.setProperty("--fog-opacity", String(item.fogOpacity));
      box.append(fog);
      spinFog(fog, item);
    }
    box.append(hit);
  },

  // Книга — отдельный слой поверх фигуры. Кликается только сама книга (.book-hit), а не искры вокруг.
  book(box, { texts }, item) {
    box.classList.add("book");
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.src = item.src;
    if (item.fit) img.style.objectFit = item.fit;
    const hit = actionButton("book-hit", "modal:book", texts.book);
    box.append(img, hit);
  },
};

// ---------- ежедневные задания (v0.1, прогресс — в браузере) ----------

const DAILIES_KEY = "gibrid.dailies.v1";
// последнее состояние дейликов — для меню (кольцо Воли, счётчик «Задания»)
let lastDailies = null;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function freshFlasks(data) {
  return structuredClone(data.start.flasks);
}

function loadDailiesState(data) {
  const fresh = { day: todayKey(), wallet: data.start.wallet, earned: 0, flasks: freshFlasks(data), done: [], bought: [], closed: false, history: [], willTasks: {}, curveV: 2 };
  let saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem(DAILIES_KEY) ?? "null");
  } catch {
    saved = null;
  }
  if (!saved || typeof saved.wallet !== "number" || !saved.flasks) return fresh;
  // старые сохранения: добавляем то, чего в них не было (новые колбы, покупки, сдача дня)
  for (const key of data.flasks) saved.flasks[key] ??= structuredClone(data.start.flasks[key]);
  saved.done ??= [];
  saved.bought ??= [];
  saved.closed ??= false;
  saved.history ??= [];
  saved.willTasks ??= {};
  // 24.10: ровная шкала (каждый уровень = flaskMax очков) → лестница уровней; накопленные очки сохраняются
  if (saved.curveV !== 2) {
    for (const key of Object.keys(saved.flasks)) saved.flasks[key] = migrateFlask(data.levelCurve, saved.flasks[key], data.flaskMax);
    saved.curveV = 2;
  }
  // earned — опыт, заработанный за всё время (для достижений); для старых сохранений — по истории
  saved.earned ??= (saved.history.reduce((sum, h) => sum + (h.done ?? 0), 0) + saved.done.length) * data.reward;
  rollDay(saved, data);
  return saved;
}

// Новый день: прошлый день закрывается сам (если не сдан), отметки и покупки обнуляются.
// Кошелёк опыта и колбы остаются.
function rollDay(state, data) {
  if (state.day === todayKey()) return false;
  // attrs — сколько дел по каждому атрибуту (для итогов месяца в коло)
  const attrs = {};
  for (const id of state.done) {
    const attr = taskAttr(data, id);
    if (attr) attrs[attr] = (attrs[attr] ?? 0) + 1;
  }
  state.history.push({ day: state.day, done: state.done.length, ids: [...state.done], attrs, spent: state.bought.reduce((sum, b) => sum + b.price, 0), closedBy: state.closed ? "player" : "midnight", ...(state.willBonus ? { willBonus: state.willBonus } : {}) });
  state.history = state.history.slice(-400);
  state.day = todayKey();
  state.done = [];
  state.bought = [];
  state.closed = false;
  state.willBonus = 0;
  state.willTasks = {};
  return true;
}

function taskAttr(data, id) {
  for (const group of data.groups) for (const task of group.tasks) if (task.id === id) return task.attr;
  return null;
}

function saveDailiesState(state) {
  try {
    window.localStorage.setItem(DAILIES_KEY, JSON.stringify(state));
  } catch {
    // хранилище недоступно — прогресс живёт до перезагрузки страницы
  }
}

function createDailies(box, ctx) {
  const { texts, dailies: data, editMode } = ctx;
  const t = texts.dailies;
  const reward = data.reward;
  const curve = data.levelCurve;
  const W = data.will ?? { perTask: 1, lagging: 1, day: 5, green: 5, balance: 0.1 };
  const max = data.flaskMax;
  const state = loadDailiesState(data);
  // отстающая сила: её дробный уровень ниже, чем у пары (задание на неё — Воле ещё +1)
  const pairOf = Object.fromEntries((ctx.stats?.attrs ?? []).map((a) => [a.key, a.pair]));
  const lagging = (attr) => {
    const pair = pairOf[attr];
    if (!pair || !state.flasks[pair] || !state.flasks[attr]) return false;
    return fractionalLevel(curve, state.flasks[attr]) < fractionalLevel(curve, state.flasks[pair]);
  };
  saveDailiesState(state);
  box.classList.add("dailies-item");

  const strip = el("button", "wood plank dailies-strip");
  strip.type = "button";
  strip.setAttribute("aria-expanded", "false");
  const stripMeta = el("span", "dailies-meta");
  const chev = el("span", "dailies-chev", "▾");
  chev.setAttribute("aria-hidden", "true");
  strip.append(el("span", "gold-text", t.title), stripMeta, chev);

  const board = el("section", "wood dailies-board");
  board.hidden = true;
  board.id = "dailies-board";
  board.setAttribute("aria-label", t.title);
  strip.setAttribute("aria-controls", board.id);

  const toastNode = el("div", "dailies-toast");
  toastNode.setAttribute("role", "status");
  toastNode.setAttribute("aria-live", "polite");
  let toastTimer = 0;
  const toast = (text) => {
    toastNode.textContent = text;
    toastNode.classList.add("on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastNode.classList.remove("on"), 1800);
  };

  // верх: кошелёк + подсказка
  const top = el("div", "dailies-top");
  const walletValue = el("b", "");
  const wallet = el("div", "dailies-wallet");
  wallet.append(el("span", "", `${t.wallet}: `), walletValue);
  top.append(wallet, el("p", "dailies-hint", t.hint));

  // зелёные задания: графы 2×2
  const cols = el("div", "dailies-cols");
  let total = 0;
  const taskRows = [];
  const activeTasks = [];
  for (const group of data.groups) {
    const col = el("div", "dailies-col");
    col.append(el("h3", "", group.title));
    for (const task of group.tasks) {
      const row = el("label", "dailies-task");
      const check = el("input");
      check.type = "checkbox";
      row.append(check, el("span", "dailies-task-name", task.name));
      if (task.attr) row.append(el("span", `dailies-tag tag-${task.attr}`, t.attrShort[task.attr]));
      if (task.attr === "dev") {
        // атрибут в разработке: без награды, отметить нельзя
        row.classList.add("dev");
        check.disabled = true;
        col.append(row);
        continue;
      }
      total += 1;
      activeTasks.push({ id: task.id, attr: task.attr });
      row.append(el("span", "dailies-pts", `+${reward}`));
      check.addEventListener("change", () => {
        if (state.closed) return render();
        const sign = check.checked ? 1 : -1;
        state.wallet = Math.max(0, state.wallet + reward * sign);
        state.earned = Math.max(0, (state.earned ?? 0) + reward * sign);
        if (check.checked) state.done.push(task.id);
        else state.done = state.done.filter((id) => id !== task.id);
        // Воля — двигатель (24.10): за само дело понемногу, за отстающую силу пары — чуть больше
        if (check.checked) {
          const gain = W.perTask + (lagging(task.attr) ? W.lagging : 0);
          state.willTasks[task.id] = gain;
          addFlask("will", gain);
        } else {
          addFlask("will", -(state.willTasks[task.id] ?? W.perTask));
          delete state.willTasks[task.id];
        }
        if (data.flasks.includes(task.attr)) addFlask(task.attr, reward * sign);
        commit();
      });
      taskRows.push({ task, row, check });
      col.append(row);
    }
    col.append(el("div", "dailies-add", t.addOwn));
    cols.append(col);
  }

  // жёлтые траты + «куплено сегодня» с отменой
  const yellow = el("div", "dailies-yellow");
  const yellowHead = el("h3", "");
  yellowHead.append(el("span", "", t.yellowTitle), el("small", "", t.yellowHint));
  const buys = el("div", "dailies-buys");
  const buyButtons = [];
  for (const item of data.buys) {
    const button = el("button", "dailies-buy");
    button.type = "button";
    button.dataset.price = String(item.price);
    button.append(el("span", "", item.name), el("b", "", `−${item.price}`));
    button.addEventListener("click", () => {
      if (state.closed) return;
      if (state.wallet < item.price) return toast(t.notEnough);
      state.wallet -= item.price;
      state.bought.push({ id: item.id, name: item.name, price: item.price });
      toast(`${t.bought} ${item.name}`);
      commit();
    });
    buyButtons.push(button);
    buys.append(button);
  }
  const boughtList = el("div", "dailies-bought");
  yellow.append(yellowHead, buys, boughtList);

  // колбы (две колонки)
  const flasks = el("div", "dailies-flasks");
  const flaskNodes = {};
  for (const key of data.flasks) {
    const row = el("div", `dailies-flask flask-${key}`);
    const tube = el("div", "dailies-tube");
    const fill = el("div", "dailies-fill");
    const value = el("span", "dailies-tube-value");
    tube.append(fill, value);
    const level = el("div", "dailies-level");
    row.append(el("div", "dailies-flask-label", t.attrs[key]), tube, level);
    flaskNodes[key] = { fill, value, level };
    flasks.append(row);
  }

  // низ: сдать день
  const foot = el("div", "dailies-foot");
  const stamp = el("span", "dailies-stamp", t.submitted);
  const submit = el("button", "dailies-submit", t.submit);
  submit.type = "button";
  submit.addEventListener("click", () => {
    if (state.closed) return;
    state.closed = true;
    toast(`${t.dayClosed}: ${state.done.length} ${t.of} ${total}`);
    // Воля за доведение до конца (24.10): сдал день +day, сделано всё +green; день в равновесии — ещё +10 % дневной Воли
    if (state.done.length) {
      let dayWill = W.day + (state.done.length >= total ? W.green : 0);
      const fromTasks = Object.values(state.willTasks ?? {}).reduce((a, b) => a + b, 0);
      let balanceBonus = 0;
      if (ctx.stats?.balance && powersBalance(ctx.stats, state.flasks, curve).balanced) {
        balanceBonus = Math.max(1, Math.round((fromTasks + dayWill) * (W.balance ?? 0.1)));
        dayWill += balanceBonus;
      }
      addFlask("will", dayWill);
      state.willBonus = dayWill;
      window.setTimeout(() => toast(t.willDay.replace("{n}", String(dayWill))), 1600);
      if (balanceBonus) window.setTimeout(() => toast(t.willBonus.replace("{n}", String(balanceBonus))), 3200);
    }
    commit();
    document.dispatchEvent(new CustomEvent("hub:day-closed", { detail: { by: "player" } }));
  });
  foot.append(el("p", "dailies-hint", t.submitHint), stamp, submit);

  // админ-режим (?admin=1): временно, пока нет входа и ролей — потом только для роли admin
  const isAdmin = params.get("admin") === "1";
  const adminBar = el("div", "dailies-admin");
  adminBar.hidden = !isAdmin;
  const reopen = el("button", "dailies-admin-btn", t.adminReopen);
  reopen.type = "button";
  reopen.addEventListener("click", () => {
    if (!state.closed) return;
    state.closed = false;
    if (state.willBonus) addFlask("will", -state.willBonus);
    state.willBonus = 0;
    toast(t.adminReopened);
    commit();
  });
  const reset = el("button", "dailies-admin-btn", t.adminReset);
  reset.type = "button";
  let armed = false;
  let armTimer = 0;
  reset.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      reset.textContent = t.adminResetConfirm;
      reset.classList.add("armed");
      armTimer = window.setTimeout(() => {
        armed = false;
        reset.textContent = t.adminReset;
        reset.classList.remove("armed");
      }, 4000);
      return;
    }
    window.clearTimeout(armTimer);
    armed = false;
    reset.textContent = t.adminReset;
    reset.classList.remove("armed");
    state.wallet = data.start.wallet;
    state.earned = 0;
    state.flasks = freshFlasks(data);
    state.willBonus = 0;
    state.done = [];
    state.bought = [];
    state.closed = false;
    toast(t.adminDone);
    commit();
  });
  adminBar.append(el("span", "dailies-admin-label", t.adminLabel), reopen, reset);

  function addFlask(key, amount) {
    const flask = state.flasks[key];
    const up = addPoints(curve, flask, amount);
    for (let i = 0; i < up; i++) toast(t.levelUp[key]);
  }

  function renderBought() {
    boughtList.replaceChildren();
    state.bought.forEach((item, index) => {
      const row = el("div", "dailies-bought-row");
      row.append(el("span", "", `${t.boughtToday} ${item.name} (−${item.price})`));
      const undo = el("button", "dailies-undo", t.undo);
      undo.type = "button";
      undo.disabled = state.closed;
      undo.addEventListener("click", () => {
        if (state.closed) return;
        state.wallet += item.price;
        state.bought.splice(index, 1);
        toast(`${t.undone} ${item.name}, +${item.price} ${t.refund}`);
        commit();
      });
      row.append(undo);
      boughtList.append(row);
    });
  }

  function render() {
    walletValue.textContent = String(state.wallet);
    const doneCount = state.done.length;
    stripMeta.textContent = `${doneCount} ${t.of} ${total} · ${t.wallet.toLowerCase()} ${state.wallet}${state.closed ? " · ✓" : ""}`;
    for (const { task, row, check } of taskRows) {
      check.checked = state.done.includes(task.id);
      check.disabled = state.closed;
      row.classList.toggle("done", check.checked);
    }
    for (const button of buyButtons) button.disabled = state.closed || state.wallet < Number(button.dataset.price);
    for (const [key, node] of Object.entries(flaskNodes)) {
      const flask = state.flasks[key];
      const need = levelNeed(curve, flask.level);
      node.fill.style.width = `${(flask.progress / need) * 100}%`;
      node.value.textContent = `${flask.progress} / ${need}`;
      node.level.textContent = String(flask.level);
    }
    renderBought();
    lastDailies = { done: doneCount, total, closed: state.closed, will: state.flasks.will, max, curve, reward, tasks: activeTasks, doneIds: [...state.done], history: state.history, day: state.day, earned: state.earned ?? 0, flasks: state.flasks, start: data.start.flasks };
    document.dispatchEvent(new CustomEvent("hub:dailies", { detail: lastDailies }));
    board.classList.toggle("closed", state.closed);
    submit.disabled = state.closed;
    reopen.disabled = !state.closed;
  }

  function commit() {
    saveDailiesState(state);
    render();
  }

  // полночь: день закрывается сам, отметки обнуляются (проверка раз в минуту)
  window.setInterval(() => {
    if (rollDay(state, data)) {
      toast(t.newDay);
      commit();
      document.dispatchEvent(new CustomEvent("hub:day-closed", { detail: { by: "midnight" } }));
    }
  }, 60_000);

  // бонус за неделю/месяц (quests.js) — опыт в кошелёк; при отмене — назад (в минус нельзя)
  document.addEventListener("hub:add-exp", (event) => {
    const { amount, reason } = event.detail ?? {};
    if (!amount) return;
    state.wallet = Math.max(0, state.wallet + amount);
    state.earned = Math.max(0, (state.earned ?? 0) + amount);
    toast(`${reason} ${amount > 0 ? "+" : "−"}${Math.abs(amount)}`);
    commit();
  });

  // пункт меню «Задания» открывает/закрывает ту же табличку
  document.addEventListener("hub:dailies-toggle", () => strip.click());
  strip.addEventListener("click", () => {
    if (editMode) return;
    // 17.10 (автор): день, неделя и месяц — одно окно «Задания» на одном фоне; табличка открывает его на вкладке «День»
    if (ctx.questsUi) {
      document.dispatchEvent(new CustomEvent("hub:quests-open", { detail: { tab: "day" } }));
      return;
    }
    const open = board.hidden;
    board.hidden = !open;
    strip.setAttribute("aria-expanded", String(open));
    box.classList.toggle("is-open", open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !board.hidden) {
      board.hidden = true;
      strip.setAttribute("aria-expanded", "false");
      box.classList.remove("is-open");
      strip.focus();
    }
  });

  board.append(toastNode, top, cols, yellow, flasks, foot, adminBar);
  box.append(strip, board);
  render();
}

// ---------- эффекты с настройками из layout ----------

// Эффект по имени из layout (item.effect): элемент получает класс fx-<имя>, а здесь можно задать ему настройки.
// Сейчас эффекты обходятся одним CSS (например, fireflies). Старый «туман войны» (planet-fog) удалён 21.10.2026 —
// туман теперь встроен в саму планету (item.fog, spinFog).
const effects = {};

// ---------- сборка сцены ----------

function placeItem(node, item) {
  node.style.left = `${item.x}px`;
  node.style.top = `${item.y}px`;
  node.style.width = `${item.w}px`;
  node.style.height = `${item.h}px`;
}

// Точка, к которой блок интерфейса уменьшается при uiScale < 1 (остаётся у своего края).
const ANCHOR_ORIGINS = {
  "top-left": "0 0",
  "top-center": "50% 0",
  "top-right": "100% 0",
  "bottom-left": "0 100%",
  "bottom-center": "50% 100%",
  "bottom-right": "100% 100%",
};

function renderItem(item, ctx) {
  const node = el("div", "item");
  node.dataset.id = item.id;
  placeItem(node, item);
  // x, y, w, h — рамка блока в полном размере; uiScale уменьшает его к якорю вместе со шрифтами и рамками
  if (item.anchor) {
    const origin = ANCHOR_ORIGINS[item.anchor];
    if (!origin) throw new Error(`[hub] неизвестный якорь ${item.anchor} у элемента ${item.id}`);
    node.classList.add("ui-scaled");
    node.style.transformOrigin = origin;
  }
  // scale — свой размер блока поверх общего uiScale (1 = как есть; меняется колёсиком в ?edit=1)
  if (typeof item.scale === "number") node.style.setProperty("--item-scale", String(item.scale));
  if (item.anim) node.classList.add(`anim-${item.anim}`);
  // opacity — ослабить слой без правки картинки (0…1)
  if (typeof item.opacity === "number") node.style.opacity = String(item.opacity);
  if (item.lock) node.classList.add("locked");
  // visible: false — элемент есть в раскладке, но скрыт
  if (item.visible === false) node.hidden = true;
  if (item.action) {
    node.dataset.action = item.action;
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", item.action === "world" ? ctx.texts.planet : item.id);
  }

  if (item.kind === "image") {
    const img = el("img");
    img.alt = "";
    img.draggable = false;
    img.src = item.src;
    // fit: "contain" — картинка вписывается в рамку без растяжения
    if (item.fit) img.style.objectFit = item.fit;
    img.addEventListener("error", () => {
      node.classList.add("missing");
      node.textContent = item.src;
      console.warn(`[hub] нет файла слоя: ${item.src}`);
    });
    node.append(img);
  } else if (item.kind === "effect") {
    node.classList.add(`fx-${item.effect}`);
    effects[item.effect]?.(node, item);
  } else if (item.kind === "ui") {
    node.classList.add("ui");
    const render = components[item.component];
    if (!render) throw new Error(`[hub] неизвестный компонент: ${item.component}`);
    render(node, ctx, item);
  }
  return node;
}

function buildStage(stage, ctx) {
  const { layout } = ctx;
  stage.style.width = `${layout.stage.width}px`;
  stage.style.height = `${layout.stage.height}px`;
  stage.style.setProperty("--ui-scale", String(layout.uiScale ?? 1));
  const layerNodes = new Map();
  for (const layer of layout.layers) {
    const node = el("div", "layer");
    node.dataset.layer = layer.id;
    node.style.zIndex = String(layer.z);
    // blend — режим наложения всего слоя на сцену под ним (screen, soft-light …): так FX-слои красят сцену, но не интерфейс выше
    if (layer.blend) node.style.mixBlendMode = layer.blend;
    layerNodes.set(layer.id, node);
    stage.append(node);
  }
  for (const item of layout.items) {
    const layerNode = layerNodes.get(item.layer);
    if (!layerNode) throw new Error(`[hub] у элемента ${item.id} неизвестный слой ${item.layer}`);
    layerNode.append(renderItem(item, ctx));
  }
}

// Сцена вписывается в окно целиком; лишнее место — тёмные поля.
// На телефоне лёжа (phone.js) — наоборот, картина заполняет экран, а живое лежит поверх настоящими пикселями.
function fitStage(stage, layout) {
  const fit = document.documentElement.classList.contains("is-phone") ? Math.max : Math.min;
  const scale = fit(window.innerWidth / layout.stage.width, window.innerHeight / layout.stage.height);
  stage.style.transform = `scale(${scale}) translate(-50%, -50%)`;
  stage.dataset.scale = String(scale);
  return scale;
}

// ---------- окно-заглушка ----------

function createModal(stage, texts) {
  const backdrop = el("div", "modal-backdrop");
  backdrop.hidden = true;
  const dialog = el("div", "wood modal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "modal-title");
  const title = el("h2", "gold-text");
  title.id = "modal-title";
  const text = el("p");
  const body = el("div", "modal-body");
  const close = el("button", "modal-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", texts.close);
  dialog.append(close, title, text, body);
  backdrop.append(dialog);
  stage.append(backdrop);

  let returnFocus = null;
  const hide = () => {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    document.dispatchEvent(new CustomEvent("hub:modal-closed"));
    returnFocus?.focus();
  };
  close.addEventListener("click", hide);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });

  return {
    show(modalText, heading) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      title.textContent = heading ?? modalText.title;
      text.textContent = modalText.text;
      text.hidden = false;
      body.replaceChildren();
      dialog.className = "wood modal";
      backdrop.hidden = false;
      close.focus();
    },
    // окно с готовым содержимым (итоги месяца коло)
    showNode(heading, node, extraClass) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      title.textContent = heading;
      text.hidden = true;
      body.replaceChildren(node);
      dialog.className = `wood modal ${extraClass ?? ""}`.trim();
      backdrop.hidden = false;
      close.focus();
    },
    get open() {
      return !backdrop.hidden;
    },
  };
}

// ---------- действия ----------

// Переход на карту мира: камера «ныряет» в планету — вся сцена приближается к куполу
// (планета остаётся в колодце, ничего не отрывается), интерфейс гаснет, в конце — голубая вспышка.
const WORLD_MS = 1100;
function goToWorld(stage, layout) {
  if (stage.classList.contains("to-world")) return;
  const planet = layout.items.find((item) => item.component === "planet");
  if (planet) {
    const cx = ((planet.x + planet.w / 2) / layout.stage.width) * 100;
    const cy = ((planet.y + planet.h * 0.45) / layout.stage.height) * 100;
    stage.style.setProperty("--world-origin", `${cx.toFixed(2)}% ${cy.toFixed(2)}%`);
  }
  const ms = Math.max(layout.transitionMs ?? 0, WORLD_MS);
  stage.style.setProperty("--world-ms", `${ms}ms`);
  stage.append(el("div", "world-flash"));
  stage.classList.add("to-world");
  window.setTimeout(() => window.location.assign(layout.worldUrl), ms);
}

function handleAction(action, ctx) {
  if (action === "world") return goToWorld(ctx.stage, ctx.layout);
  if (action === "dailies") return document.dispatchEvent(new CustomEvent("hub:dailies-toggle"));
  if (action === "quests") return ctx.questsUi?.open();
  if (action === "achievements") return ctx.achievementsUi?.open();
  if (action === "stats") return ctx.statsUi?.open();
  if (action === "skills") return ctx.skillsUi?.open();
  if (action.startsWith("kolo-month:")) {
    const month = Number(action.split(":")[1]);
    if (!lastDailies) return;
    return ctx.modal.showNode(ctx.texts.kolo.monthTitle.replace("{m}", String(month)), monthStats(month, lastDailies, ctx), "modal-wide");
  }
  const [kind, id, subId] = action.split(":");
  if (kind !== "modal" || !id) return;
  const modalText = ctx.texts.modals[id];
  if (!modalText) return console.warn(`[hub] нет текста окна: ${id}`);
  let heading;
  if (id === "skill") heading = ctx.character.skills.find((skill) => skill.id === subId)?.name;
  ctx.modal.show(modalText, heading);
}

function bindActions(ctx) {
  ctx.stage.addEventListener("click", (event) => {
    if (ctx.editMode) return;
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    // и HTML-кнопки, и SVG-элементы (сектора месяцев на коло)
    if (target && target.dataset?.action) handleAction(target.dataset.action, ctx);
  });
  // элементы-картинки с действием (планета) — не кнопки, Enter/пробел обрабатываем сами
  ctx.stage.addEventListener("keydown", (event) => {
    if (ctx.editMode || (event.key !== "Enter" && event.key !== " ")) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("item") && target.dataset.action) {
      event.preventDefault();
      handleAction(target.dataset.action, ctx);
    }
  });
}

// ---------- запуск ----------

// Сброс прогресса в браузере: при смене DATA_EPOCH один раз стираются задания дня, задания недели/месяца,
// достижения и «виденные» уровни сил. Обучение (tour) не трогаем. Автор, 15.10: «всё с нуля, проставим отдельно».
const DATA_EPOCH = "2026-10-15-zero";
function resetProgressOnce() {
  try {
    if (window.localStorage.getItem("gibrid.dataEpoch") === DATA_EPOCH) return;
    for (const key of ["gibrid.dailies.v1", "gibrid.quests.v1", "gibrid.achievements.v1", "gibrid.stats.seen.v1"]) window.localStorage.removeItem(key);
    window.localStorage.setItem("gibrid.dataEpoch", DATA_EPOCH);
  } catch {
    // хранилище недоступно — и так всё с нуля
  }
}

async function main() {
  resetProgressOnce();
  const [layout, texts, character, dailies, quests, achievements, stats, skills] = await Promise.all([
    loadJson(`/hub/hub.layout${/^[a-z0-9-]+$/.test(params.get("layout") ?? "") ? "." + params.get("layout") : ""}.json`),
    loadJson("/hub/hub.texts.json"),
    loadJson("/hub/mock.character.json"),
    loadJson("/hub/dailies.json"),
    loadJson("/hub/quests.json"),
    loadJson("/hub/achievements.json"),
    loadJson("/hub/stats.json"),
    loadJson("/hub/skills.json"),
  ]);
  document.title = texts.pageTitle;

  const stage = document.getElementById("stage");
  const animationsOn = layout.animations !== false && params.get("anim") !== "0";
  document.body.classList.toggle("no-anim", !animationsOn);

  const ctx = { layout, texts, character, dailies, quests, achievements, stats, skills, stage, editMode: params.get("edit") === "1" };
  buildStage(stage, ctx);
  ctx.modal = createModal(stage, texts);
  ctx.questsUi = initQuests(ctx, () => lastDailies);
  ctx.achievementsUi = initAchievements(ctx, () => lastDailies);
  ctx.statsUi = initStats(ctx, () => lastDailies);
  ctx.skillsUi = initSkills(ctx, () => lastDailies);
  bindActions(ctx);

  fitStage(stage, layout);
  window.addEventListener("resize", () => fitStage(stage, layout));
  if (!ctx.editMode) initPhone(ctx, { refit: () => fitStage(stage, layout) });

  if (ctx.editMode) {
    const { startEditMode } = await import("./hub.edit.js");
    startEditMode(ctx, { placeItem, fitStage });
  }
  // Режим «Числа» (?admin=1): проверочные числа поверх настоящего прогресса; пока проверка идёт — полоса «ПРОВЕРКА»
  // хранилище браузера бывает закрыто (приватный режим, встроенные браузеры) — тогда обращение бросает ошибку (ревизия 24.10, п. 3.1)
  let sandboxSaved = false;
  try {
    sandboxSaved = window.localStorage.getItem("gibrid.admin.real") !== null;
  } catch {
    sandboxSaved = false;
  }
  if (!ctx.editMode && (params.get("admin") === "1" || sandboxSaved)) {
    const { startAdmin, showSandboxBanner, sandboxOn } = await import("./admin.js");
    if (params.get("admin") === "1") startAdmin(ctx);
    if (sandboxOn()) showSandboxBanner(texts);
  }
  // Мини-обучение при первом входе (в режиме правки не мешает).
  if (!ctx.editMode) {
    const { initTour } = await import("./tour.js");
    initTour(ctx);
  }
  // ?open=stats — сразу открыть окно (для скриншотов и проверки)
  if (params.get("open") === "stats") ctx.statsUi.open();
  if (params.get("open") === "skills") ctx.skillsUi.open();
  document.body.dataset.ready = "1";
}

main().catch((error) => {
  console.error("[hub] не удалось собрать хаб:", error);
  const message = el("p", "", `Не удалось загрузить хаб: ${error.message}`);
  message.style.cssText = "padding:24px;font-size:20px;color:#ffb39a";
  document.body.append(message);
});
