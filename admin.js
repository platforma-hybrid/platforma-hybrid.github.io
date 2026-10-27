// Режим «Числа» (автор, 22.10): ?admin=1 — панель справа, где можно ставить любые числа и смотреть, как растут окна.
// Это ПРОВЕРКА: перед первым изменением настоящий прогресс откладывается в сторону (gibrid.admin.real),
// «Вернуть моё» кладёт его обратно. Пока проверка идёт — сверху висит заметная полоса «ПРОВЕРКА».
// Подопечные и забота навыков (растения, питомцы) не трогаются никогда.

import { gradeDay } from "./kolo.js";
import { addPoints, fractionalLevel, levelNeed } from "./levels.js";

const KEYS = ["gibrid.dailies.v1", "gibrid.quests.v1", "gibrid.achievements.v1", "gibrid.skills.v1", "gibrid.stats.seen.v1"];
const REAL = "gibrid.admin.real";
const UNDO = "gibrid.admin.undo";
const FOLD = "gibrid.admin.fold";
const UNDO_MAX = 40;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const ls = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // хранилище недоступно — режим чисел не работает
    }
  },
  json(key, fallback) {
    try {
      return JSON.parse(ls.get(key) ?? "null") ?? fallback;
    } catch {
      return fallback;
    }
  },
};

const snapshot = () => Object.fromEntries(KEYS.map((k) => [k, ls.get(k)]));
const restore = (snap) => KEYS.forEach((k) => ls.set(k, snap[k] ?? null));
export const sandboxOn = () => ls.get(REAL) !== null;

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// ---------- модель ----------

function freshDailies(data) {
  return { day: dayKey(new Date()), wallet: 0, earned: 0, flasks: structuredClone(data.start.flasks), done: [], bought: [], closed: false, history: [], willTasks: {}, curveV: 3, picked: [...(data.pick?.default ?? [])] };
}
function loadDailies(data) {
  const s = ls.json("gibrid.dailies.v1", null);
  if (!s || !s.flasks) return freshDailies(data);
  for (const key of data.flasks) s.flasks[key] ??= structuredClone(data.start.flasks[key]);
  s.history ??= [];
  s.done ??= [];
  s.bought ??= [];
  s.earned ??= 0;
  return s;
}
function addFlask(state, key, amount, curve) {
  const f = (state.flasks[key] ??= { level: 0, progress: 0 });
  addPoints(curve, f, amount);
}
// дни истории подряд до вчерашнего: самый старый — первый
function renumberHistory(state) {
  const n = state.history.length;
  state.history.forEach((h, i) => {
    h.day = dayKey(daysAgo(n - i));
  });
}
function activeTasks(data) {
  return data.groups.flatMap((g) => g.tasks).filter((t) => t.attr && t.attr !== "dev");
}
// «мои задания дня» (26.10): «Числа» играют выбранными заданиями — как настоящий игрок
function pickedTasks(state, data) {
  const all = activeTasks(data);
  const ids = state.picked?.length ? state.picked : data.pick?.default ?? [];
  const mine = all.filter((t) => ids.includes(t.id));
  return mine.length ? mine : all;
}
// один сданный день — по тем же правилам, что доска заданий (25.10): сила +reward за дело; Воля +1 за дело,
// +1 за отстающую силу пары; сданный день по цвету — красный +1, жёлтый +5, зелёный +12 (прибавка за равновесие здесь не считается)
let PAIR = {};
function playDay(state, data, tasks) {
  const r = data.reward;
  const curve = data.levelCurve;
  const W = data.will ?? { perTask: 1, lagging: 1, day: { red: 1, yellow: 5, green: 12 } };
  const attrs = {};
  let will = 0;
  for (const t of tasks) {
    state.wallet += r;
    state.earned = (state.earned ?? 0) + r;
    const pair = PAIR[t.attr];
    const lag = pair && state.flasks[pair] && state.flasks[t.attr] && fractionalLevel(curve, state.flasks[t.attr]) < fractionalLevel(curve, state.flasks[pair]);
    will += W.perTask + (lag ? W.lagging : 0);
    if (data.flasks.includes(t.attr)) addFlask(state, t.attr, r, curve);
    attrs[t.attr] = (attrs[t.attr] ?? 0) + 1;
  }
  let dayWill = 0;
  if (tasks.length) dayWill = W.day?.[gradeDay({ closedBy: "player", done: tasks.length }, pickedTasks(state, data).length) ?? "red"] ?? 0;
  addFlask(state, "will", will + dayWill, data.willCurve ?? curve);
  state.history.push({ day: "", done: tasks.length, ids: tasks.map((t) => t.id), attrs, spent: 0, closedBy: "player", willBonus: dayWill });
  state.history = state.history.slice(-400);
}
// выбрать задания дня: доля от всех, с уклоном в одну силу
function pickTasks(state, data, share, lean, seed) {
  const all = pickedTasks(state, data);
  const n = Math.max(0, Math.min(all.length, Math.round(all.length * share)));
  let i = seed;
  const order = [...all].sort((a, b) => {
    const wa = lean && a.attr === lean ? -1 : 0;
    const wb = lean && b.attr === lean ? -1 : 0;
    return wa - wb || ((a.id.length * 7 + (i += 3)) % 5) - ((b.id.length * 7 + i) % 5);
  });
  return order.slice(0, n);
}
function simulate(state, data, days, share, lean = null) {
  for (let d = 0; d < days; d++) {
    // дни разные: зелёные, жёлтые, иногда пропуск
    const wobble = [1, 0.8, 1, 0.6, 1, 0.9, 0.4, 1, 0.85, 1][d % 10];
    playDay(state, data, pickTasks(state, data, Math.min(1, share * wobble), lean, d));
  }
  renumberHistory(state);
}

