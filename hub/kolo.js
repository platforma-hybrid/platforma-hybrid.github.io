// Коло года с жерновом (04.10.2026, v0.2 — календарь 12 × 30 + короткий 13-й). Спецификация: claude/SPEC_KOLO.md.
// Три круга «как часы»: обод — 13 месяцев года, средний круг — 3 недели текущего месяца,
// жернов — дни текущей недели (10 секторов; в 13-м месяце — 5–6). Ступица — место в рейтинге.
// Год начинается в день весеннего равноденствия («солнце победило тьму»), дата считается по Солнцу.
// Данные — из ежедневных заданий (событие hub:dailies). Сдача дня — событие hub:day-closed.

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY_MS = 86_400_000;
const MONTHS = 13; // 12 по 30 дней + короткий 13-й
export const MONTH_DAYS = 30; // 3 недели по 10 дней
export const WEEK_DAYS = 10;
const TZ_MS = 3 * 3_600_000; // время равноденствия — по Москве (Крым)
const ATTR_COLORS = { strength: "#ff5a3a", endurance: "#2fe0a8", order: "#a98bff", morality: "#5ab4ff", will: "#ffb347" };

// ---------- календарь коло ----------

// Мартовское равноденствие (Meeus, «Astronomical Algorithms», гл. 27; точность — минуты). Возвращает момент UTC.
const EQ_A = [485, 203, 199, 182, 156, 136, 77, 74, 70, 58, 52, 50, 45, 44, 29, 18, 17, 16, 14, 12, 12, 12, 9, 8];
const EQ_B = [324.96, 337.23, 342.08, 27.85, 73.14, 171.52, 222.54, 296.72, 243.58, 119.81, 297.17, 21.02, 247.54, 325.15, 60.93, 155.12, 288.79, 198.04, 199.76, 95.39, 287.11, 320.81, 227.73, 15.45];
const EQ_C = [1934.136, 32964.467, 20.186, 445267.112, 45036.886, 22518.443, 65928.934, 3034.906, 9037.513, 33718.147, 150.678, 2281.226, 29929.562, 31555.956, 4443.417, 67555.328, 4562.452, 62894.029, 31436.921, 14577.848, 31931.756, 34777.259, 1222.114, 16859.074];
function marchEquinox(year) {
  const Y = (year - 2000) / 1000;
  const J0 = 2451623.80984 + 365242.37404 * Y + 0.05169 * Y ** 2 - 0.00411 * Y ** 3 - 0.00057 * Y ** 4;
  const T = (J0 - 2451545) / 36525;
  const W = ((35999.373 * T - 2.47) * Math.PI) / 180;
  const dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  let S = 0;
  for (let i = 0; i < 24; i++) S += EQ_A[i] * Math.cos(((EQ_B[i] + EQ_C[i] * T) * Math.PI) / 180);
  const jde = J0 + (0.00001 * S) / dl - 69 / 86400; // ΔT ≈ 69 с
  return new Date((jde - 2440587.5) * DAY_MS);
}
const eqCache = new Map();
function equinoxDay(year) {
  if (!eqCache.has(year)) {
    const m = new Date(marchEquinox(year).getTime() + TZ_MS);
    eqCache.set(year, new Date(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate()));
  }
  return eqCache.get(year);
}
// Время равноденствия по Москве, «ЧЧ:ММ».
export function equinoxTime(year) {
  return new Date(marchEquinox(year).getTime() + TZ_MS).toISOString().slice(11, 16);
}

// Год коло начинается в день весеннего равноденствия.
function yearStart(day) {
  const start = equinoxDay(day.getFullYear());
  return day < start ? equinoxDay(day.getFullYear() - 1) : start;
}

// Дата коло: month 1–13, day — день месяца, week — неделя месяца (1–3; в 13-м месяце одна), wday — день недели.
export function koloDate(date = new Date()) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = yearStart(day);
  const yearLen = Math.round((equinoxDay(start.getFullYear() + 1) - start) / DAY_MS); // 365/366
  const index = Math.round((day - start) / DAY_MS);
  const month = Math.min(MONTHS, Math.floor(index / MONTH_DAYS) + 1);
  const mday = index - (month - 1) * MONTH_DAYS + 1;
  const short = month === MONTHS; // 13-й месяц: 5–6 дней, одна короткая неделя
  const monthLen = short ? yearLen - (MONTHS - 1) * MONTH_DAYS : MONTH_DAYS;
  return {
    year: start.getFullYear(), start, index, yearLen, month, day: mday, monthLen, short,
    week: short ? 1 : Math.ceil(mday / WEEK_DAYS),
    wday: short ? mday : ((mday - 1) % WEEK_DAYS) + 1,
    weekLen: short ? monthLen : WEEK_DAYS,
  };
}
// Длина месяца коло m в году now (13-й — короткий).
export function monthLength(m, now = koloDate()) {
  return m === MONTHS ? now.yearLen - (MONTHS - 1) * MONTH_DAYS : MONTH_DAYS;
}

function parseDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Все записанные дни (история + сегодня) с датой коло.
function allDays(d) {
  const days = (d.history ?? []).map((h) => ({ ...h, kolo: koloDate(parseDayKey(h.day)) }));
  const attrs = {};
  for (const id of d.doneIds ?? []) {
    const attr = d.tasks.find((t) => t.id === id)?.attr;
    if (attr) attrs[attr] = (attrs[attr] ?? 0) + 1;
  }
  days.push({ day: d.day, done: d.done, attrs, closedBy: d.closed ? "player" : null, today: true, kolo: koloDate() });
  return days;
}

// ---------- оценка дня (зарубки недели, бусины) ----------
// Зелёный — закрыл всё; жёлтый — неплохо (половина и больше); красный — плохо (меньше половины или не сдал сам).
export const DAY_COLORS = { green: "#4cc96a", yellow: "#f2c14e", red: "#e0473a" };
const GRADE = { green: 1, yellow: 0.5 }; // доля сделанных заданий; пороги можно поменять
// Очки пути (рейтинг сезона): день по оценке + неделя целиком + месяц целиком. Сезон пока = год коло.
export const PATH_POINTS = { green: 3, yellow: 2, red: 1, week: 15, month: 40 };
export function gradeDay(rec, total) {
  if (!rec || rec.closedBy == null) return null;
  if (rec.closedBy !== "player") return "red";
  const share = total ? (rec.done ?? 0) / total : 0;
  return share >= GRADE.green ? "green" : share >= GRADE.yellow ? "yellow" : "red";
}

// ---------- мелочи ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
const P = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function band(cx, cy, r1, r2, d0, d1) {
  const [x0, y0] = P(cx, cy, r1, d0), [x1, y1] = P(cx, cy, r1, d1), [x2, y2] = P(cx, cy, r2, d1), [x3, y3] = P(cx, cy, r2, d0);
  const L = d1 - d0 > 180 ? 1 : 0;
  return `M${x0},${y0} A${r1},${r1} 0 ${L} 1 ${x1},${y1} L${x2},${y2} A${r2},${r2} 0 ${L} 0 ${x3},${y3} Z`;
}

// ---------- звук: хруст жернова и щелчок ----------

let audio = null;
function ctxAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    return audio;
  } catch {
    return null;
  }
}
function noiseBuffer(ac, seconds) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}
function playGrind() {
  const ac = ctxAudio();
  if (!ac) return;
  const t0 = ac.currentTime;
  // низкий гул камня
  const rumble = ac.createBufferSource();
  rumble.buffer = noiseBuffer(ac, 1.8);
  const low = ac.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 180;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.9, t0 + 0.15);
  g.gain.linearRampToValueAtTime(0.5, t0 + 1.2);
  g.gain.linearRampToValueAtTime(0, t0 + 1.7);
  rumble.connect(low).connect(g).connect(ac.destination);
  rumble.start(t0);
  // хруст: короткие треск-зёрна
  for (let i = 0; i < 38; i++) {
    const t = t0 + 0.05 + Math.random() * 1.45;
    const grain = ac.createBufferSource();
    grain.buffer = noiseBuffer(ac, 0.04);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 2600;
    bp.Q.value = 3;
    const gg = ac.createGain();
    gg.gain.setValueAtTime(0.0001, t);
    gg.gain.exponentialRampToValueAtTime(0.35 + Math.random() * 0.4, t + 0.004);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
    grain.connect(bp).connect(gg).connect(ac.destination);
    grain.start(t);
  }
}
// перезвон после хруста: окраска борозды (зелёный — выше и светлее, красный — ниже)
function playChime(grade) {
  const ac = ctxAudio();
  if (!ac) return;
  const notes = { green: [523.25, 659.25, 783.99], yellow: [440, 554.37], red: [293.66, 277.18] }[grade] ?? [440];
  notes.forEach((f, i) => {
    const t = ac.currentTime + i * 0.12;
    const o = ac.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 1);
  });
}

function playTick() {
  const ac = ctxAudio();
  if (!ac) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, 0.05);
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1400;
  bp.Q.value = 5;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t);
}

