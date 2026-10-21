// Задания на неделю и месяц (04.10.2026). Библиотека — hub/quests.json.
// Срок — по коло (kolo.js): неделя = 10 дней, месяц = 30 дней (13-й месяц — одна короткая неделя 5–6 дней);
// закрываются сами по сроку. В коротком сроке цели «само» уменьшаются пропорционально.
// Награда — только если закрыты ВСЕ задания срока. auto-задания считаются из ежедневных (событие hub:dailies).

import { koloDate, MONTH_DAYS, WEEK_DAYS } from "./kolo.js";

const KEY = "gibrid.quests.v1";
const DAY_MS = 86_400_000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtText(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

function periodKeys(now = koloDate()) {
  return { week: `${now.year}-${now.month}-${now.week}`, month: `${now.year}-${now.month}`, weekNo: now.week, now };
}

function load() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}
function save(state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // хранилище недоступно — прогресс до перезагрузки
  }
}

// Новый срок — отметки обнуляются (неделя/месяц закрываются сами).
function roll(state) {
  const keys = periodKeys();
  for (const kind of ["week", "month"]) {
    if (state[kind]?.key !== keys[kind]) {
      if (state[kind]) {
        state.history ??= [];
        state.history.push({ kind, key: state[kind].key, manual: state[kind].manual, bonus: state[kind].bonusGiven });
        state.history = state.history.slice(-100);
      }
      state[kind] = { key: keys[kind], manual: [], bonusGiven: false };
    }
  }
  return state;
}

function parseDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Дни дейликов (история + сегодня) с датой коло.
function dailyDays(d) {
  if (!d) return [];
  const days = (d.history ?? []).map((h) => ({ ...h, kolo: koloDate(parseDayKey(h.day)) }));
  const attrs = {};
  for (const id of d.doneIds ?? []) {
    const attr = d.tasks.find((t) => t.id === id)?.attr;
    if (attr) attrs[attr] = (attrs[attr] ?? 0) + 1;
  }
  days.push({ day: d.day, done: d.done, attrs, closedBy: d.closed ? "player" : null, kolo: koloDate() });
  return days;
}

function inPeriod(kind, k, now) {
  if (k.year !== now.year || k.month !== now.month) return false;
  return kind === "month" || k.week === now.week;
}

// длина срока и цель «само» (в коротком 13-м месяце цель уменьшается пропорционально)
function periodLen(kind, now) {
  return kind === "week" ? now.weekLen : now.monthLen;
}
function targetOf(task, kind, now) {
  const base = kind === "week" ? WEEK_DAYS : MONTH_DAYS;
  const len = periodLen(kind, now);
  return len < base ? Math.max(1, Math.ceil((task.auto.target * len) / base)) : task.auto.target;
}
// название с подстановкой: {n} — цель, {of} — дней в сроке
function nameOf(task, kind, now) {
  return task.auto ? task.name.replace("{n}", String(targetOf(task, kind, now))).replace("{of}", String(periodLen(kind, now))) : task.name;
}

function progressOf(task, kind, days, manual, now) {
  if (!task.auto) return { cur: manual.includes(task.id) ? 1 : 0, target: 1 };
  const list = days.filter((x) => inPeriod(kind, x.kolo, now));
  let cur = 0;
  if (task.auto.type === "daysClosed") cur = list.filter((x) => x.closedBy === "player").length;
  if (task.auto.type === "daysWithAttr") cur = list.filter((x) => task.auto.attrs.some((a) => (x.attrs?.[a] ?? 0) > 0)).length;
  const target = targetOf(task, kind, now);
  return { cur: Math.min(cur, target), target };
}

