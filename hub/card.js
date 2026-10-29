// Полная карточка персонажа (автор, 26–29.10; claude/SPEC_CARD.md): нажатие на аватарку или имя.
// Слева — кто ты (портрет, имя, ✓, ранг, КПД, Путь «получил / мог»); в центре — силы полосками, Воля, Интеллект, Стать,
// навыки: 6 направлений и Мастерство; справа — три лика, Память, Знаки (в разработке); внизу — «болото» (только себе).
// Второй лист «Активность» (29.10): столбики опыта сил или навыков и паутина баланса.
// Переключатель «Я / Как видят другие»: другим не видно болото, траты и здоровье. Ранг и КПД — формулы позже («—»).

import { intellectOf, masteryNow, balanceOf, careNow } from "./skills.js";
import { levelNeed, fractionalLevel, totalPoints, addPoints } from "./levels.js";
import { gradeDay, koloDate } from "./kolo.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const fill = (tpl, v = {}) => String(tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const dayDate = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const fmt = (n) => Math.round(n).toLocaleString("ru-RU");

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const POWERS = ["strength", "endurance", "agility", "order", "calm", "morality"];

/** Путь «получил / мог» — чистая функция (тест): мог = каждый день все свои дела хотя бы по разу. */
export function pathOf(d, reward = 5) {
  const total = Math.max(1, d?.total ?? 1);
  let got = 0;
  for (const h of d?.history ?? []) got += h.gains ? Object.values(h.gains).reduce((a, b) => a + b, 0) : (h.done ?? 0) * reward;
  got += Object.values(d?.dayGains ?? {}).reduce((a, b) => a + b, 0);
  const days = (d?.history?.length ?? 0) + 1;
  const could = days * total * reward;
  return { got, could, pct: could ? Math.min(100, Math.round((got / could) * 100)) : 0 };
}