// ---------- колесо ----------

const W = 520, CX = 260, CY = 340;
const R_RIM_O = 252, R_RIM_I = 214, R_WK_O = 211, R_WK_I = 185, R_ST_O = 181, R_ST_I = 84, R_HUB = 70;
const ROMAN = ["I", "II", "III"];
const SCORE = { green: 2, yellow: 1, red: 0 };
// подпись вдоль круга: внизу колеса переворачиваем, чтобы читалась
function arcLabel(x, y, mid, text, size, fill, cls = "") {
  const a = ((mid % 360) + 360) % 360;
  const rot = a > 90 && a < 270 ? a + 180 : a;
  return `<text class="${cls}" x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" text-anchor="middle" dominant-baseline="central" font-size="${size}" fill="${fill}" pointer-events="none">${text}</text>`;
}

const DEFS = `
  <linearGradient id="kGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#e3b860"/><stop offset="1" stop-color="#8a5a1c"/></linearGradient>
  <radialGradient id="kBead" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff1c4"/><stop offset=".5" stop-color="#ffb347"/><stop offset="1" stop-color="#b8661c"/></radialGradient>
  <radialGradient id="kHalo"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
  <filter id="kGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="kGlowStrong" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${W + 200}" height="900"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="kBlur8"><feGaussianBlur stdDeviation="8"/></filter>
  <radialGradient id="kStoneShade" cx=".5" cy=".5" r=".5"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
  <filter id="kStoneNoise" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="4" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .08  0 0 0 0 .07  0 0 0 0 .06  1.6 0 0 0 -.35" result="c"/>
    <feComposite in="c" in2="SourceGraphic" operator="in"/>
  </filter>
  <radialGradient id="kStoneBase" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#6d685e"/><stop offset=".7" stop-color="#3f3b35"/><stop offset="1" stop-color="#24221e"/></radialGradient>
  <pattern id="kStoneTex" patternUnits="userSpaceOnUse" width="${W}" height="700">
    <rect width="${W}" height="700" fill="url(#kStoneBase)"/>
    <rect width="${W}" height="700" fill="#000" filter="url(#kStoneNoise)" opacity=".9"/>
  </pattern>
  <filter id="kWoodNoise" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".008 .12" numOctaves="3" seed="3" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .16  0 0 0 0 .08  0 0 0 0 .03  1.2 0 0 0 -.1"/>
  </filter>
  <pattern id="kWoodTex" patternUnits="userSpaceOnUse" width="${W}" height="700">
    <rect width="${W}" height="700" fill="#5a3519"/>
    <rect width="${W}" height="700" filter="url(#kWoodNoise)"/>
  </pattern>`;

