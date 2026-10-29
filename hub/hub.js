// Main Hub v0.1: собирает сцену из слоёв по hub.layout.json.
// Тексты — hub.texts.json, данные персонажа — mock.character.json (позже — API).
// Параметры адреса: ?edit=1 — режим правки раскладки, ?anim=0 — без анимаций.

import { createKolo, gradeDay, koloDate, monthStats } from "./kolo.js";
import { initQuests } from "./quests.js";
import { initAchievements } from "./achievements.js";
import { initStats, powersBalance } from "./stats.js";
import { initSkills, intellectOf, masteryNow } from "./skills.js";
import { initPhone } from "./phone.js";
import { addPoints, convertFlask, fractionalLevel, levelNeed, migrateFlask } from "./levels.js";
import { dayNum as dayNumOf, stepDown, stepStatus, stepUp } from "./steps.js";
import { initWallet } from "./wallet.js";
import { initCard } from "./card.js";
import { needAnketa, openAnketa, openHealth, startSteps } from "./anketa.js";
import { fill as fillMail, initMail, periodSummaries, postMail } from "./mail.js";

const params = new URLSearchParams(window.location.search);
// Админ-режим (автор, 27.10): на компьютере автора (localhost) включён всегда; на сайте — один раз открыть с ?admin=1,
// дальше браузер помнит. ?admin=0 — выключить (запоминается так же).
const LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const ADMIN = (() => {
  const q = params.get("admin");
  try {
    if (q === "1" || q === "0") window.localStorage.setItem("gibrid.admin.on", q);
    const saved = window.localStorage.getItem("gibrid.admin.on");
    return saved === "1" || (LOCAL && saved !== "0");
  } catch {
    return q === "1" || (LOCAL && q !== "0");
  }
})();
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

  // Почта (27.10, SPEC_MAIL.md): письма Мира и хранителей, число новых на кнопке
  mail(box, ctx) {
    initMail(box, ctx, icon, () => lastDailies);
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
      const need = levelNeed(d.willCurve ?? d.curve ?? d.max, will.level);
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

  // Кошелёк (27.10, SPEC_WALLET.md): «◈ В руке · ⧗ В закромах» в углу, нажатие — окно с Казной
  wallet(box, ctx) {
    initWallet(box, ctx, () => lastDailies);
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
  const fresh = { day: todayKey(), wallet: data.start.wallet, earned: 0, flasks: freshFlasks(data), done: [], bought: [], closed: false, history: [], willTasks: {}, curveV: 3, stepsV: 2, picked: defaultPicks(data, []), open: [...(data.open?.start ?? [])] };
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
  saved.sets ??= {};
  saved.steps ??= {};
  saved.dayGains ??= {};
  saved.dayFlasks ??= {};
  saved.setGains ??= {};
  // 26.10: «мои задания дня» — старым сохранениям: задания по умолчанию + то, что уже отмечено сегодня
  saved.picked ??= defaultPicks(data, saved.done);
  // 27.10: открытия — старым сохранениям ничего не закрываем: открыто всё, что уже выбирал или делал
  if (!saved.open) {
    const had = new Set([...(data.open?.start ?? []), ...saved.picked, ...saved.done, ...saved.history.flatMap((h) => h.ids ?? [])]);
    saved.open = [...had];
  }
  // 27.10: новые лестницы отжиманий и приседаний — переносим ступень на ту же по смыслу
  if (saved.stepsV !== 2) {
    const map = { pushups: [0, 2, 4, 4, 5], squats: [1, 2, 3, 4] };
    for (const [id, to] of Object.entries(map)) if (saved.steps[id]) saved.steps[id].step = to[saved.steps[id].step] ?? saved.steps[id].step;
    saved.stepsV = 2;
  }
  // 24.10: ровная шкала (каждый уровень = flaskMax очков) → лестница уровней; накопленные очки сохраняются
  // 28.10: только старые сохранения без лестницы (curveV < 2) — иначе каждая перезагрузка пересчитывала колбы заново и уровни росли сами
  if ((saved.curveV ?? 1) < 2) {
    for (const key of Object.keys(saved.flasks)) saved.flasks[key] = migrateFlask(data.levelCurve, saved.flasks[key], data.flaskMax);
    saved.curveV = 2;
  }
  // 25.10: у Воли своя лестница (втрое дороже) — очки Воли сохраняются, уровень пересчитывается
  if (saved.curveV === 2) {
    if (data.willCurve && saved.flasks.will) saved.flasks.will = convertFlask(data.levelCurve, data.willCurve, saved.flasks.will);
    saved.curveV = 3;
  }
  // earned — опыт, заработанный за всё время (для достижений); для старых сохранений — по истории
  saved.earned ??= (saved.history.reduce((sum, h) => sum + (h.done ?? 0), 0) + saved.done.length) * data.reward;
  rollDay(saved, data);
  return saved;
}

// Новый день: прошлый день закрывается сам (если не сдан), отметки и покупки обнуляются.
// Кошелёк опыта и колбы остаются.
// запись дня в историю (общая для полуночи, «Сдать вчера» и «Не смог отметить вовремя»)
function dayRecord(src, data, closedBy) {
  const attrs = {};
  for (const id of src.done) {
    const attr = taskAttr(data, id);
    if (attr) attrs[attr] = (attrs[attr] ?? 0) + 1;
  }
  return { day: src.day, done: src.done.length, ids: [...src.done], attrs, spent: (src.bought ?? []).reduce((sum, b) => sum + b.price, 0), closedBy, ...(src.willBonus ? { willBonus: src.willBonus } : {}), ...(src.sets && Object.keys(src.sets).length ? { sets: { ...src.sets } } : {}), gains: { ...(src.dayGains ?? {}) }, bought: (src.bought ?? []).map((b) => ({ name: b.name, price: b.price })) };
}

// «Вчера ждёт до полудня» (автор, 28.10): уснул, не было света — несданный день не сгорает в полночь,
// а ждёт до 12:00 следующего дня: можно дописать и сдать. После полудня закрывается сам, как раньше.
const PENDING_UNTIL = 12;
const isYesterday = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  const prev = new Date();
  prev.setDate(prev.getDate() - 1);
  return y === prev.getFullYear() && m === prev.getMonth() + 1 && d === prev.getDate();
};
function closePending(state, data) {
  if (!state.pending) return false;
  if (isYesterday(state.pending.day) && new Date().getHours() < PENDING_UNTIL) return false;
  state.history.push(dayRecord(state.pending, data, "midnight"));
  state.history = state.history.slice(-400);
  state.pending = null;
  return true;
}