// ---------- готовые наборы ----------

function skillsPreset(lib, map) {
  const out = {};
  for (const s of lib.skills) out[s.id] = map[s.id] ?? map[s.block] ?? 0;
  return out;
}
function presets(ctx) {
  const data = ctx.dailies;
  const lib = ctx.skills;
  const make = (days, share, lean, skills) => () => {
    const s = freshDailies(data);
    simulate(s, data, days, share, lean);
    return { dailies: s, skills: skillsPreset(lib, skills), clearAch: true };
  };
  return [
    { name: "Всё 0", run: () => ({ dailies: freshDailies(data), skills: {}, clearAch: true }) },
    { name: "Новичок · неделя", run: make(7, 0.45, null, { houseplants: 4, pets: 3, trekking: 3, reading: 2 }) },
    { name: "Середина · 2 месяца", run: make(60, 0.6, null, { body: 12, mind: 10, craft: 9, nature: 12, art: 8, people: 10 }) },
    { name: "Перекос в Мощь", run: make(40, 0.55, "strength", { body: 28, mind: 4, craft: 10, nature: 9, art: 6, people: 8 }) },
    { name: "Через полгода", run: make(180, 0.7, null, { body: 40, mind: 35, craft: 30, nature: 42, art: 28, people: 36 }) },
  ];
}

// ---------- применение ----------

function apply(change) {
  // первый шаг проверки: настоящий прогресс — в сторону
  if (!sandboxOn()) ls.set(REAL, JSON.stringify(snapshot()));
  const undo = ls.json(UNDO, []);
  undo.push(snapshot());
  ls.set(UNDO, JSON.stringify(undo.slice(-UNDO_MAX)));
  change();
  ls.set("gibrid.stats.seen.v1", null); // без вспышек «новый уровень» на каждое изменение
  window.location.reload();
}
function undoLast() {
  const undo = ls.json(UNDO, []);
  const last = undo.pop();
  if (!last) return;
  ls.set(UNDO, JSON.stringify(undo));
  restore(last);
  window.location.reload();
}
function giveBack() {
  const real = ls.json(REAL, null);
  if (real) restore(real);
  ls.set(REAL, null);
  ls.set(UNDO, null);
  const url = new URL(window.location.href);
  url.searchParams.delete("admin");
  window.location.href = url.toString();
}

// ---------- полоса «ПРОВЕРКА» ----------

export function showSandboxBanner(texts) {
  const t = texts.admin;
  const bar = el("div", "adm-banner");
  bar.append(el("b", "", t.banner), el("span", "", t.bannerHint));
  const back = el("button", "", t.giveBack);
  back.type = "button";
  back.addEventListener("click", giveBack);
  const open = el("a", "", t.openPanel);
  const url = new URL(window.location.href);
  url.searchParams.set("admin", "1");
  open.href = url.toString();
  bar.append(open, back);
  document.body.append(bar);
}

// ---------- панель ----------