export function initQuests(ctx, getDailies) {
  const lib = ctx.quests;
  const t = ctx.texts.quests;
  const state = roll(load());
  save(state);
  let tab = "week";
  let openNode = null;

  function compute() {
    const days = dailyDays(getDailies());
    const { now } = periodKeys();
    const out = {};
    for (const kind of ["week", "month"]) {
      const tasks = lib[kind].tasks.filter((x) => x.attr !== "dev");
      const rows = lib[kind].tasks.map((task) => ({ task, ...progressOf(task, kind, days, state[kind].manual, now) }));
      const done = rows.filter((r) => r.task.attr !== "dev" && r.cur >= r.target).length;
      out[kind] = { rows, done, total: tasks.length };
    }
    return out;
  }

  // бонус — только когда закрыто всё; если отметку сняли — бонус возвращается
  function settleBonus(p) {
    for (const kind of ["week", "month"]) {
      const all = p[kind].done === p[kind].total;
      if (all && !state[kind].bonusGiven) {
        state[kind].bonusGiven = true;
        document.dispatchEvent(new CustomEvent("hub:add-exp", { detail: { amount: lib[kind].bonus.exp, reason: t.bonusToast[kind] } }));
      } else if (!all && state[kind].bonusGiven) {
        state[kind].bonusGiven = false;
        document.dispatchEvent(new CustomEvent("hub:add-exp", { detail: { amount: -lib[kind].bonus.exp, reason: t.bonusBack } }));
      }
    }
    save(state);
  }

  function refresh() {
    if (roll(state)) save(state);
    const p = compute();
    settleBonus(p);
    // для очков пути: сколько недель/месяцев закрыто целиком в этом сезоне (год коло)
    const year = `${periodKeys().now.year}-`;
    const full = (kind) =>
      (state.history ?? []).filter((h) => h.kind === kind && h.bonus && h.key.startsWith(year)).length + (state[kind].bonusGiven ? 1 : 0);
    document.dispatchEvent(new CustomEvent("hub:quests", { detail: { weekDone: p.week.done, weekTotal: p.week.total, monthDone: p.month.done, monthTotal: p.month.total, fullWeeks: full("week"), fullMonths: full("month") } }));
    if (openNode?.isConnected) render(openNode, p);
  }

  // 17.10 (автор): день, неделя и месяц — одно окно на одном фоне. Вкладка «День» — та же доска ежедневок из хаба (hub.js),
  // она на время переезжает сюда и возвращается на место, когда окно закрыли или выбрали другую вкладку.
  let boardHome = null;
  function dailiesBoard() {
    return document.querySelector(".dailies-board");
  }
  function returnBoard() {
    const board = dailiesBoard();
    if (!board || !boardHome || !board.classList.contains("in-quests")) return;
    board.classList.remove("in-quests");
    board.hidden = true;
    boardHome.append(board);
  }
  function dayCount() {
    const meta = document.querySelector(".dailies-meta")?.textContent ?? "";
    const m = meta.match(/(\d+)\s*\S+\s*(\d+)/);
    return m ? `${m[1]}/${m[2]}` : "";
  }

  function render(node, p = compute()) {
    const { now, weekNo } = periodKeys();
    returnBoard();
    node.replaceChildren();
    node.classList.toggle("qb-day", tab === "day");
    const top = el("div", "qb-top");
    const tabs = el("div", "qb-tabs");
    for (const kind of ["day", "week", "month"]) {
      const count = kind === "day" ? dayCount() : `${p[kind].done}/${p[kind].total}`;
      const b = el("button", `qb-tab${tab === kind ? " on" : ""}`, count ? `${t.tabs[kind]} · ${count}` : t.tabs[kind]);
      b.type = "button";
      b.addEventListener("click", () => {
        tab = kind;
        render(node);
      });
      tabs.append(b);
    }
    const term = el("div", "qb-term");
    if (tab === "day") {
      term.append(el("b", "", fmtText(t.dayTerm, { d: now.wday, w: weekNo })));
    } else {
      const left = tab === "week" ? now.weekLen - now.wday : now.monthLen - now.day;
      term.append(el("b", "", tab === "week" ? `${weekNo} ${t.weekWord}` : `${now.month} ${t.monthWord}`), el("span", "", ` · ${t.left} ${left} ${t.daysShort}`));
    }
    top.append(tabs, term);
    node.append(top);
    if (tab === "day") {
      const board = dailiesBoard();
      if (board) {
        if (!board.classList.contains("in-quests")) boardHome = board.parentElement;
        board.classList.add("in-quests");
        board.hidden = false;
        node.append(board);
      }
      return;
    }

    const list = el("div", "qb-list");
    for (const { task, cur, target } of p[tab].rows) {
      const dev = task.attr === "dev";
      const done = !dev && cur >= target;
      const row = el(task.auto || dev ? "div" : "label", `qb-row${done ? " done" : ""}${dev ? " dev" : ""}`);
      if (!task.auto) {
        const check = el("input");
        check.type = "checkbox";
        check.checked = done;
        check.disabled = dev;
        check.addEventListener("change", () => {
          const m = state[tab].manual;
          state[tab].manual = check.checked ? [...m, task.id] : m.filter((id) => id !== task.id);
          save(state);
          refresh();
        });
        row.append(check);
      } else row.append(el("span", `qb-auto-ck${done ? " on" : ""}`, done ? "✓" : ""));
      row.append(el("span", "qb-name", nameOf(task, tab, now)));
      if (task.attr) row.append(el("span", `dailies-tag tag-${task.attr}`, ctx.texts.dailies.attrShort[task.attr]));
      if (target > 1) {
        const bar = el("span", "qb-bar");
        const fill = el("i");
        fill.style.width = `${(cur / target) * 100}%`;
        bar.append(fill);
        row.append(bar, el("span", "qb-prog", `${cur} / ${target}`));
      }
      list.append(row);
    }
    list.append(el("div", "dailies-add", t.addOwn));
    node.append(list);

    const bonus = el("div", `qb-bonus${state[tab].bonusGiven ? " got" : ""}`);
    bonus.append(el("span", "", t.bonusLabel[tab]), el("b", "", state[tab].bonusGiven ? t.bonusGot : lib[tab].bonus.text));
    node.append(bonus);
    node.append(el("p", "qb-hint", t.hint));
  }

  document.addEventListener("hub:dailies", refresh);
  window.setInterval(refresh, 60_000);
  refresh();

  document.addEventListener("hub:modal-closed", returnBoard);
  document.addEventListener("hub:quests-open", (event) => open(event.detail?.tab));

  function open(which) {
    if (which === "day" || which === "week" || which === "month") tab = which;
    openNode = el("div", "quests-board");
    render(openNode);
    // 17.10: живописный фон от ChatGPT (доска путника) — живое лежит на нарисованных табличках и строках
    ctx.modal.showNode(t.title, openNode, "modal-art modal-quests");
  }

  return {
    open,
  };
}