// ---------- Активность (автор, 29.10; SPEC_CARD.md §Активность) ----------
// Столбики — опыт за неделю коло (10 дней) или месяц (30); тень — предыдущий столбик; значок силы — взял ступень или мир открыл новое.
// Справа — «паутина» баланса: шесть сил (Воля в центре) или шесть направлений навыков (Интеллект в центре).
const ICON_DIR = "/assets/hub/ui/stats/";
const ICONS = { strength: "icon_strength.png", endurance: "icon_endurance.png", agility: "icon_agility.png", order: "icon_order.png", calm: "icon_calm.png", morality: "icon_morality.png" };
const WEB_POWERS = ["strength", "agility", "endurance", "morality", "order", "calm"]; // пары — напротив друг друга
const normKey = (k) => {
  const [y, m, dd] = String(k).split("-").map(Number);
  return `${y}-${m}-${dd}`;
};
const keyOf = (x) => `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;

/** Опыт сил по дням: Map(день → { сила: очки, will: очки }). Чистая функция (тест). */
export function powerDays(d) {
  const attrOf = d?.attrOf ?? {};
  const reward = d?.reward ?? 5;
  const out = new Map();
  const add = (day, rec) => {
    const row = {};
    if (rec.gains && Object.keys(rec.gains).length) {
      for (const [id, v] of Object.entries(rec.gains)) if (attrOf[id]) row[attrOf[id]] = (row[attrOf[id]] ?? 0) + v;
    } else for (const [a, n] of Object.entries(rec.attrs ?? {})) row[a] = (row[a] ?? 0) + n * reward;
    row.will = (rec.done ?? 0) + (rec.willBonus ?? 0);
    out.set(normKey(day), row);
  };
  for (const h of d?.history ?? []) add(h.day, h);
  if (d?.day) add(d.day, { gains: d.dayGains, done: d.doneIds?.length ?? d.done, willBonus: d.willBonus });
  return out;
}

/** Навыки по дням: Map(день → { направление: отметок заботы }). */
export function skillDays(lib, care) {
  const blockOf = Object.fromEntries((lib?.skills ?? []).map((x) => [x.id, x.block]));
  const out = new Map();
  for (const [sid, items] of Object.entries(care ?? {})) {
    const b = blockOf[sid];
    if (!b) continue;
    for (const dates of Object.values(items ?? {})) {
      for (const k of dates ?? []) {
        const key = normKey(k);
        const row = out.get(key) ?? {};
        row[b] = (row[b] ?? 0) + 1;
        out.set(key, row);
      }
    }
  }
  return out;
}

/** Столбики: n окон по span дней, последнее кончается сегодня. keys — что складывать; only — одна сила. */
export function barsOf(days, { n = 12, span = 10, today = new Date(), keys = [], only = null, hist = [] } = {}) {
  const closedBy = new Map(hist.map((h) => [normKey(h.day), h.closedBy]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const by = Object.fromEntries(keys.map((k) => [k, 0]));
    let had = 0;
    let closed = 0;
    let rest = 0;
    const list = [];
    for (let j = span - 1; j >= 0; j--) {
      const x = new Date(today);
      x.setDate(today.getDate() - i * span - j);
      const key = keyOf(x);
      list.push(key);
      const row = days.get(key);
      if (row) for (const k of keys) by[k] += row[k] ?? 0;
      const c = closedBy.get(key);
      if (c) had += 1;
      if (c === "player") closed += 1;
      if (c === "rest") rest += 1;
    }
    const total = only ? by[only] ?? 0 : keys.reduce((a, k) => a + by[k], 0);
    out.push({ total, by, had, closed, rest, days: list, from: list[0], to: list[list.length - 1] });
  }
  return out;
}

/** Уровень, который был бы при points очках (обратное к totalPoints). */
function levelAt(curve, points) {
  const f = { level: 0, progress: 0 };
  addPoints(curve, f, Math.max(0, points));
  return fractionalLevel(curve, f);
}

export function initCard(ctx, getDailies) {
  const T = ctx.texts.card ?? {};
  const names = ctx.texts.dailies?.attrs ?? {};
  let others = false;
  let showSpent = false;
  let actSpan = 10;
  let tab = "card"; // «Персонаж» | «Активность» (автор, 29.10: окно лежачее, графику — свой лист)
  let actMode = "powers";
  let actOnly = null;
  let actPick = null;

  function open() {
    ctx.modal.showNode("", build(), "modal-wide modal-card");
  }

  function bar(cls, value, need, attr) {
    const b = el("div", `card-bar ${cls}${attr ? ` a-${attr}` : ""}`);
    const fillNode = el("span", "card-bar-fill");
    fillNode.style.width = `${need ? Math.min(100, (value / need) * 100) : 0}%`;
    b.append(fillNode);
    return b;
  }

  function build() {
    const d = getDailies() ?? {};
    const ch = ctx.character ?? {};
    const flasks = d.flasks ?? {};
    const root = el("div", `pcard${others ? " others" : ""}`);

    // шапка: заголовок и переключатель «Я / Как видят другие»
    const head = el("div", "card-head");
    head.append(el("h2", "card-title", T.title ?? ""));
    const sw = el("div", "card-switch");
    for (const [val, label] of [[false, T.me], [true, T.others]]) {
      const b = el("button", `card-switch-btn${others === val ? " on" : ""}`, label ?? "");
      b.type = "button";
      b.setAttribute("aria-pressed", others === val ? "true" : "false");
      b.addEventListener("click", () => {
        others = val;
        root.replaceWith(build());
      });
      sw.append(b);
    }
    const tabsTop = el("div", "card-switch card-tabs");
    for (const [val, label] of [["card", T.tabCard], ["act", T.tabAct]]) {
      const b = el("button", `card-switch-btn${tab === val ? " on" : ""}`, label ?? "");
      b.type = "button";
      b.setAttribute("aria-pressed", tab === val ? "true" : "false");
      b.addEventListener("click", () => {
        tab = val;
        root.replaceWith(build());
      });
      tabsTop.append(b);
    }
    const headR = el("div", "card-head-r");
    headR.append(tabsTop, sw);
    head.append(headR);
    root.append(head);
    if (tab === "act") {
      root.append(activityView(d, root));
      return root;
    }

    const grid = el("div", "card-grid");
    root.append(grid);

    // ---------- слева: кто ты ----------
    const left = el("div", "card-col card-left");
    const who = el("div", "card-who");
    const portrait = el("div", "card-portrait");
    if (ch.portrait) {
      const img = el("img", "");
      img.src = ch.portrait;
      img.alt = "";
      img.addEventListener("error", () => img.remove());
      portrait.append(img);
    }
    who.append(portrait, el("b", "card-name", ch.name ?? ""), el("span", "card-sub", ch.title ?? ""));
    const ver = el("button", `card-verified${ch.verified ? " yes" : ""}`, ch.verified ? T.verified ?? "" : T.notVerified ?? "");
    ver.type = "button";
    const verNote = el("p", "card-note", ch.verified ? T.verifiedText ?? "" : T.verifyHow ?? "");
    verNote.hidden = true;
    ver.addEventListener("click", () => (verNote.hidden = !verNote.hidden));
    who.append(ver, verNote);
    left.append(who);
    const soonRow = el("div", "card-soon-row");
    soonRow.append(el("span", "", T.rankKpd ?? ""), el("span", "card-mini", T.rankKpdNote ?? ""));
    const P = pathOf(d, d.reward ?? 5);
    const path = el("div", "card-box card-path");
    path.append(el("span", "card-lab", T.path ?? ""));
    const pv = el("div", "card-path-val");
    pv.append(el("b", "", fmt(P.got)), el("span", "", fill(T.pathOf, { could: fmt(P.could) })));
    path.append(pv, bar("path", P.got, P.could), el("span", "card-mini", fill(T.pathPct, { p: P.pct })));
    left.append(path, soonRow);
    grid.append(left);

    // ---------- центр: силы и навыки ----------
    const mid = el("div", "card-col card-mid");
    const powers = el("div", "card-box");
    powers.append(el("span", "card-lab", T.powers ?? ""));
    const will = flasks.will ?? { level: 0, progress: 0 };
    const intel = intellectOf(ctx.skills, masteryNow(), flasks);
    // Воля и Интеллект — сверху, голубым (автор, 29.10); Интеллект — от навыков, его будет мало, как и Воли
    const blue = el("div", "card-blue top");
    const willRow = el("div", "card-pow a-will");
    const wt = el("div", "card-pow-top");
    const willNeed = levelNeed(d.willCurve ?? d.curve, will.level);
    wt.append(el("span", "card-pow-name", names.will ?? "Воля"), el("span", "card-pow-left", fill(T.left, { n: will.level + 1, left: Math.max(0, willNeed - will.progress) })), el("b", "card-pow-lvl", String(will.level)));
    willRow.append(wt, bar("pow", will.progress, willNeed, "will"));
    willRow.title = fill(T.left, { n: will.level + 1, left: Math.max(0, willNeed - will.progress) }); // подсказка при наведении (автор, 29.10)
    const intelRow = el("div", "card-pow a-will card-intel");
    const it = el("div", "card-pow-top");
    it.append(el("span", "card-pow-name", T.intellect ?? ""), el("span", "card-pow-left", T.intellectNote ?? ""), el("b", "card-pow-lvl", String(intel.value)));
    intelRow.append(it);
    intelRow.title = T.intellectNote ?? "";
    blue.append(willRow, intelRow);
    powers.append(blue);
    // строку Тренера убрали (автор, 29.10): перекос — в письмах и в окне «Силы»
    let stat = will.level + intel.value;
    for (const key of POWERS) {
      const f = flasks[key] ?? { level: 0, progress: 0 };
      const need = levelNeed(d.curve, f.level);
      stat += f.level;
      const row = el("div", `card-pow a-${key}`);
      const top = el("div", "card-pow-top");
      top.append(el("span", "card-pow-name", names[key] ?? key), el("span", "card-pow-left", fill(T.left, { n: f.level + 1, left: Math.max(0, need - f.progress) })), el("b", "card-pow-lvl", String(f.level)));
      row.append(top, bar("pow", f.progress, need, key));
      row.title = fill(T.left, { n: f.level + 1, left: Math.max(0, need - f.progress) });
      powers.append(row);
    }
    const statRow = el("div", "card-sum");
    statRow.title = T.statHint ?? "";
    statRow.append(el("span", "", T.stat ?? ""), el("b", "", String(stat)));
    powers.append(statRow);
    mid.append(powers);

    const skills = el("div", "card-box");
    skills.append(el("span", "card-lab", T.skills ?? ""));
    const lib = ctx.skills;
    const bal = lib?.blocks ? balanceOf(lib, masteryNow()) : { val: {}, total: 0 };
    const tiles = el("div", "card-tiles");
    for (const b of lib?.blocks ?? []) {
      const tile = el("div", "card-tile");
      const v = bal.val[b.key] ?? 0;
      const max = (lib.skills ?? []).filter((s) => s.block === b.key).length * 100 || 100;
      tile.append(el("span", "card-tile-name", b.name), el("b", "card-tile-val", String(v)), bar("tile", v, max));
      tiles.append(tile);
    }
    skills.append(tiles);
    const mastery = el("div", "card-sum gold");
    mastery.title = T.masteryHint ?? "";
    mastery.append(el("span", "", T.mastery ?? ""), el("b", "", String(bal.total ?? 0)));
    skills.append(mastery);
    mid.append(skills);
    grid.append(mid);

    // ---------- справа: лики, память, знаки ----------
    const right = el("div", "card-col card-right");
    const faces = el("div", "card-box");
    faces.append(el("span", "card-lab", T.faces ?? ""));
    const fl = el("div", "card-faces");
    for (let i = 0; i < 3; i++) fl.append(el("span", "card-face", "?"));
    faces.append(fl, el("span", "card-mini", T.facesNote ?? ""));
    const mem = el("div", "card-box");
    mem.append(el("span", "card-lab", T.memory ?? ""));
    const hist = d.history ?? [];
    const first = hist[0]?.day ?? d.day;
    const daysIn = first ? Math.round((dayDate(d.day ?? first) - dayDate(first)) / 86400000) + 1 : 1;
    let run = 0;
    for (let i = hist.length - 1; i >= 0 && hist[i].closedBy === "player"; i--) run += 1;
    if (d.closed) run += 1;
    const closed = hist.filter((h) => h.closedBy === "player").length + (d.closed ? 1 : 0);
    const k = koloDate();
    const line = (label, value) => {
      const r = el("div", "card-line");
      r.append(el("span", "", label), el("b", "", value));
      return r;
    };
    mem.append(line(T.daysIn, String(daysIn)), line(T.streak, fill(T.daysN, { n: run })), line(T.closed, String(closed)), line(T.kolo, fill(T.koloVal, { m: k.month, w: k.week, d: k.wday })));
    // Знаки — в разработке (автор, 29.10)
    const signs = el("div", "card-box card-signs soon");
    signs.append(el("span", "card-lab", T.signs ?? ""), el("span", "card-mini", T.signsSoon ?? ""));
    right.append(faces, mem, signs);
    if (!others) {
      const health = el("button", "card-health", T.health ?? "");
      health.type = "button";
      health.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:open-health")));
      right.append(health);
    }
    grid.append(right);

    // ---------- низ: болото (график — на листе «Активность») ----------
    if (!others) {
      const swamp = el("details", "card-box card-swamp");
      const sum = el("summary", "", T.swamp ?? "");
      swamp.append(sum, el("span", "card-mini", T.swampNote ?? ""));
      const tog = el("label", "card-spent-tog");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = showSpent;
      cb.addEventListener("change", () => {
        showSpent = cb.checked;
        const fresh = build();
        root.replaceWith(fresh);
        fresh.querySelector(".card-swamp")?.setAttribute("open", "");
      });
      tog.append(cb, document.createTextNode(T.showSpent ?? ""));
      swamp.append(tog);
      const list = el("div", "card-days");
      for (const h of [...hist].reverse().slice(0, 30)) {
        const g = gradeDay(h, d.total);
        const r = el("div", `card-day g-${g ?? "off"}`);
        r.append(el("span", "card-day-dot"), el("span", "", dayDate(h.day).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })), el("span", "", fill(T.dayDone, { n: h.done ?? 0 })));
        if (showSpent && h.spent) r.append(el("span", "card-day-spent", `−${h.spent}`));
        list.append(r);
      }
      if (!hist.length) list.append(el("span", "card-mini", T.noDays ?? ""));
      swamp.append(list);
      root.append(swamp);
    }
    return root;
  }

  // ---------- лист «Активность» ----------
  function activityView(d, root) {
    const rebuild = () => {
      const fresh = build();
      document.querySelector(".pcard")?.replaceWith(fresh);
    };
    const lib = ctx.skills ?? {};
    const powers = actMode === "powers";
    const keys = powers ? POWERS : (lib.blocks ?? []).map((b) => b.key);
    const label = (k) => (k === "will" ? names.will ?? "Воля" : powers ? names[k] ?? k : (lib.blocks ?? []).find((b) => b.key === k)?.name ?? k);
    const box = el("div", "card-box act");

    // кнопки: Силы / Навыки, Недели / Месяцы; второй ряд — одна сила или навык
    const head = el("div", "act-head");
    const chip = (parent, text, on, cls, fn) => {
      const b = el("button", `act-chip${on ? " on" : ""}${cls ? ` ${cls}` : ""}`, text ?? "");
      b.type = "button";
      b.addEventListener("click", fn);
      parent.append(b);
    };
    const modes = el("div", "act-chips");
    for (const [m, text] of [["powers", T.actPowers], ["skills", T.actSkills]]) chip(modes, text, actMode === m, "", () => ((actMode = m), (actOnly = null), (actPick = null), rebuild()));
    const spans = el("div", "act-chips");
    for (const [sp, text] of [[10, T.weeks], [30, T.months]]) chip(spans, text, actSpan === sp, "", () => ((actSpan = sp), (actPick = null), rebuild()));
    head.append(modes, spans);
    const sub = el("div", "act-chips sub");
    chip(sub, powers ? T.actAllPowers : T.actAllSkills, !actOnly, "", () => ((actOnly = null), rebuild()));
    if (powers) chip(sub, names.will ?? "Воля", actOnly === "will", "blue", () => ((actOnly = "will"), rebuild()));
    for (const k of keys) chip(sub, label(k), actOnly === k, "", () => ((actOnly = k), rebuild()));
    box.append(head, sub);

    // данные
    const days = powers ? powerDays(d) : skillDays(lib, careNow());
    const n = actSpan === 10 ? 12 : 13;
    const today = d.day ? dayDate(d.day) : new Date();
    const bars = barsOf(days, { n, span: actSpan, today, keys: powers ? [...keys, "will"] : keys, only: actOnly, hist: d.history ?? [] });
    if (!actOnly) for (const b of bars) b.total = keys.reduce((a, k) => a + (b.by[k] ?? 0), 0);
    // значки: ступени и открытия (только у сил)
    const events = new Map();
    if (powers) {
      const tasks = Object.fromEntries((d.allTasks ?? d.tasks ?? []).map((x) => [x.id, x]));
      const push = (day, attr, text) => {
        if (actOnly && actOnly !== attr) return;
        const k = normKey(day);
        events.set(k, [...(events.get(k) ?? []), { attr, text }]);
      };
      for (const [id, e] of Object.entries(d.steps ?? {})) {
        const task = tasks[id];
        if (!e?.raisedAt || !task) continue;
        push(e.raisedAt, task.attr, fill(T.actStep, { name: task.steps?.[e.step]?.name ?? task.name, n: ROMAN[e.step] ?? e.step + 1 }));
      }
      for (const [id, day] of Object.entries(d.openedAt ?? {})) if (tasks[id]) push(day, tasks[id].attr, fill(T.actOpened, { name: tasks[id].name }));
    }
    const evOf = (b) => b.days.flatMap((k) => events.get(k) ?? []);
    const pick = actPick ?? n - 1;

    const grid = el("div", "act-grid");
    const leftCol = el("div", "act-left");
    leftCol.append(barsSvg(bars, evOf, pick, (i) => ((actPick = i), rebuild())));

    // пояснение к выбранному столбику
    const b = bars[pick];
    const prev = bars[pick - 1];
    const ex = el("div", "act-ex");
    const dt = (k) => dayDate(k).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const h4 = el("div", "act-ex-h");
    h4.append(el("b", "", actSpan === 10 ? T.actWeek ?? "" : T.actMonth ?? ""), el("span", "", `${dt(b.from)} — ${dt(b.to)}`));
    ex.append(h4);
    const row = (a, v, note, cls) => {
      const r = el("div", "act-row");
      r.append(el("span", "", a), el("b", "", v), el("i", cls ?? "", note ?? ""));
      ex.append(r);
    };
    const diff = prev ? b.total - prev.total : 0;
    row(powers ? T.actExp : T.actCare, fmt(b.total), prev && diff ? fill(diff > 0 ? T.actUp : T.actDown, { n: fmt(Math.abs(diff)) }) : "", diff > 0 ? "up" : "");
    if (!actOnly && b.total > 0) {
      const sorted = keys.map((k) => [k, b.by[k] ?? 0]).sort((x, y) => y[1] - x[1]);
      row(T.actMost, label(sorted[0][0]), fill(T.actPts, { n: fmt(sorted[0][1]) }));
      const low = sorted[sorted.length - 1];
      row(T.actLeast, label(low[0]), fill(low[1] ? T.actPts : T.actZero, { n: fmt(low[1]) }) + (T.actPull ?? ""));
    }
    row(T.actDays, fill(T.actOf, { n: b.closed, all: b.days.length }), b.rest ? fill(T.actRest, { n: b.rest }) : "");
    if (powers) {
      const ev = evOf(b);
      row(T.actSteps, ev.length ? String(ev.length) : "—", ev.length ? ev.slice(0, 3).map((e) => e.text).join(" · ") + (ev.length > 3 ? fill(T.actMore, { n: ev.length - 3 }) : "") : T.actNoSteps);
    }
    ex.append(el("span", "card-mini act-tip", T.actTip ?? ""));
    leftCol.append(ex);

    // паутина баланса
    const rightCol = el("div", "act-right");
    let center;
    let vals;
    let ago = null;
    let order;
    if (powers) {
      order = WEB_POWERS;
      const fl = d.flasks ?? {};
      const last30 = Object.fromEntries(order.map((k) => [k, 0]));
      for (let j = 0; j < 30; j++) {
        const x = new Date(today);
        x.setDate(today.getDate() - j);
        const row2 = days.get(keyOf(x));
        if (row2) for (const k of order) last30[k] += row2[k] ?? 0;
      }
      vals = order.map((k) => fractionalLevel(d.curve, fl[k]));
      ago = order.map((k) => levelAt(d.curve, totalPoints(d.curve, fl[k]) - last30[k]));
      center = { name: names.will ?? "Воля", value: fl.will?.level ?? 0 };
    } else {
      order = keys;
      const bal = lib.blocks ? balanceOf(lib, masteryNow()) : { val: {} };
      vals = order.map((k) => bal.val[k] ?? 0);
      center = { name: T.intellect ?? "Интеллект", value: intellectOf(lib, masteryNow(), d.flasks ?? {}).value };
    }
    rightCol.append(el("span", "card-lab", powers ? T.actWebPowers : T.actWebSkills));
    rightCol.append(webSvg(order.map(label), vals, ago, center));
    const max = Math.max(...vals);
    const note = max <= 0 ? T.actWebEmpty : fill(T.actWebNote, { lead: label(order[vals.indexOf(max)]), lag: label(order[vals.indexOf(Math.min(...vals))]), center: center.name });
    rightCol.append(el("span", "act-web-note", note ?? ""));
    if (ago) rightCol.append(el("span", "card-mini", T.actWebLegend ?? ""));
    grid.append(leftCol, rightCol);
    box.append(grid);
    return box;
  }

  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (parent, tag, attrs, text) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };

  // столбики опыта: тень — предыдущий, значок силы — ступень/открытие, нажатие — пояснение
  function barsSvg(bars, evOf, pick, onPick) {
    const W = 760;
    const H = 250;
    const top = 44;
    const base = H - 26;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "act-bars");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", T.activity ?? "");
    const defs = svgEl(svg, "defs");
    const lg = svgEl(defs, "linearGradient", { id: "actGold", x1: 0, y1: 0, x2: 0, y2: 1 });
    svgEl(lg, "stop", { offset: 0, "stop-color": "#f7e2a4" });
    svgEl(lg, "stop", { offset: 1, "stop-color": "#b07f2e" });
    svgEl(svg, "line", { x1: 0, x2: W, y1: base, y2: base, class: "act-axis" });
    const max = Math.max(1, ...bars.map((b) => b.total)) * 1.08;
    const step = W / bars.length;
    const bw = Math.min(42, step * 0.62);
    bars.forEach((b, i) => {
      const g = svgEl(svg, "g", { class: `act-bar${i === pick ? " on" : ""}`, tabindex: 0 });
      g.addEventListener("click", () => onPick(i));
      g.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && onPick(i));
      const x = i * step + (step - bw) / 2;
      const h = ((base - top) * b.total) / max;
      svgEl(g, "rect", { x: i * step, y: 0, width: step, height: H, fill: "transparent" });
      if (i > 0 && bars[i - 1].total > 0) {
        const hp = ((base - top) * bars[i - 1].total) / max;
        svgEl(g, "rect", { x: x + 7, y: base - hp, width: bw, height: hp, rx: 3, class: "act-shadow" });
      }
      if (h > 0) svgEl(g, "rect", { x, y: base - h, width: bw, height: h, rx: 3, fill: "url(#actGold)", class: "act-fill" });
      const inside = h > 20;
      if (b.total > 0) svgEl(g, "text", { x: x + bw / 2, y: inside ? base - h + 15 : base - h - 5, "text-anchor": "middle", class: inside ? "act-num in" : "act-num" }, fmt(b.total));
      const ev = evOf(b);
      if (ev.length) {
        const cy = base - h - (inside ? 20 : 34);
        const ig = svgEl(g, "g", { class: "act-ev" });
        svgEl(ig, "title", {}, ev.map((e) => e.text).join("\n"));
        svgEl(ig, "circle", { cx: x + bw / 2, cy, r: 15, class: "act-ev-bg" });
        if (ICONS[ev[0].attr]) svgEl(ig, "image", { href: ICON_DIR + ICONS[ev[0].attr], x: x + bw / 2 - 14, y: cy - 14, width: 28, height: 28 });
        else svgEl(ig, "text", { x: x + bw / 2, y: cy + 5, "text-anchor": "middle", class: "act-num" }, "◆");
        if (ev.length > 1) svgEl(ig, "text", { x: x + bw / 2 + 15, y: cy - 8, class: "act-plus" }, `+${ev.length - 1}`);
      }
      svgEl(g, "text", { x: x + bw / 2, y: H - 8, "text-anchor": "middle", class: "act-lab" }, dayDate(b.from).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", ""));
    });
    if (bars.every((b) => !b.total)) svgEl(svg, "text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "act-empty" }, T.noDays ?? "");
    return svg;
  }

  // паутина: шесть лучей, пары напротив; пунктир — месяц назад; центр ярче, когда фигура ровнее
  function webSvg(labels, vals, ago, center) {
    const S = 330;
    const cx = S / 2;
    const cy = S / 2;
    const R = 108;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${S} ${S}`);
    svg.setAttribute("class", "act-web");
    const max = Math.max(1, ...vals, ...(ago ?? []));
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    };
    const poly = (arr) => arr.map((v, i) => pt(i, v).map((z) => z.toFixed(1)).join(",")).join(" ");
    for (const k of [0.25, 0.5, 0.75, 1]) svgEl(svg, "polygon", { points: poly(labels.map(() => k)), class: "act-web-grid" });
    labels.forEach((name, i) => {
      const [x, y] = pt(i, 1);
      svgEl(svg, "line", { x1: cx, y1: cy, x2: x, y2: y, class: "act-web-grid" });
      const [lx, ly] = pt(i, 1.25);
      svgEl(svg, "text", { x: lx, y: ly + 5, "text-anchor": "middle", class: "act-web-lab" }, name);
    });
    if (ago) svgEl(svg, "polygon", { points: poly(ago.map((v) => v / max)), class: "act-web-ago" });
    svgEl(svg, "polygon", { points: poly(vals.map((v) => v / max)), class: "act-web-now" });
    const hi = Math.max(...vals);
    const even = hi > 0 ? Math.min(...vals) / hi : 0;
    const defs = svgEl(svg, "defs");
    const rg = svgEl(defs, "radialGradient", { id: "actCore" });
    svgEl(rg, "stop", { offset: 0, "stop-color": "#d8ecff" });
    svgEl(rg, "stop", { offset: 0.6, "stop-color": "rgba(140,196,240,0.55)" });
    svgEl(rg, "stop", { offset: 1, "stop-color": "rgba(140,196,240,0)" });
    svgEl(svg, "circle", { cx, cy, r: 24, fill: "url(#actCore)", opacity: (0.45 + 0.55 * even).toFixed(2) });
    svgEl(svg, "text", { x: cx, y: cy + 2, "text-anchor": "middle", class: "act-core" }, String(center.value));
    svgEl(svg, "text", { x: cx, y: cy + 14, "text-anchor": "middle", class: "act-core-lab" }, center.name);
    return svg;
  }

  return { open };
}