export function startAdmin(ctx) {
  const t = ctx.texts.admin;
  const data = ctx.dailies;
  const lib = ctx.skills;
  PAIR = Object.fromEntries((ctx.stats.attrs ?? []).map((a) => [a.key, a.pair]));
  const state = loadDailies(data);
  const mastery = ls.json("gibrid.skills.v1", {});
  const names = ctx.texts.dailies?.attrShort ?? {};
  const attrName = Object.fromEntries((ctx.stats.attrs ?? []).map((a) => [a.key, a.name]));

  const panel = el("aside", "adm-panel");
  panel.setAttribute("aria-label", t.title);
  const head = el("h2", "", t.title);
  const fold = el("button", "adm-fold", t.fold);
  fold.type = "button";
  const setFold = (on) => {
    panel.classList.toggle("collapsed", on);
    fold.textContent = on ? t.unfold : t.fold;
    ls.set(FOLD, on ? "1" : null);
  };
  fold.addEventListener("click", () => setFold(!panel.classList.contains("collapsed")));
  head.append(fold);
  panel.append(head);

  const btn = (text, onClick, cls = "") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const section = (title) => {
    const box = el("fieldset");
    box.append(el("legend", "", title));
    panel.append(box);
    return box;
  };
  const numField = (label, value, onSet, { min = 0, max = 9999, step = 1 } = {}) => {
    const row = el("label", "adm-field");
    row.append(el("span", "", label));
    const input = el("input");
    input.type = "number";
    Object.assign(input, { min, max, step, value: String(value) });
    input.addEventListener("change", () => {
      const v = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
      apply(() => onSet(v));
    });
    row.append(input);
    return row;
  };

  // сверху: отменить и вернуть моё
  const top = el("div", "adm-row");
  const undoCount = ls.json(UNDO, []).length;
  const undoBtn = btn(`${t.undo}${undoCount ? ` (${undoCount})` : ""}`, undoLast);
  undoBtn.disabled = undoCount === 0;
  top.append(undoBtn, btn(t.giveBack, giveBack, "adm-back"));
  panel.append(top);
  panel.append(el("p", "adm-help", sandboxOn() ? t.helpOn : t.helpOff));

  // готовые наборы
  const pre = section(t.presets);
  for (const p of presets(ctx)) {
    pre.append(
      btn(p.name, () =>
        apply(() => {
          const r = p.run();
          ls.set("gibrid.dailies.v1", JSON.stringify(r.dailies));
          ls.set("gibrid.skills.v1", JSON.stringify(r.skills));
          if (r.clearAch) ls.set("gibrid.achievements.v1", null);
          ls.set("gibrid.quests.v1", null);
        }),
      ),
    );
  }

  // дни
  const days = section(t.days);
  const share = el("select");
  for (const [v, label] of [["1", t.dayAll], ["0.6", t.dayMost], ["0.3", t.dayFew]]) {
    const o = el("option", "", label);
    o.value = v;
    share.append(o);
  }
  const lean = el("select");
  const none = el("option", "", t.noLean);
  none.value = "";
  lean.append(none);
  for (const key of data.flasks.filter((k) => k !== "will")) {
    const o = el("option", "", `${t.leanTo} ${attrName[key] ?? names[key] ?? key}`);
    o.value = key;
    lean.append(o);
  }
  days.append(share, lean);
  const play = (n) => () =>
    apply(() => {
      const s = loadDailies(data);
      simulate(s, data, n, Number(share.value), lean.value || null);
      ls.set("gibrid.dailies.v1", JSON.stringify(s));
    });
  const dayRow = el("div", "adm-row");
  dayRow.append(btn(t.plus1, play(1)), btn(t.plus7, play(7)), btn(t.plus30, play(30)));
  days.append(dayRow);
  days.append(el("p", "adm-help", `${t.daysNow} ${state.history.length} · ${t.earnedNow} ${state.earned ?? 0}`));

  // силы
  const powers = section(t.powers);
  for (const key of data.flasks) {
    const curve = key === "will" ? data.willCurve ?? data.levelCurve : data.levelCurve;
    const f = state.flasks[key] ?? { level: 0, progress: 0 };
    const row = el("div", "adm-pair");
    row.append(el("span", "adm-name", attrName[key] ?? (key === "will" ? t.will : key)));
    row.append(
      numField(t.level, f.level, (v) => {
        const s = loadDailies(data);
        s.flasks[key] = { level: v, progress: Math.min(s.flasks[key]?.progress ?? 0, levelNeed(curve, v) - 1) };
        ls.set("gibrid.dailies.v1", JSON.stringify(s));
      }),
      numField(t.progress, f.progress, (v) => {
        const s = loadDailies(data);
        s.flasks[key] = { level: s.flasks[key]?.level ?? 0, progress: Math.min(v, levelNeed(curve, s.flasks[key]?.level ?? 0) - 1) };
        ls.set("gibrid.dailies.v1", JSON.stringify(s));
      }, { max: levelNeed(curve, f.level) - 1 }),
    );
    powers.append(row);
  }

  // опыт
  const exp = section(t.exp);
  exp.append(
    numField(t.earned, state.earned ?? 0, (v) => {
      const s = loadDailies(data);
      s.earned = v;
      ls.set("gibrid.dailies.v1", JSON.stringify(s));
    }, { max: 999999 }),
    numField(t.wallet, state.wallet ?? 0, (v) => {
      const s = loadDailies(data);
      s.wallet = v;
      ls.set("gibrid.dailies.v1", JSON.stringify(s));
    }, { max: 999999 }),
  );

  // навыки — по направлениям
  const sk = section(t.skills);
  for (const b of lib.blocks) {
    sk.append(el("div", "adm-sub", b.name));
    for (const s of lib.skills.filter((x) => x.block === b.key)) {
      sk.append(
        numField(s.name, Number(mastery[s.id]) || 0, (v) => {
          const m = ls.json("gibrid.skills.v1", {});
          m[s.id] = v;
          ls.set("gibrid.skills.v1", JSON.stringify(m));
        }, { max: 100 }),
      );
    }
  }

  // достижения
  const ach = section(t.ach);
  ach.append(btn(t.achReset, () => apply(() => ls.set("gibrid.achievements.v1", null))));
  ach.append(el("p", "adm-help", t.achHelp));

  document.body.append(panel);
  if (ls.get(FOLD) === "1") setFold(true);
}