export function createKolo(box, { texts, character, getDailies, actionButton, icon }) {
  const t = texts.kolo;
  box.classList.add("passthrough", "kolo-item");
  const root = el("div", "kolo");

  // подпись над колесом (кликабельна → итоги текущего месяца)
  const caption = el("button", "kolo-caption");
  caption.type = "button";
  root.append(caption);

  // SVG
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "kolo-svg");
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", "700");
  svg.setAttribute("viewBox", `0 0 ${W} 700`);
  svg.innerHTML = `<defs>${DEFS}</defs>
    <ellipse cx="${CX + 8}" cy="${CY + 14}" rx="${R_RIM_O + 6}" ry="${R_RIM_O + 2}" fill="rgba(0,0,0,.55)" filter="url(#kBlur8)"/>
    <g class="kolo-rim"></g>
    <circle cx="${CX}" cy="${CY}" r="${R_WK_O + 2}" fill="#120a04"/>
    <g class="kolo-weeks"></g>
    <g class="kolo-stone"></g>
    <circle cx="${CX}" cy="${CY}" r="${R_HUB + 10}" fill="#0d0805"/>
    <circle cx="${CX}" cy="${CY}" r="${R_HUB}" fill="url(#kWoodTex)" stroke="url(#kGold)" stroke-width="5"/>
    <circle cx="${CX}" cy="${CY}" r="${R_HUB - 12}" fill="none" stroke="rgba(227,184,96,.4)" stroke-width="2" stroke-dasharray="2 6"/>
    <path d="M${CX - 16} ${CY - R_RIM_O - 26} L${CX + 16} ${CY - R_RIM_O - 26} L${CX} ${CY - R_RIM_O + 6} Z" fill="url(#kGold)" stroke="#2a1a0e" stroke-width="2"/>
    <g class="kolo-sparks"></g>`;
  root.append(svg);
  const rimG = svg.querySelector(".kolo-rim");
  const weeksG = svg.querySelector(".kolo-weeks");
  const stoneG = svg.querySelector(".kolo-stone");
  const sparksG = svg.querySelector(".kolo-sparks");
  stoneG.style.transformOrigin = `${CX}px ${CY}px`;

  // жернов: камень, разрезанный бороздами на n секторов — дни недели (10; в 13-м месяце 5–6)
  let stoneN = 0;
  let dayNodes = [], numNodes = [];
  function buildStone(n) {
    stoneN = n;
    const step = 360 / n;
    let s = `<circle cx="${CX}" cy="${CY}" r="${R_ST_O}" fill="url(#kStoneTex)" stroke="#1a1714" stroke-width="3"/>
      <circle cx="${CX}" cy="${CY}" r="${R_ST_O}" fill="url(#kStoneShade)"/>
      <circle cx="${CX}" cy="${CY}" r="${R_ST_O - 4}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="2"/>`;
    for (let i = 0; i < n; i++) {
      s += `<path class="kolo-day" data-i="${i}" d="${band(CX, CY, R_ST_O - 8, R_ST_I + 12, i * step + 2.2, (i + 1) * step - 2.2)}" filter="url(#kGlow)"/>`;
    }
    // борозды-разделители
    for (let i = 0; i < n; i++) {
      const [x1, y1] = P(CX, CY, R_ST_I + 6, i * step), [x2, y2] = P(CX, CY, R_ST_O - 4, i * step);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#14110e" stroke-width="7" stroke-linecap="round"/>
        <line x1="${x1 + 1.5}" y1="${y1 + 1.5}" x2="${x2 + 1.5}" y2="${y2 + 1.5}" stroke="rgba(255,255,255,.07)" stroke-width="1.5" stroke-linecap="round"/>`;
    }
    for (let i = 0; i < n; i++) {
      const mid = (i + 0.5) * step;
      const [x, y] = P(CX, CY, R_ST_O - 30, mid);
      s += `<text class="kolo-daynum" data-mid="${mid}" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`;
    }
    stoneG.innerHTML = s;
    dayNodes = [...stoneG.querySelectorAll(".kolo-day")];
    numNodes = [...stoneG.querySelectorAll(".kolo-daynum")];
  }

  // ступица: место в рейтинге (пока заглушка из mock.character.json)
  const hub = el("div", "kolo-hub");
  hub.style.cssText = `left:${CX - R_HUB}px;top:${CY - R_HUB}px;width:${2 * R_HUB}px;height:${2 * R_HUB}px`;
  const rating = character.rating ?? {};
  hub.append(el("span", "kolo-hub-label", t.place), el("span", "kolo-hub-value gold-text", String(rating.place ?? "—")), el("span", "kolo-hub-of", `${t.of} ${rating.of ?? "—"}`));
  root.append(hub);

  // меню столбиком на рейке
  const IY = CY + R_RIM_O + 44, IH = 70, IG = 18, RAIL = 22;
  const lastY = IY + (texts.menu.length - 1) * (IH + IG) + IH / 2;
  const rail = document.createElementNS(SVG_NS, "svg");
  rail.setAttribute("class", "kolo-rail");
  rail.setAttribute("width", String(W));
  rail.setAttribute("height", String(lastY + 20));
  let railInner = `<path d="M${CX} ${CY + R_RIM_O} L${CX} ${IY - 18} Q${CX} ${IY - 8} ${CX - 10} ${IY - 8} L${RAIL + 10} ${IY - 8} Q${RAIL} ${IY - 8} ${RAIL} ${IY + 2} L${RAIL} ${lastY}" fill="none" stroke="url(#kGold)" stroke-width="3"/>`;
  texts.menu.forEach((_, i) => {
    const y = IY + i * (IH + IG) + IH / 2;
    railInner += `<line x1="${RAIL}" y1="${y}" x2="${RAIL + 26}" y2="${y}" stroke="url(#kGold)" stroke-width="3"/><rect x="${RAIL - 7}" y="${y - 7}" width="14" height="14" transform="rotate(45 ${RAIL} ${y})" fill="url(#kGold)" stroke="#2a1a0e" stroke-width="2"/>`;
  });
  rail.innerHTML = railInner;
  root.append(rail);

  const metas = {};
  texts.menu.forEach((entry, i) => {
    const button = actionButton("wood menu-item kolo-menu-item", entry.action ?? `modal:${entry.id}`);
    button.style.top = `${IY + i * (IH + IG)}px`;
    button.style.left = `${RAIL + 26}px`;
    button.style.width = `${W - RAIL - 26}px`;
    button.style.height = `${IH}px`;
    button.append(icon(entry.icon), el("span", "gold-text", entry.label));
    if (entry.id === "tasks" || entry.id === "achievements") {
      metas[entry.id] = el("span", "kolo-meta", "");
      button.append(metas[entry.id]);
    }
    root.append(button);
  });

  // сводка «Сегодня» под меню
  const today = el("div", "wood kolo-today");
  today.style.top = `${IY + texts.menu.length * (IH + IG) + 8}px`;
  today.style.left = `${RAIL + 26}px`;
  today.style.width = `${W - RAIL - 26}px`;
  const todayHead = el("div", "kolo-today-head gold-text", t.today);
  const todayDone = el("div", "kolo-today-line");
  const todayWill = el("div", "kolo-today-line kolo-today-will");
  const todayPath = el("div", "kolo-today-line kolo-today-path");
  today.append(todayHead, todayDone, todayWill, todayPath);
  root.append(today);

  box.append(root);

  // ---------- отрисовка по данным ----------

  let dayPoints = 0, fullWeeks = 0, fullMonths = 0;
  function drawPath() {
    const pts = dayPoints + fullWeeks * PATH_POINTS.week + fullMonths * PATH_POINTS.month;
    todayPath.textContent = fmt(t.pathPoints, { n: pts });
    todayPath.title = fmt(t.pathHint, { g: PATH_POINTS.green, y: PATH_POINTS.yellow, r: PATH_POINTS.red, w: PATH_POINTS.week, m: PATH_POINTS.month });
  }
  let angle = null; // поворот жернова (накопительный)
  let lastDone = null;
  let weekIdx = 0;
  let paintedDay = null; // день, чей сектор уже окрашен
  let pendingPaint = null; // окраска сегодняшнего сектора — после хруста
  let total = 14;

  const recOf = (days, now, m, day) => days.find((r) => r.kolo.year === now.year && r.kolo.month === m && r.kolo.day === day);

  // обод: 13 месяцев года, ширина — по числу дней; текущий день — под стрелкой
  function drawRim(now, days) {
    const Y = now.yearLen;
    const offset = -((now.index + 0.5) / Y) * 360;
    let s = `<circle cx="${CX}" cy="${CY}" r="${R_RIM_O}" fill="url(#kWoodTex)"/>`;
    for (let m = 1; m <= MONTHS; m++) {
      const len = monthLength(m, now);
      const gap = m === MONTHS ? 0.5 : 1.2;
      const d0 = offset + (((m - 1) * MONTH_DAYS) / Y) * 360 + gap, d1 = offset + (((m - 1) * MONTH_DAYS + len) / Y) * 360 - gap;
      let fill = "rgba(0,0,0,.35)";
      if (m < now.month) {
        const closed = days.filter((x) => x.kolo.year === now.year && x.kolo.month === m && x.closedBy === "player").length;
        fill = `rgba(255,170,70,${(0.08 + 0.4 * (closed / len)).toFixed(2)})`;
      } else if (m === now.month) fill = "rgba(255,190,90,.34)";
      if (m === MONTHS) fill = m === now.month ? "rgba(170,140,255,.55)" : "rgba(120,95,190,.40)";
      const mid = (d0 + d1) / 2;
      const [x, y] = P(CX, CY, (R_RIM_O + R_RIM_I) / 2, mid);
      const lit = m <= now.month;
      const color = m === MONTHS ? "#d9c8ff" : lit ? "#ffd27a" : "rgba(227,184,96,.45)";
      s += `<g class="kolo-month" data-action="kolo-month:${m}" role="button" aria-label="${fmt(t.monthTitle, { m })}">
          <path d="${band(CX, CY, R_RIM_O - 6, R_RIM_I + 6, d0, d1)}" fill="${fill}" stroke="rgba(20,10,4,.7)" stroke-width="2"/>
          ${arcLabel(x, y, mid, m, m === MONTHS ? 15 : 21, color, "kolo-rim-num")}
        </g>`;
      // засечки недель внутри месяца
      if (m < MONTHS) for (const w of [1, 2]) {
        const a = offset + (((m - 1) * MONTH_DAYS + w * WEEK_DAYS) / Y) * 360;
        const [x1, y1] = P(CX, CY, R_RIM_I + 6, a), [x2, y2] = P(CX, CY, R_RIM_I + 13, a);
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(20,10,4,.8)" stroke-width="2" pointer-events="none"/>`;
      }
    }
    s += `<circle cx="${CX}" cy="${CY}" r="${R_RIM_O}" fill="none" stroke="url(#kGold)" stroke-width="5" pointer-events="none"/>
      <circle cx="${CX}" cy="${CY}" r="${R_RIM_I}" fill="none" stroke="url(#kGold)" stroke-width="3" pointer-events="none"/>`;
    rimG.innerHTML = s;
  }

  // средний круг: недели текущего месяца (3 по 10 дней; в 13-м месяце — одна короткая)
  function drawWeeks(now, days) {
    const L = now.monthLen;
    const offset = -((now.day - 0.5) / L) * 360;
    const weeks = now.short ? 1 : MONTH_DAYS / WEEK_DAYS;
    let s = "";
    for (let w = 1; w <= weeks; w++) {
      const from = (w - 1) * WEEK_DAYS + 1, to = now.short ? L : w * WEEK_DAYS;
      const d0 = offset + ((from - 1) / L) * 360 + (weeks > 1 ? 0.8 : 0), d1 = offset + (to / L) * 360 - (weeks > 1 ? 0.8 : 0);
      let fill = "rgba(0,0,0,.45)", color = "rgba(227,184,96,.5)";
      if (w === now.week) {
        fill = "rgba(255,210,122,.16)";
        color = "#ffd27a";
      } else if (w < now.week) {
        let sum = 0;
        for (let day = from; day <= to; day++) sum += SCORE[gradeDay(recOf(days, now, now.month, day), total)] ?? 0;
        const avg = sum / (to - from + 1);
        const g = avg >= 1.7 ? "green" : avg >= 1 ? "yellow" : "red";
        fill = DAY_COLORS[g] + "b0";
        color = "#1a1208";
      }
      const label = now.short ? t.shortWeek : fmt(t.weekRing, { w: ROMAN[w - 1] });
      const mid = weeks > 1 ? (d0 + d1) / 2 : 180;
      const [x, y] = P(CX, CY, (R_WK_O + R_WK_I) / 2, mid);
      s += weeks > 1
        ? `<path d="${band(CX, CY, R_WK_O, R_WK_I, d0, d1)}" fill="${fill}" stroke="${w === now.week ? "#ffd27a" : "rgba(20,10,4,.8)"}" stroke-width="${w === now.week ? 2.5 : 1.5}"/>`
        : `<circle cx="${CX}" cy="${CY}" r="${(R_WK_O + R_WK_I) / 2}" fill="none" stroke="${fill}" stroke-width="${R_WK_O - R_WK_I}"/>`;
      s += arcLabel(x, y, mid, label, 17, color, "kolo-week-label");
    }
    // засечки дней на среднем круге
    for (let day = 1; day < L; day++) {
      const a = offset + (day / L) * 360;
      const [x1, y1] = P(CX, CY, R_WK_I, a), [x2, y2] = P(CX, CY, R_WK_I + 5, a);
      s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(20,10,4,.55)" stroke-width="1.2"/>`;
    }
    s += `<circle cx="${CX}" cy="${CY}" r="${R_WK_O}" fill="none" stroke="rgba(227,184,96,.55)" stroke-width="1.5"/>`;
    weeksG.innerHTML = s;
  }

  function update(d) {
    if (!d) return;
    const now = koloDate();
    const days = allDays(d);
    total = d.total;
    caption.textContent = now.short ? fmt(t.captionShort, { m: now.month, d: now.wday }) : fmt(t.caption, { m: now.month, w: now.week, d: now.wday });
    caption.title = fmt(t.captionHint, { md: now.day, of: now.monthLen, date: now.start.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }), time: equinoxTime(now.year) });
    caption.dataset.action = `kolo-month:${now.month}`;
    drawRim(now, days);
    drawWeeks(now, days);
    if (stoneN !== now.weekLen) {
      buildStone(now.weekLen);
      angle = null;
    }
    // сектора жернова = дни недели: цвет — оценка дня; сегодняшний красится после «Сдать день» (эффект в hub:day-closed)
    const first = now.day - now.wday + 1; // день месяца, с которого началась неделя
    weekIdx = now.wday - 1;
    dayNodes.forEach((node, i) => {
      const day = first + i;
      const isToday = i === weekIdx;
      node.classList.toggle("today", isToday);
      numNodes[i].classList.toggle("today", isToday);
      numNodes[i].classList.toggle("future", i > weekIdx);
      const g = i <= weekIdx ? gradeDay(recOf(days, now, now.month, day), d.total) : null;
      if (isToday && !g && paintedDay === d.day) paintedDay = null; // день вернули (админ)
      if (isToday && g && paintedDay !== d.day) {
        if (angle === null) paintedDay = d.day; // уже сдан до загрузки — красим сразу
        else {
          pendingPaint = { node, g };
          return;
        }
      }
      paint(node, g, false);
    });
    todayDone.textContent = d.closed ? fmt(t.todayClosed, { n: d.done, of: d.total }) : fmt(t.todayDone, { n: d.done, of: d.total, left: d.total - d.done });
    // очки пути за сезон: дни по оценке (сегодня — после сдачи) + недели/месяцы целиком
    dayPoints = days.filter((x) => x.kolo.year === now.year).reduce((sum, x) => sum + (PATH_POINTS[gradeDay(x, d.total)] ?? 0), 0);
    drawPath();
    todayWill.textContent = fmt(t.todayWill, { next: (d.will?.level ?? 0) + 1, left: (d.max ?? 100) - (d.will?.progress ?? 0) });
    // поворот: сегодняшний сектор — наверху, под стрелкой
    const base = -(weekIdx + 0.5) * (360 / stoneN);
    if (angle === null) {
      angle = base;
      stoneG.style.transition = "none";
      stoneG.style.transform = `rotate(${angle}deg)`;
      stoneG.getBoundingClientRect();
      requestAnimationFrame(() => (stoneG.style.transition = ""));
    } else {
      // новый день — довернуть к нужному сектору (без лишних оборотов)
      let target = base;
      while (target > angle) target -= 360;
      while (target <= angle - 360) target += 360;
      if (Math.abs(target - angle) > 0.5 && Math.abs(target - angle) < 359.5) angle = target;
      stoneG.style.transform = `rotate(${angle}deg)`;
    }
    orientNums();
    if (lastDone !== null && d.done > lastDone) playTick();
    lastDone = d.done;
  }

  // цифры дней — вдоль круга, но всегда головой вверх (с учётом поворота жернова)
  function orientNums() {
    for (const node of numNodes) {
      const mid = Number(node.dataset.mid);
      const a = (((mid + angle) % 360) + 360) % 360;
      const x = node.getAttribute("x"), y = node.getAttribute("y");
      node.setAttribute("transform", `rotate(${a > 90 && a < 270 ? mid + 180 : mid} ${x} ${y})`);
    }
  }

  function paint(node, g, animate) {
    node.style.transition = "none";
    if (!g) {
      node.style.fill = "";
      node.style.opacity = "";
      return;
    }
    node.style.fill = DAY_COLORS[g];
    if (!animate) {
      node.style.opacity = "0.82";
      return;
    }
    // эффект окраски: сектор медленно наливается цветом
    node.style.opacity = "0";
    node.getBoundingClientRect();
    node.style.transition = "opacity 1.1s ease-out";
    node.style.opacity = "0.82";
  }
  function sparks() {
    let s = "";
    for (let i = 0; i < 16; i++) {
      const deg = Math.random() * 360;
      const [x, y] = P(CX, CY, R_ST_O, deg);
      const [x2, y2] = P(CX, CY, R_ST_O + 40 + Math.random() * 60, deg + (Math.random() * 20 - 10));
      s += `<circle class="kolo-spark" cx="${x}" cy="${y}" r="${2 + Math.random() * 2}" fill="#ffd27a" style="--dx:${x2 - x}px;--dy:${y2 - y}px;animation-delay:${(Math.random() * 0.9).toFixed(2)}s"/>`;
    }
    sparksG.innerHTML = s;
    window.setTimeout(() => (sparksG.innerHTML = ""), 2600);
  }

  // сдача дня: жернов с хрустом проворачивается целиком
  document.addEventListener("hub:day-closed", (event) => {
    const loud = event.detail?.by === "player";
    stoneG.classList.add(loud ? "kolo-grind" : "kolo-grind-quiet");
    angle += 360;
    stoneG.style.transform = `rotate(${angle}deg)`;
    if (loud) {
      playGrind();
      sparks();
    }
    // после хруста — борозда сегодняшнего дня окрашивается + перезвон
    const job = pendingPaint;
    pendingPaint = null;
    if (job) {
      paintedDay = getDailies()?.day ?? null;
      window.setTimeout(() => {
        paint(job.node, job.g, true);
        if (loud) playChime(job.g);
      }, loud ? 1500 : 200);
    }
    window.setTimeout(() => stoneG.classList.remove("kolo-grind", "kolo-grind-quiet"), 2000);
  });

  // счётчик «Задания» — задания недели (quests.js)
  document.addEventListener("hub:quests", (event) => {
    const q = event.detail;
    if (metas.tasks) metas.tasks.textContent = `${q.weekDone} ${t.of} ${q.weekTotal}${q.weekDone === q.weekTotal ? " ✓" : ""}`;
    fullWeeks = q.fullWeeks ?? 0;
    fullMonths = q.fullMonths ?? 0;
    drawPath();
  });
  // счётчик «Достижения» (achievements.js)
  document.addEventListener("hub:achievements", (event) => {
    if (metas.achievements) metas.achievements.textContent = `${event.detail.got} / ${event.detail.total}`;
  });

  update(getDailies());
  document.addEventListener("hub:dailies", (event) => update(event.detail));
}