function rollDay(state, data) {
  const closedOld = closePending(state, data);
  if (state.day === todayKey()) return closedOld;
  if (!state.closed && isYesterday(state.day) && new Date().getHours() < PENDING_UNTIL) {
    state.pending = { day: state.day, picked: [...(state.picked ?? [])], done: [...state.done], sets: { ...(state.sets ?? {}) }, dayGains: { ...(state.dayGains ?? {}) }, bought: [...state.bought], willBonus: state.willBonus ?? 0 };
  } else {
    state.history.push(dayRecord(state, data, state.closed ? "player" : "midnight"));
  }
  state.history = state.history.slice(-400);
  state.day = todayKey();
  state.done = [];
  state.bought = [];
  state.closed = false;
  state.willBonus = 0;
  state.willTasks = {};
  state.sets = {};
  state.setGains = {};
  state.dayGains = {};
  state.dayFlasks = {};
  return true;
}

function taskAttr(data, id) {
  for (const group of data.groups) for (const task of group.tasks) if (task.id === id) return task.attr;
  for (const task of data.retired ?? []) if (task.id === id) return task.attr; // снятые задания — для старой истории
  return null;
}

// «мои задания дня» по умолчанию (26.10): из dailies.json → pick.default, плюс уже отмеченные сегодня; не больше max
function defaultPicks(data, done) {
  const ids = new Set(data.groups.flatMap((g) => g.tasks).map((task) => task.id));
  const out = [...(data.pick?.default ?? [])].filter((id) => ids.has(id));
  for (const id of done ?? []) if (ids.has(id) && !out.includes(id)) out.push(id);
  return out.slice(0, data.pick?.max ?? 10);
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
  const willCurve = data.willCurve ?? curve;
  const curveOf = (key) => (key === "will" ? willCurve : curve);
  const W = data.will ?? { perTask: 1, lagging: 1, day: { red: 1, yellow: 5, green: 12 }, balance: 0.1 };
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
  const libBtn = el("button", "dailies-lib-btn");
  libBtn.type = "button";
  libBtn.setAttribute("aria-expanded", "false");
  // «вчера ждёт до полудня» (28.10): спрятано — появляется только когда вчерашний день не сдан
  const ydayBtn = el("button", "dailies-yday-btn");
  ydayBtn.type = "button";
  ydayBtn.hidden = true;
  top.append(wallet, el("p", "dailies-hint", t.hint), ydayBtn, libBtn);

  // «мои задания дня» (26.10): человек выбирает 6–10 дел из библиотеки; справа — сама библиотека по силам
  const cols = el("div", "dailies-cols with-lib");
  const mine = el("div", "dailies-mine");
  const lib = el("div", "dailies-lib");
  cols.append(mine, lib);
  const L = t.library ?? {};
  const pick = { min: data.pick?.min ?? 6, max: data.pick?.max ?? 10 };
  const allTasks = data.groups.flatMap((g) => g.tasks).filter((task) => task.attr && task.attr !== "dev");
  // задание → сила, и для снятых заданий (график карточки, 29.10)
  const attrMap = Object.fromEntries([...(data.retired ?? []), ...data.groups.flatMap((g) => g.tasks)].filter((x) => x.attr).map((x) => [x.id, x.attr]));
  const byId = Object.fromEntries(allTasks.map((task) => [task.id, task]));
  // открытия (27.10, SPEC_PROGRAMS §10): старт с малого, следующее дело дорожки мир открывает сам
  const O = data.open ?? null;
  state.open ??= O ? [...O.start] : allTasks.map((x) => x.id);
  const isOpen = (id) => !O || state.open.includes(id);
  const openIds = () => allTasks.map((x) => x.id).filter(isOpen);
  const openPrev = (id) => {
    for (const ids of Object.values(O?.order ?? {})) {
      const i = ids.indexOf(id);
      if (i > 0) return ids[i - 1];
    }
    return null;
  };
  // какой уровень силы нужен, чтобы открылось дело: 2-е в дорожке — levels[0], 3-е — levels[1]…
  const needLevel = (id) => {
    for (const ids of Object.values(O?.order ?? {})) {
      const i = ids.indexOf(id);
      if (i > 0) return (O.levels ?? [])[i - 1] ?? Infinity;
    }
    return Infinity;
  };
  // открывается (27.10, автор: «было 5 силы — стало 10 — вот и новое упражнение»): сила дорожки доросла до уровня
  function checkOpen() {
    if (!O) return false;
    let any = false;
    for (const ids of Object.values(O.order ?? {})) {
      const next = ids.find((id) => !state.open.includes(id));
      if (!next || !byId[next] || !openPrev(next)) continue;
      const attr = byId[next].attr;
      if ((state.flasks[attr]?.level ?? 0) < needLevel(next)) continue;
      state.open = [...state.open, next];
      state.openedAt = { ...(state.openedAt ?? {}), [next]: state.day }; // для значков на графике карточки (29.10)
      if (!state.picked.includes(next) && state.picked.length < (data.pick?.max ?? 10)) state.picked = [...state.picked, next];
      const M = ctx.texts.mail ?? {};
      const task = byId[next];
      const power = t.attrs[task.attr] ?? task.attr;
      const lvl = needLevel(next);
      const say = fillMail(M.openText, { name: task.name, power, lvl });
      postMail({ key: `open-${next}`, from: "mir", title: fillMail(M.openTitle, { name: task.name }), text: say, parts: [{ t: "open", attr: task.attr, name: task.name, power, text: say }] });
      any = true;
    }
    return any;
  }
  let total = 0;
  let taskRows = [];
  let activeTasks = [];

  // Воля (25.10): +1 за дело один раз, за отстающую силу пары — ещё +1
  function willOn(task) {
    const gain = W.perTask + (lagging(task.attr) ? W.lagging : 0);
    state.willTasks[task.id] = gain;
    addFlask("will", gain);
  }
  function willOff(task) {
    addFlask("will", -(state.willTasks[task.id] ?? W.perTask));
    delete state.willTasks[task.id];
  }
  function earn(task, amount) {
    // приход по делам за сегодня — для истории Казны (кошелёк, 27.10)
    const g = (state.dayGains?.[task.id] ?? 0) + amount;
    state.dayGains = { ...(state.dayGains ?? {}), [task.id]: g };
    if (g <= 0) delete state.dayGains[task.id];
    state.wallet = Math.max(0, state.wallet + amount);
    state.earned = Math.max(0, (state.earned ?? 0) + amount);
    if (data.flasks.includes(task.attr)) addFlask(task.attr, amount);
  }
  // подходы «+N» (26.10, SPEC_PROGRAMS §2): 1-й подход — полная награда, дальше 60/40/25/15 %, на 5-м — потолок дня
  const SETS = data.sets ?? { share: [1, 0.6, 0.4, 0.25, 0.15], levels: { light: 1, medium: 3, hard: 5 } };
  const setGain = (i) => Math.max(1, Math.round(reward * (SETS.share[i] ?? 0)));
  // «Бережно» (анкета, 28.10): до 3 подходов — и это полная мера дня
  let setsMax = state.careful ? 3 : SETS.share.length;

  function makeRow(task) {
    if (task.kind === "rep" || task.kind === "time") return makeSetsRow(task);
    const row = el("label", "dailies-task");
    const check = el("input");
    check.type = "checkbox";
    row.append(check, el("span", "dailies-task-name", task.name));
    row.append(el("span", `dailies-tag tag-${task.attr}`, t.attrShort[task.attr]));
    row.append(el("span", "dailies-pts", `+${reward}`));
    if (task.check) row.title = `Чем проверить: ${task.check}`;
    check.addEventListener("change", () => {
      if (state.closed) return render();
      const sign = check.checked ? 1 : -1;
      earn(task, reward * sign);
      if (check.checked) state.done.push(task.id);
      else state.done = state.done.filter((id) => id !== task.id);
      if (check.checked) willOn(task);
      else willOff(task);
      commit();
    });
    const update = () => {
      check.checked = state.done.includes(task.id);
      check.disabled = state.closed;
      row.classList.toggle("done", check.checked);
    };
    taskRows.push({ task, row, update });
    return row;
  }

  // ступени (27.10, hub/steps.js): у задания с подходами — лестница движений; запись ступени — state.steps[id]
  state.steps ??= {};
  state.setGains ??= {};
  const stepEntry = (task) => (state.steps[task.id] ??= { step: task.step ?? 0, since: state.day });
  const stepInfo = (task) => {
    const entry = stepEntry(task);
    const ladder = task.steps ?? [];
    const cur = ladder[entry.step] ?? { name: task.name, n: task.n };
    const status = ladder.length
      ? stepStatus(data.stepRule, task.id, entry, state.history, state.day, { setsMax, last: ladder.length - 1, restricted: data.stepRule?.restricted || state.careful })
      : { offer: false, auto: false, mult: 1, canReturn: false };
    return { entry, cur, status };
  };
  // мир поднимает сам: 5 недель с делом или 12 «сложных» дней из 14 (письмом — когда будет почта; пока — всплывашкой)
  const raisedNow = [];
  for (const task of allTasks) {
    if (!task.steps?.length || !state.picked.includes(task.id)) continue;
    const { entry, cur, status } = stepInfo(task);
    const M = ctx.texts.mail ?? {};
    if (status.auto && !(state.sets?.[task.id] > 0)) {
      state.steps[task.id] = stepUp(entry, state.day);
      const name = task.steps[state.steps[task.id].step]?.name ?? task.name;
      raisedNow.push(name);
      postMail({ key: `step-${task.id}-${state.steps[task.id].step}-raised`, from: "mera", title: M.raisedTitle, text: fillMail(M.raisedText, { name }), parts: [{ t: "mera", kind: "raised", text: fillMail(M.raisedText, { name }) }] });
    } else if (status.offer) {
      // письмо Хранителя меры «пора выше» — один раз на ступень
      const next = task.steps[(entry.step ?? 0) + 1]?.name ?? "";
      postMail({ key: `step-${task.id}-${entry.step}-${entry.since}-offer`, from: "mera", title: M.stepTitle, text: fillMail(M.stepText, { name: cur.name, next }), parts: [{ t: "mera", kind: "step", text: fillMail(M.stepShort, { name: cur.name, next }), task: task.id, step: entry.step ?? 0, name: cur.name, next }] });
    }
  }

  // анкета входа (28.10, SPEC_HEALTH §2): при первом открытии «Заданий» — сначала анкета
  document.addEventListener("hub:quests-open", (event) => {
    if (!needAnketa()) return;
    event.stopImmediatePropagation();
    openAnketa(ctx);
  });
  document.addEventListener("hub:open-health", () => openHealth(ctx));
  document.addEventListener("hub:anketa-done", (event) => {
    const { profile: P, again, wiped } = event.detail ?? {};
    state.careful = Boolean(P?.careful);
    setsMax = state.careful ? 3 : SETS.share.length;
    if (!wiped) {
      for (const [id, step] of Object.entries(startSteps(P))) if (byId[id]) state.steps[id] = { step, since: state.day };
      // 60+: Ловкость начинается с равновесия (ВОЗ, Otago) — растяжка остаётся в библиотеке
      if (["60-74", "75+"].includes(P?.age) && byId.balance && !state.open.includes("balance")) {
        state.open = [...state.open, "balance"];
        if (!state.done.includes("stretch")) state.picked = state.picked.filter((id) => id !== "stretch");
        if (!state.picked.includes("balance")) state.picked = [...state.picked, "balance"];
      }
    }
    if (!again) {
      const A = ctx.texts.anketa ?? t.anketa ?? {};
      const text = [A.trainerHello, P?.careful ? A.trainerDoctor : ""].filter(Boolean).join("\n\n");
      postMail({ key: "trainer-hello", from: "mera", title: A.trainerTitle, text, parts: [{ t: "mera", kind: "hello", text }] });
    }
    buildTasks();
    commit();
  });

  // при входе: мир мог открыть новое, пока человека не было
  if (checkOpen()) saveDailiesState(state);

  function makeSetsRow(task) {
    const S = t.sets ?? {};
    const ui = data.setsUi ?? "roman"; // «roman» — подходы табличками I II III IV V (автор, 27.10); «dots» — кружки; «button» — кнопка «+20»
    const row = el("div", `dailies-task dailies-sets ui-${ui}`);
    row.dataset.task = task.id;
    const name = el("span", "dailies-task-name");
    const title = el("span", "");
    const info = el("span", "dailies-sets-info");
    const stepUpBtn = el("button", "dailies-step-btn up", S.up ?? "");
    stepUpBtn.type = "button";
    const stepDownBtn = el("button", "dailies-step-btn down", S.down ?? "");
    stepDownBtn.type = "button";
    const steps = el("span", "dailies-step-acts");
    steps.append(stepUpBtn, stepDownBtn);
    name.append(title, info, steps);
    const dots = el("span", "dailies-dots");
    dots.setAttribute("aria-hidden", "true");
    const dotNodes = [];
    for (let i = 0; i < setsMax; i++) {
      const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
      const dot = el(ui === "dots" || ui === "roman" ? "button" : "span", `dailies-dot${Object.values(SETS.levels).includes(i + 1) ? " big" : ""}`, ui === "roman" ? ROMAN[i] : undefined);
      if (ui === "dots" || ui === "roman") {
        dot.type = "button";
        dot.addEventListener("click", () => (i === count() ? plus.click() : i === count() - 1 ? undo.click() : null));
      }
      dotNodes.push(dot);
      dots.append(dot);
    }
    const undo = el("button", "dailies-undo-set", "↶");
    undo.type = "button";
    undo.setAttribute("aria-label", S.undo ?? "");
    const plus = el("button", "dailies-plus");
    plus.type = "button";
    const pts = el("span", "dailies-pts");
    // сила видна по графе — у строк с подходами метки нет, чтобы название влезало в одну строку (27.10)
    row.append(name, dots, undo, plus, pts);
    if (task.check) row.title = `Чем проверить: ${task.check}`;
    const count = () => state.sets?.[task.id] ?? 0;
    // награда за подход: убывает по подходам и тает, когда тело привыкло к ступени (mult)
    const gainNow = (c) => Math.max(1, Math.round(reward * (SETS.share[c] ?? 0) * stepInfo(task).status.mult));
    plus.addEventListener("click", () => {
      const c = count();
      if (state.closed || c >= setsMax) return;
      const gain = gainNow(c);
      state.sets = { ...(state.sets ?? {}), [task.id]: c + 1 };
      state.setGains[task.id] = [...(state.setGains[task.id] ?? []), gain];
      earn(task, gain);
      if (c === 0) {
        state.done.push(task.id);
        willOn(task);
      } else {
        // Воля за подходы (автор, 27.10): +1 за каждый следующий подход, а закрыл все — ещё бонус
        const w = (W.perSet ?? 1) + (c + 1 >= setsMax ? W.hardBonus ?? 2 : 0);
        state.willTasks[task.id] = (state.willTasks[task.id] ?? 0) + w;
        addFlask("will", w);
      }
      commit();
    });
    undo.addEventListener("click", () => {
      const c = count();
      if (state.closed || c <= 0) return;
      const gains = [...(state.setGains[task.id] ?? [])];
      const back = gains.pop() ?? gainNow(c - 1);
      state.setGains[task.id] = gains;
      state.sets = { ...(state.sets ?? {}), [task.id]: c - 1 };
      earn(task, -back);
      if (c === 1) {
        state.done = state.done.filter((id) => id !== task.id);
        willOff(task);
      } else {
        const w = (W.perSet ?? 1) + (c >= setsMax ? W.hardBonus ?? 2 : 0);
        state.willTasks[task.id] = Math.max(0, (state.willTasks[task.id] ?? 0) - w);
        addFlask("will", -w);
      }
      commit();
    });
    stepUpBtn.addEventListener("click", () => {
      if (state.closed) return;
      state.steps[task.id] = stepUp(stepEntry(task), state.day);
      toast(fill(S.raised, { name: stepInfo(task).cur.name }));
      commit();
    });
    stepDownBtn.addEventListener("click", () => {
      if (state.closed) return;
      state.steps[task.id] = stepDown(stepEntry(task), state.day, data.stepRule);
      toast(fill(S.lowered, { name: stepInfo(task).cur.name }));
      commit();
    });
    const update = () => {
      const c = count();
      const { cur, status } = stepInfo(task);
      title.textContent = ui !== "button" ? `${cur.name} · ${S.per ?? "по"} ${cur.n}${task.time ? ` ${S.min ?? "мин"}` : ""}` : cur.name;
      plus.textContent = task.time ? `+${cur.n} ${S.min ?? "мин"}` : `+${cur.n}`;
      plus.setAttribute("aria-label", `${cur.name}: ${S.add ?? ""}`);
      dotNodes.forEach((d, i) => {
        d.classList.toggle("on", i < c);
        d.classList.toggle("next", i === c && !state.closed);
        if (ui !== "button") {
          d.disabled = state.closed || (i !== c && i !== c - 1);
          d.setAttribute("aria-label", i === c ? `${cur.name}: ${S.add ?? ""} ${i + 1}` : i === c - 1 ? S.undo ?? "" : `${i + 1}`);
        }
      });
      const level = c >= SETS.levels.hard ? S.hard : c >= SETS.levels.medium ? S.medium : c >= SETS.levels.light ? S.light : "";
      const parts = [];
      if (c) parts.push(`${level} ✓ · ${c * cur.n} ${S.of ?? "из"} ${setsMax * cur.n} ${task.unit ?? ""}`);
      if (status.mult < 1) parts.push(fill(S.tired, { p: Math.round(status.mult * 100) }));
      info.textContent = parts.join(" · ");
      stepUpBtn.hidden = !status.offer || state.closed;
      stepDownBtn.hidden = !status.canReturn || state.closed;
      plus.disabled = state.closed || c >= setsMax;
      undo.disabled = state.closed || c <= 0;
      undo.hidden = c <= 0;
      pts.textContent = c >= setsMax ? S.cap ?? "" : `+${gainNow(c)}`;
      row.classList.toggle("done", c > 0);
      row.classList.toggle("capped", c >= setsMax);
    };
    taskRows.push({ task, row, update });
    return row;
  }

  function togglePick(id) {
    if (state.closed || state.done.includes(id)) return;
    if (state.picked.includes(id)) state.picked = state.picked.filter((p) => p !== id);
    else if (state.picked.length < pick.max) state.picked = [...state.picked, id];
    else return toast(fill(L.full, { max: pick.max }));
    buildTasks();
    commit();
  }

  function buildTasks() {
    taskRows = [];
    activeTasks = [];
    mine.replaceChildren();
    const picked = state.picked.filter((id) => byId[id]);
    total = picked.length;
    for (const group of data.groups) {
      const tasks = group.tasks.filter((task) => picked.includes(task.id));
      if (!tasks.length) continue;
      const col = el("div", "dailies-col");
      col.append(el("h3", "", group.title));
      for (const task of tasks) {
        activeTasks.push({ id: task.id, attr: task.attr });
        col.append(makeRow(task));
      }
      mine.append(col);
    }
    if (!total) mine.append(el("p", "dailies-empty", L.none ?? ""));
    buildLib();
  }

  // библиотека: все задания по силам, нажатие — взять или убрать (перерисовывается при каждой отметке: замки «сделано»)
  function buildLib() {
    const picked = state.picked.filter((id) => byId[id]);
    lib.replaceChildren();
    const head = el("div", "dailies-lib-head");
    head.append(el("h3", "", L.title ?? ""), el("span", "dailies-lib-count", fill(L.picked, { n: total, max: pick.max })));
    const emptyPower = data.groups.find((g) => !g.tasks.some((task) => picked.includes(task.id)));
    const keeper = el("p", "dailies-keeper");
    keeper.append(el("b", "", `${L.keeper ?? ""}: `), document.createTextNode(emptyPower ? fill(L.empty, { power: emptyPower.title }) : L.ok ?? ""));
    lib.append(head, keeper);
    if (state.closed) lib.append(el("p", "dailies-lib-warn", L.closed ?? ""));
    else if (total < Math.min(pick.min, openIds().length)) lib.append(el("p", "dailies-lib-warn", fill(L.tooFew, { min: Math.min(pick.min, openIds().length) })));
    else if (total >= pick.max) lib.append(el("p", "dailies-lib-warn", fill(L.full, { max: pick.max })));
    const grid = el("div", "dailies-lib-groups");
    lib.append(grid);
    // «Моё здоровье» (анкета, 28.10): пройти заново или стереть
    const health = el("button", "dailies-health-link", L.health ?? "");
    health.type = "button";
    health.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:open-health")));
    lib.append(health);
    // графы по силам — как в окне заданий (автор, 27.10); программы «в разработке» видны, но взять их пока нельзя
    for (const group of data.groups) {
      const box = el("div", "dailies-col dailies-lib-col");
      box.append(el("h3", "", group.title));
      for (const task of group.tasks) {
        const dev = task.attr === "dev";
        const shut = !dev && !isOpen(task.id);
        const on = !dev && !shut && picked.includes(task.id);
        const locked = on && state.done.includes(task.id);
        const row = el("button", `dailies-task dailies-lib-row${on ? " on" : ""}${dev ? " dev" : ""}${shut ? " shut" : ""}`);
        row.type = "button";
        row.append(el("span", "dailies-lib-mark", dev ? "·" : shut ? "🔒" : on ? "✓" : "+"), el("span", "dailies-task-name", shut ? L.mystery ?? "???" : task.name));
        if (shut) {
          // «одна тайна впереди» (автор, 27.10): видно только следующее дело — без названия; дальше — ничего
          const track = Object.values(O?.order ?? {}).find((ids) => ids.includes(task.id));
          if (!track || track.find((id) => !isOpen(id)) !== task.id) continue;
          const lvl = needLevel(task.id);
          const power = t.attrs[task.attr] ?? task.attr;
          row.append(el("span", "dailies-lib-hint", Number.isFinite(lvl) ? fill(L.lockHint, { power, lvl }) : L.lockSoon ?? ""));
          if (Number.isFinite(lvl)) row.title = fill(L.lockTitle, { power, lvl, now: state.flasks[task.attr]?.level ?? 0 });
          row.disabled = true;
          box.append(row);
          continue;
        }
        if (dev) row.append(el("span", "dailies-tag tag-dev", t.attrShort.dev ?? "")); // сила видна по графе — метка только у «в разработке»
        row.setAttribute("aria-pressed", on ? "true" : "false");
        row.disabled = dev || state.closed || locked || (!on && total >= pick.max);
        if (locked) row.title = L.locked ?? "";
        else if (!dev && task.check) row.title = `Чем проверить: ${task.check}`;
        if (!dev) row.addEventListener("click", () => togglePick(task.id));
        box.append(row);
      }
      grid.append(box);
    }
  }
  // библиотека — отдельным входом (автор, 27.10): окно заданий как было, кнопка открывает библиотеку на его месте
  const setLib = (open) => {
    if (open && board.classList.contains("weak-open")) setWeak(false);
    if (open) board.classList.remove("yday-open");
    board.classList.toggle("lib-open", open);
    libBtn.setAttribute("aria-expanded", open ? "true" : "false");
    libBtn.textContent = open ? L.close ?? "" : L.open ?? "";
  };
  libBtn.addEventListener("click", () => setLib(!board.classList.contains("lib-open")));
  setLib(false);
  const fill = (tpl, v) => String(tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
  buildTasks();
  if (raisedNow.length) window.setTimeout(() => toast(fill(t.sets?.raisedAuto, { name: raisedNow.join(", ") })), 1200);

  // слабости (27.10, автор: «в красивую табличку, как и всё»): в полосе — итог дня и вход; таблица — на месте заданий, как библиотека.
  // Табак и алкоголь — по количеству; одна ступень на слабость в день: другая — доплата/возврат разницы, та же — отмена.
  const WK = t.weak ?? {};
  const buyList = (data.buys ?? []).map((b) => ({ ...b, tiers: b.tiers ?? [{ id: "1", label: "", price: b.price }] }));
  const yellow = el("div", "dailies-yellow");
  const yellowHead = el("h3", "");
  yellowHead.append(el("span", "", t.yellowTitle), el("small", "", t.yellowHint));
  const weakSum = el("div", "dailies-weak-sum");
  const weakBtn = el("button", "dailies-lib-btn dailies-weak-btn");
  weakBtn.type = "button";
  yellow.append(yellowHead, weakSum, weakBtn);
  const weak = el("div", "dailies-weak");
  cols.append(weak);
  const boughtOf = (id) => state.bought.find((b) => b.id === id);
  function chooseTier(item, tier) {
    if (state.closed) return;
    const had = boughtOf(item.id);
    if (had && had.tier === tier.id) {
      state.wallet += had.price;
      state.bought = state.bought.filter((b) => b !== had);
      toast(`${t.undone} ${had.name}, +${had.price} ${t.refund}`);
      return commit();
    }
    const back = had?.price ?? 0;
    if (state.wallet + back < tier.price) return toast(t.notEnough);
    state.wallet += back - tier.price;
    const name = tier.label ? `${item.name} · ${tier.label}` : item.name;
    state.bought = [...state.bought.filter((b) => b !== had), { id: item.id, tier: tier.id, name, price: tier.price }];
    toast(`${t.bought} ${name}`);
    commit();
  }
  function buildWeak() {
    weak.replaceChildren();
    const spent = state.bought.reduce((sum, b) => sum + b.price, 0);
    const head = el("div", "dailies-lib-head");
    head.append(el("h3", "", t.yellowTitle), el("span", "dailies-lib-count", spent ? fill(WK.spent, { n: spent }) : WK.clean ?? ""));
    weak.append(head, el("p", "dailies-weak-hint", t.yellowHint));
    const grid = el("div", "dailies-weak-grid");
    for (const item of buyList) {
      const had = boughtOf(item.id);
      const card = el("div", `dailies-weak-card${had ? " on" : ""}`);
      const top = el("div", "dailies-weak-top");
      top.append(el("b", "dailies-weak-name", item.name));
      if (had) top.append(el("span", "dailies-weak-paid", `−${had.price}`));
      card.append(top);
      if (item.note) card.append(el("span", "dailies-weak-note", item.note));
      const tiers = el("div", "dailies-weak-tiers");
      for (const tier of item.tiers) {
        const on = had?.tier === tier.id;
        const btn = el("button", `dailies-weak-tier${on ? " on" : ""}`);
        btn.type = "button";
        btn.append(el("span", "", tier.label || WK.was || ""), el("b", "", `−${tier.price}`));
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.disabled = state.closed || (!on && state.wallet + (had?.price ?? 0) < tier.price);
        btn.addEventListener("click", () => chooseTier(item, tier));
        tiers.append(btn);
      }
      card.append(tiers);
      if (item.fact) card.append(el("p", "dailies-weak-fact", item.fact));
      grid.append(card);
    }
    weak.append(grid);
    // полоса: что ушло сегодня
    weakSum.replaceChildren();
    if (!state.bought.length) weakSum.append(el("span", "dailies-weak-clean", WK.clean ?? ""));
    for (const b of state.bought) weakSum.append(el("span", "dailies-weak-chip", `${b.name} −${b.price}`));
  }
  function setWeak(open) {
    if (open) setLib(false);
    if (open) board.classList.remove("yday-open");
    board.classList.toggle("weak-open", open);
    weakBtn.setAttribute("aria-expanded", open ? "true" : "false");
    weakBtn.textContent = open ? L.close ?? "" : WK.open ?? "";
  }
  weakBtn.addEventListener("click", () => setWeak(!board.classList.contains("weak-open")));
  setWeak(false);

  // ---------- вчерашний день: дописать и сдать до 12:00 ----------
  const YD = t.yesterday ?? {};
  const yday = el("div", "dailies-yday");
  cols.append(yday);
  const ydayLabel = (key) => {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  };
  function setYday(open) {
    if (open) {
      setLib(false);
      if (board.classList.contains("weak-open")) setWeak(false);
    }
    board.classList.toggle("yday-open", open && Boolean(state.pending));
    buildYday();
  }
  ydayBtn.addEventListener("click", () => setYday(!board.classList.contains("yday-open")));
  function buildYday() {
    const P = state.pending;
    ydayBtn.hidden = !P;
    if (!P) {
      board.classList.remove("yday-open");
      yday.replaceChildren();
      return;
    }
    const open = board.classList.contains("yday-open");
    ydayBtn.textContent = open ? YD.back ?? "" : YD.button ?? "";
    ydayBtn.classList.toggle("on", open);
    yday.replaceChildren();
    const head = el("div", "dailies-lib-head");
    head.append(el("h3", "", fill(YD.title, { date: ydayLabel(P.day) })), el("span", "dailies-lib-count", YD.until ?? ""));
    yday.append(head, el("p", "dailies-yday-hint", YD.hint ?? ""));
    const list = el("div", "dailies-yday-list");
    const picked = (P.picked ?? []).filter((id) => byId[id]);
    for (const id of picked) {
      const task = byId[id];
      const was = P.done.includes(id);
      const row = el("label", `dailies-task dailies-yday-row${was ? " was" : ""}`);
      const box2 = el("input");
      box2.type = "checkbox";
      box2.checked = was || (P.marked ?? []).includes(id);
      box2.disabled = was;
      box2.addEventListener("change", () => {
        P.marked = box2.checked ? [...new Set([...(P.marked ?? []), id])] : (P.marked ?? []).filter((x) => x !== id);
        saveDailiesState(state);
        buildYday();
      });
      row.append(box2, el("span", "dailies-task-name", task.name), el("span", `dailies-tag tag-${task.attr}`, t.attrShort[task.attr] ?? ""));
      if (was) row.append(el("span", "dailies-yday-was", YD.was ?? ""));
      list.append(row);
    }
    yday.append(list);
    const n = P.done.length + (P.marked ?? []).filter((id) => !P.done.includes(id)).length;
    const foot2 = el("div", "dailies-yday-foot");
    const send = el("button", "dailies-submit dailies-yday-send", fill(YD.send, { n, of: picked.length }));
    send.type = "button";
    send.addEventListener("click", submitYesterday);
    const couldnt = el("button", "dailies-yday-rest", YD.couldnt ?? "");
    couldnt.type = "button";
    couldnt.title = YD.couldntHint ?? "";
    couldnt.addEventListener("click", restYesterday);
    foot2.append(send, couldnt);
    yday.append(foot2);
  }
  // сдать вчера: дописанные дела дают то же, что дали бы вчера (опыт, сила, Воля), плюс Воля за цвет дня
  function submitYesterday() {
    const P = state.pending;
    if (!P) return;
    const fresh = (P.marked ?? []).filter((id) => byId[id] && !P.done.includes(id));
    for (const id of fresh) {
      const task = byId[id];
      state.wallet += reward;
      state.earned = (state.earned ?? 0) + reward;
      P.dayGains = { ...(P.dayGains ?? {}), [id]: (P.dayGains?.[id] ?? 0) + reward };
      if (data.flasks.includes(task.attr)) addFlask(task.attr, reward);
      addFlask("will", W.perTask ?? 1);
      P.done.push(id);
    }
    const total2 = (P.picked ?? []).filter((id) => byId[id]).length || P.done.length;
    const grade = gradeDay({ closedBy: "player", done: P.done.length }, total2) ?? "red";
    const dayWill = P.done.length ? W.day?.[grade] ?? 0 : 0;
    if (dayWill) addFlask("will", dayWill);
    P.willBonus = (P.willBonus ?? 0) + dayWill;
    state.history.push(dayRecord(P, data, "player"));
    state.history = state.history.slice(-400);
    state.pending = null;
    const M = ctx.texts.mail ?? {};
    const D = M.day?.[grade] ?? {};
    postMail({ key: `day-${P.day}`, from: "mir", title: fill(YD.mailTitle, { date: ydayLabel(P.day) }), text: fill(YD.mailText, { n: P.done.length, will: dayWill }), parts: [{ t: "day", grade, gradeName: D.title, base: W.day?.[grade] ?? 0, half: W.day?.yellow ?? 0, bonus: (W.day?.green ?? 0) - (W.day?.yellow ?? 0), balance: 0, total: dayWill, note: YD.mailNote }] });
    toast(fill(YD.done, { will: dayWill }));
    board.classList.remove("yday-open");
    commit();
  }
  // «Не смог отметить вовремя»: день не красный, а бережный — что успел, засчитано; Воля +1 за честность
  function restYesterday() {
    const P = state.pending;
    if (!P) return;
    addFlask("will", 1);
    P.willBonus = (P.willBonus ?? 0) + 1;
    state.history.push(dayRecord(P, data, "rest"));
    state.history = state.history.slice(-400);
    state.pending = null;
    toast(YD.restDone ?? "");
    board.classList.remove("yday-open");
    commit();
  }

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
    // Воля за сданный день (25.10): по цвету дня — красный +1, жёлтый +5, зелёный +12; день в равновесии — ещё +10 % дневной Воли
    if (state.done.length) {
      const grade = gradeDay({ closedBy: "player", done: state.done.length }, total) ?? "red";
      let dayWill = W.day?.[grade] ?? 0;
      const fromTasks = Object.values(state.willTasks ?? {}).reduce((a, b) => a + b, 0);
      let balanceBonus = 0;
      if (ctx.stats?.balance && powersBalance(ctx.stats, state.flasks, curve).balanced) {
        balanceBonus = Math.max(1, Math.round((fromTasks + dayWill) * (W.balance ?? 0.1)));
        dayWill += balanceBonus;
      }
      addFlask("will", dayWill);
      state.willBonus = dayWill;
      // письма за сданный день (почта, 27.10): Мир — итог дня; Хранитель меры — если одна сила отстаёт
      const M = ctx.texts.mail ?? {};
      const D = M.day?.[grade] ?? {};
      postMail({ key: `day-${state.day}`, from: "mir", group: "day", groupTitle: M.dayTitle, title: D.title, text: fillMail(D.text, { will: dayWill - balanceBonus, half: W.day?.yellow ?? 0, full: W.day?.green ?? 0, bonus: (W.day?.green ?? 0) - (W.day?.yellow ?? 0) }) + (balanceBonus ? fillMail(M.balanceBonus, { n: balanceBonus }) : ""), parts: [{ t: "day", grade, gradeName: D.title, base: W.day?.[grade] ?? 0, half: W.day?.yellow ?? 0, bonus: (W.day?.green ?? 0) - (W.day?.yellow ?? 0), balance: balanceBonus, total: dayWill, note: D.note, bar: willBar(dayWill) }, growthPart(), expPart()].filter(Boolean) });
      if (ctx.stats?.balance) {
        const bal = powersBalance(ctx.stats, state.flasks, curve);
        if (!bal.balanced && !bal.newcomer && bal.lead?.pair) {
          const power = (ctx.stats.attrs ?? []).find((a) => a.key === bal.lead.pair)?.name ?? bal.lead.pair;
          const ideas = (data.groups.find((g) => g.id === bal.lead.pair)?.tasks ?? []).filter((x) => x.attr !== "dev").slice(0, 2).map((x) => x.name.toLowerCase());
          postMail({ key: `bal-${state.day}`, from: "mir", group: "day", groupTitle: M.dayTitle, title: fillMail(M.lagTitle, { power }), text: fillMail(M.lagText, { power, tasks: ideas.join(" или ") }), parts: [{ t: "mera", kind: "lag", text: fillMail(M.lagShort, { power, tasks: ideas.join(" или ") }) }] });
        }
      }
      window.setTimeout(() => toast(t.willDay.replace("{n}", String(dayWill))), 1600);
      if (balanceBonus) window.setTimeout(() => toast(t.willBonus.replace("{n}", String(balanceBonus))), 3200);
    }
    commit();
    document.dispatchEvent(new CustomEvent("hub:day-closed", { detail: { by: "player" } }));
  });
  foot.append(el("p", "dailies-hint", t.submitHint), stamp, submit);

  // админ-режим (?admin=1): временно, пока нет входа и ролей — потом только для роли admin
  const isAdmin = ADMIN;
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
    state.sets = {};
    state.dayGains = {};
    state.bought = [];
    state.closed = false;
    toast(t.adminDone);
    commit();
  });
  adminBar.append(el("span", "dailies-admin-label", t.adminLabel), reopen, reset);

  // «Рост за день» для письма (27.10): каждая выросшая сила — полоской от утра до вечера; сверху — Интеллект
  function growthPart() {
    const rows = [];
    const before = {};
    for (const [key, flask] of Object.entries(state.flasks)) {
      const got = state.dayFlasks?.[key] ?? 0;
      const was = { ...flask };
      if (got) addPoints(curveOf(key), was, -got);
      before[key] = was;
      if (key === "will" || got <= 0) continue;
      const up = flask.level > was.level;
      rows.push({ attr: key, name: t.attrs[key] ?? key, gain: got, lvl: flask.level, from: up ? 0 : was.progress, to: flask.progress, need: levelNeed(curveOf(key), flask.level), up, say: up ? fillMail(ctx.texts.mail?.level?.[key], { n: flask.level }).replace(/^[^.]*\.\s*/, "") : "" });
    }
    if (!rows.length) return null;
    const mastery = masteryNow();
    const intelFrom = intellectOf(ctx.skills, mastery, before).value;
    const intelTo = intellectOf(ctx.skills, mastery, state.flasks).value;
    // ближе всех к новому уровню — это и есть «скоро +1 к Интеллекту»
    let near = null;
    for (const [key, flask] of Object.entries(state.flasks)) {
      const need = levelNeed(curveOf(key), flask.level);
      const left = need - flask.progress;
      if (!near || left / need < near.left / near.need) near = { attr: key, name: t.attrs[key] ?? key, left, need, progress: flask.progress };
    }
    return { t: "growth", compact: true, rows, intel: { from: intelFrom, to: intelTo, near } }; // сводка дня — тонко (автор, 27.10); полная — в карточке персонажа
  }

  // строка опыта для письма (27.10): сколько заработал, сколько ушло на слабости, сколько в руке
  function expPart() {
    const earned = Object.values(state.dayGains ?? {}).reduce((a, b) => a + b, 0);
    const spent = (state.bought ?? []).reduce((a, b) => a + b.price, 0);
    return { t: "exp", earned, spent, hand: state.wallet };
  }

  // полоска Воли для письма (27.10): где была до сданного дня и куда доползла
  function willBar(gain) {
    const flask = state.flasks.will;
    const need = levelNeed(curveOf("will"), flask.level);
    return { lvl: flask.level, from: Math.max(0, flask.progress - gain), to: flask.progress, need, up: flask.progress - gain < 0 };
  }

  function addFlask(key, amount) {
    const flask = state.flasks[key];
    // сколько очков сила набрала за день — для полосок «Рост за день» в письме (27.10)
    state.dayFlasks ??= {};
    state.dayFlasks[key] = (state.dayFlasks[key] ?? 0) + amount;
    const up = addPoints(curveOf(key), flask, amount);
    for (let i = 0; i < up; i++) {
      // 28.10 (автор): всплывашку «+1 к Мощи» в окне заданий не показываем — закрывала текст; новый уровень приходит в «Сводке дня»
      // письмо Мира о новом уровне (почта, 27.10); один уровень — одно письмо
      const n = flask.level - up + i + 1;
      const M = ctx.texts.mail ?? {};
      postMail({ key: `lvl-${key}-${n}`, from: "mir", group: "day", groupTitle: M.dayTitle, title: fillMail(M.levelTitle, { power: t.attrs[key] ?? key, n }), text: fillMail(M.level?.[key], { n }), parts: [{ t: "level", attr: key, name: t.attrs[key] ?? key, n, say: fillMail(M.level?.[key], { n }).replace(/^[^.]*\.\s*/, "") }] });
    }
  }

  function render() {
    buildLib();
    walletValue.textContent = String(state.wallet);
    const doneCount = state.done.length;
    stripMeta.textContent = `${doneCount} ${t.of} ${total} · ${t.wallet.toLowerCase()} ${state.wallet}${state.closed ? " · ✓" : ""}${state.pending ? ` · ${t.yesterday?.strip ?? ""}` : ""}`;
    for (const r of taskRows) r.update();
    for (const [key, node] of Object.entries(flaskNodes)) {
      const flask = state.flasks[key];
      const need = levelNeed(curveOf(key), flask.level);
      node.fill.style.width = `${(flask.progress / need) * 100}%`;
      node.value.textContent = `${flask.progress} / ${need}`;
      node.level.textContent = String(flask.level);
    }
    buildWeak();
    buildYday();
    lastDailies = { done: doneCount, total, closed: state.closed, will: state.flasks.will, max, curve, willCurve, reward, tasks: activeTasks, doneIds: [...state.done], history: state.history, day: state.day, earned: state.earned ?? 0, flasks: state.flasks, start: data.start.flasks, wallet: state.wallet, stored: state.stored ?? 0, dayGains: { ...(state.dayGains ?? {}) }, bought: [...state.bought], steps: { ...(state.steps ?? {}) }, willBonus: state.willBonus ?? 0, openedAt: { ...(state.openedAt ?? {}) }, attrOf: attrMap, allTasks };
    document.dispatchEvent(new CustomEvent("hub:dailies", { detail: lastDailies }));
    board.classList.toggle("closed", state.closed);
    submit.disabled = state.closed;
    reopen.disabled = !state.closed;
  }

  function commit() {
    if (checkOpen()) buildTasks();
    saveDailiesState(state);
    render();
  }

  // сводка недели и месяца (почта, 27.10): одним коротким письмом, когда период закончился
  function periodMail() {
    const M = ctx.texts.mail ?? {};
    const total = state.picked?.length || data.pick?.default?.length || 8;
    // календарь коло (28.10): неделя — 10 дней, месяц — 30; ключи писем — по коло
    const koloCal = (key) => {
      const [y, m, d] = String(key).split("-").map(Number);
      const k = koloDate(new Date(y, (m || 1) - 1, d || 1));
      return { week: `kweek-${k.year}-${k.month}-${k.week}`, month: `kmonth-${k.year}-${k.month}`, weekLen: k.weekLen, monthLen: k.monthLen };
    };
    for (const p of periodSummaries(state.history, state.day, (r) => gradeDay(r, total), koloCal)) {
      const P = M[p.kind] ?? {};
      const best = p.best ? fillMail(P.best, { power: t.attrs[p.best] ?? p.best }) : "";
      const of = p.of;
      const bestName = p.best ? t.attrs[p.best] ?? p.best : "";
      postMail({ key: p.key, from: "mir", title: P.title, text: fillMail(P.text, { ...p, best }), parts: [{ t: "period", kind: p.kind, days: p.days, of, green: p.green, done: p.done, xp: p.xp, best: p.best, bestName, note: P.note, koloMonth: Number(String(p.key).split("-")[2]) || koloDate().month }] });
    }
  }
  periodMail();

  // полночь: день закрывается сам, отметки обнуляются (проверка раз в минуту)
  window.setInterval(() => {
    // полдень: вчерашний несданный день закрывается сам
    if (state.day === todayKey() && closePending(state, data)) commit();
    if (rollDay(state, data)) {
      periodMail();
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
  // из письма «Пора выше» (27.10): взять ступень сразу — или показать задание с пульсирующей «↑ выше»
  document.addEventListener("hub:step-take", (event) => {
    const { task: id, step } = event.detail ?? {};
    const task = allTasks.find((x) => x.id === id);
    if (!task?.steps?.length || (state.steps?.[id]?.step ?? task.step ?? 0) !== step) return;
    state.steps[id] = stepUp(stepEntry(task), state.day);
    toast(fill(t.sets?.raised, { name: stepInfo(task).cur.name }));
    commit();
  });
  document.addEventListener("hub:step-show", (event) => {
    const id = event.detail?.task;
    document.querySelector(".modal-close")?.click();
    if (board.hidden) strip.click();
    window.setTimeout(() => {
      const row = document.querySelector(`.dailies-sets[data-task="${CSS.escape(id ?? "")}"]`);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.remove("pulse-step");
      void row.offsetWidth;
      row.classList.add("pulse-step");
      window.setTimeout(() => row.classList.remove("pulse-step"), 3200);
    }, 350);
  });
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
  if (action === "modal:character") return ctx.cardUi?.open(); // полная карточка персонажа (29.10)
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
  // действия из окон и писем (28.10: «Открыть в коло» в сводке недели/месяца)
  document.addEventListener("hub:action", (event) => typeof event.detail === "string" && handleAction(event.detail, ctx));
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
  // анкета входа: «Задания» из меню тоже сначала ведут в анкету (28.10)
  if (ctx.questsUi?.open) {
    const realOpen = ctx.questsUi.open.bind(ctx.questsUi);
    ctx.questsUi.open = (...args) => (needAnketa() ? openAnketa(ctx) : realOpen(...args));
  }
  ctx.achievementsUi = initAchievements(ctx, () => lastDailies);
  ctx.statsUi = initStats(ctx, () => lastDailies);
  ctx.skillsUi = initSkills(ctx, () => lastDailies);
  ctx.cardUi = initCard(ctx, () => lastDailies);
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
  if (!ctx.editMode && (ADMIN || sandboxSaved)) {
    const { startAdmin, showSandboxBanner, sandboxOn } = await import("./admin.js");
    if (ADMIN) startAdmin(ctx);
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