// ---------- окно «Итоги месяца» ----------

export function monthStats(month, d, { texts, character }) {
  const t = texts.kolo;
  const now = koloDate();
  const days = allDays(d).filter((x) => x.kolo.year === now.year && x.kolo.month === month);
  const len = monthLength(month, now);
  const wrap = el("div", "kolo-stats");

  const head = el("div", "ks-head");
  const who = el("div", "ks-who");
  who.append(el("div", "ks-name gold-text", character.name), el("div", "ks-sub", `${character.status ?? ""} · ${t.place} ${character.rating?.place ?? "—"} ${t.of} ${character.rating?.of ?? "—"}`));
  const closed = days.filter((x) => x.closedBy === "player").length;
  head.append(who, el("div", "ks-count", fmt(t.submitted, { n: closed, of: len })));
  wrap.append(head);

  if (month > now.month) {
    wrap.append(el("p", "ks-empty", t.future));
    return wrap;
  }

  // бусины дней месяца (30; в 13-м месяце 5–6): ряд = неделя из 10 дней
  const beads = el("div", "ks-beads");
  for (let i = 1; i <= len; i++) {
    const rec = days.find((x) => x.kolo.day === i);
    let cls = "ks-bead";
    const g = gradeDay(rec, d.total);
    if (month === now.month && i > now.day) cls += " fut";
    else if (g) cls += ` ${g}`;
    else cls += " off";
    if (month === now.month && i === now.day) cls += " today";
    beads.append(el("span", cls));
  }
  wrap.append(beads);

  // цифры
  const tasks = days.reduce((s, x) => s + (x.done ?? 0), 0);
  let best = 0, run = 0;
  for (let i = 1; i <= len; i++) {
    const rec = days.find((x) => x.kolo.day === i);
    run = rec?.closedBy === "player" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const reward = d.reward ?? 5;
  const cells = el("div", "ks-cells");
  for (const [label, value] of [[t.tasks, tasks], [t.willPts, `+${tasks * reward}`], [t.streak, `${best} ${t.daysShort}`]]) {
    const c = el("div", "ks-cell");
    c.append(el("div", "ks-l", label), el("div", "ks-v", String(value)));
    cells.append(c);
  }
  wrap.append(cells);

  // атрибуты за месяц (жёлтые траты — скрыты: решение автора 04.10)
  const sums = {};
  for (const x of days) for (const [k, v] of Object.entries(x.attrs ?? {})) sums[k] = (sums[k] ?? 0) + v;
  const keys = ["strength", "endurance", "order", "morality"];
  const max = Math.max(1, ...keys.map((k) => sums[k] ?? 0));
  const bars = el("div", "ks-bars");
  for (const k of keys) {
    const row = el("div", "ks-bar");
    const track = el("div", "ks-track");
    const fill = el("div", "ks-fill");
    fill.style.width = `${((sums[k] ?? 0) / max) * 100}%`;
    fill.style.background = ATTR_COLORS[k];
    track.append(fill);
    row.append(el("span", "ks-n", texts.dailies.attrs[k]), track, el("span", "ks-c", String(sums[k] ?? 0)));
    bars.append(row);
  }
  wrap.append(bars);

  // знак месяца
  const top = keys.reduce((a, k) => ((sums[k] ?? 0) > (sums[a] ?? 0) ? k : a), keys[0]);
  const sign = el("div", "ks-sign");
  const rune = el("div", "ks-rune");
  rune.append(el("span", "", "◆"));
  const signText = el("div", "");
  if ((sums[top] ?? 0) === 0) signText.append(el("div", "", t.noSign));
  else {
    signText.append(el("div", "", `${t.signs[top]}${closed === len ? ` + ${t.fullMonth}` : ""}`));
    signText.append(el("div", "ks-sub", t.signNote));
  }
  sign.append(rune, signText);
  wrap.append(sign);
  return wrap;
}
