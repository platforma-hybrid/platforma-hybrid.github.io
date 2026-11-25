// Почта (автор, 26.10; claude/SPEC_MAIL.md): письма от Мира и хранителей — итоги дня, новый уровень, «пора выше», перекос.
// Не больше 3 писем в день: лишнее складывается в одно. Плохое — никогда не упрёк, только «зов обратно».
// Старше 30 дней — в архив (не показываются). Хранится в браузере (localStorage), позже — на сервере и в Эхо.

import { koloDate } from "./kolo.js";

const KEY = "gibrid.mail.v1";
const PER_DAY = 3;
const KEEP_DAYS = 30;
const SEALS = { world: "☉", summary: "✦", mera: "Т", gardener: "❧", kazna: "К" };
const SUMMARY_PARTS = new Set(["day", "period", "growth", "level", "open", "exp"]);

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export const fill = (tpl, v = {}) => String(tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const dayNum = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
};

function load() {
  try {
    const s = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (s && Array.isArray(s.letters)) return s;
  } catch {
    /* хранилище закрыто — почта живёт до перезагрузки */
  }
  return { letters: [], keys: [] };
}
let store = null;
const get = () => (store ??= load());
function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(get()));
  } catch {
    /* молча: почта — не главное, игра работает и без неё */
  }
  document.dispatchEvent(new CustomEvent("hub:mail-changed"));
}

/**
 * Положить письмо в почту. «mir» — личное письмо, «world» — общая весть. Вести идут отдельно от дневного лимита.
 * parts — табличка письма (день, уровни, Хранитель меры, неделя); text — то же простыми словами (запасной вид, позже — Эхо).
 * key — чтобы одно и то же событие не пришло дважды. Четвёртое и дальше письмо дня складывается в третье.
 */
export function addLetter(state, letter, day = todayKey()) {
  if (letter.key && state.keys.includes(letter.key)) return false;
  if (letter.key) state.keys = [...state.keys, letter.key].slice(-600);
  // Сводка за вчера хранит своё начисление отдельно от сводки за сегодня.
  const separate = (entry) => entry.from === "world" || entry.group === "yesterday";
  const todays = separate(letter) ? [] : state.letters.filter((l) => l.day === day && l.key !== "welcome" && !separate(l));
  // одно событие одного рода за день — одним письмом (несколько новых уровней → «Новые уровни»)
  const same = letter.group && todays.find((l) => l.group === letter.group);
  // больше трёх в день — складываем в последнее письмо того же отправителя (или просто в последнее)
  const into = same || (todays.length >= PER_DAY ? [...todays].reverse().find((l) => l.from === letter.from) ?? todays[todays.length - 1] : null);
  if (into) {
    if (same && letter.groupTitle) into.title = letter.groupTitle;
    const sender = letter.from ?? "mir";
    const mixed = folderOf(into.from) !== folderOf(sender);
    // чужое письмо внутри — с заголовком, если текст его ещё не повторяет
    const head = same || into.from === sender || String(letter.text).startsWith(letter.title) ? "" : `${letter.title}. `;
    if (mixed || into.parts?.length || letter.parts?.length) {
      const earlier = into.parts?.length ? into.parts : [{ t: "text", text: into.text }];
      const later = letter.parts?.length ? letter.parts : [{ t: "text", text: head + letter.text }];
      into.parts = [...earlier, ...(mixed ? later.map((part) => ({ ...part, from: sender })) : later)];
    }
    into.text = `${into.text}${same ? "\n" : "\n\n"}${head}${letter.text}`;
    into.read = false;
    return true;
  }
  const title = letter.group && letter.groupTitle ? letter.groupTitle : letter.title;
  state.letters.push({ id: `${day}-${state.letters.length}-${Math.random().toString(36).slice(2, 6)}`, day, key: letter.key, from: letter.from ?? "mir", group: letter.group, title, text: letter.text, ...(letter.parts?.length ? { parts: [...letter.parts] } : {}), read: false });
  // архив: старше 30 дней не храним в списке
  const cut = dayNum(day) - KEEP_DAYS;
  state.letters = state.letters.filter((l) => dayNum(l.day) >= cut).slice(-200);
  return true;
}

/** Понедельник недели дня (номер дня от 1970). */
export const weekStart = (key) => {
  const n = dayNum(key);
  return n - ((new Date(n * 86400000).getUTCDay() + 6) % 7);
};
const monthOf = (key) => String(key).split("-").slice(0, 2).join("-");

/**
 * Сводка за прошедшую неделю и месяц (автор, 27.10: «короткая сводка, не бесконечность информации»).
 * Возвращает [{ kind: "week"|"month", key, days, done, green, xp, best }] — только за закончившиеся периоды.
 * grade(rec) → "green" | "yellow" | "red" | null.
 */
/**
 * cal(dayKey) → { week, month, weekLen, monthLen } — календарь сводок. По умолчанию обычный (неделя 7 дней);
 * в хабе — календарь коло (неделя 10 дней, месяц 30), чтобы почта и коло не расходились (28.10).
 */
const plainCal = (key) => {
  const w = weekStart(key);
  const m = monthOf(key);
  const [y, mm] = m.split("-").map(Number);
  return { week: `week-${w}`, month: `month-${m}`, weekLen: 7, monthLen: new Date(y, mm, 0).getDate() };
};
export function periodSummaries(history, today, grade, cal = plainCal) {
  const out = [];
  const last = history[history.length - 1];
  if (!last) return out;
  const sum = (recs, kind, key) => {
    const s = { kind, key, days: 0, done: 0, green: 0, xp: 0, attrs: {} };
    for (const r of recs) {
      if (r.done) s.days += 1;
      s.done += r.done ?? 0;
      if (grade(r) === "green") s.green += 1;
      s.xp += Object.values(r.gains ?? {}).reduce((a, b) => a + b, 0);
      for (const [a, n] of Object.entries(r.attrs ?? {})) s.attrs[a] = (s.attrs[a] ?? 0) + n;
    }
    s.best = Object.entries(s.attrs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    delete s.attrs;
    return s;
  };
  const L = cal(last.day);
  const now = cal(today);
  if (L.week !== now.week) out.push({ ...sum(history.filter((r) => cal(r.day).week === L.week), "week", L.week), of: L.weekLen });
  if (L.month !== now.month) out.push({ ...sum(history.filter((r) => cal(r.day).month === L.month), "month", L.month), of: L.monthLen });
  return out;
}

export function postMail(letter) {
  if (addLetter(get(), letter)) save();
}

export const unreadCount = (state = get()) => state.letters.filter((l) => !l.read).length;

function folderOf(sender) {
  return Object.hasOwn(SEALS, sender) ? sender : "summary";
}

function partFolder(part, primary) {
  if (part.from && part.from !== "world") return folderOf(part.from);
  if (part.t === "schedule" || (part.t === "mera" && part.kind !== "lag")) return "mera";
  if (SUMMARY_PARTS.has(part.t) || part.kind === "lag") return "summary";
  return primary;
}

export function letterSections(letter) {
  const primary = folderOf(letter.from);
  if (primary === "world" || !letter.parts?.length) return [{ folder: primary, parts: letter.parts }];
  const views = new Map([[primary, []]]);
  for (const part of letter.parts) {
    // Legacy letters lack a sender tag on parts. Their structured blocks still identify the section.
    const folder = partFolder(part, primary);
    if (!views.has(folder)) views.set(folder, []);
    views.get(folder).push(part);
  }
  return [...views].filter(([, parts]) => parts.length).map(([folder, parts]) => ({ folder, parts }));
}

let getDailies = () => null;

export function initMail(box, ctx, icon, dailies) {
  if (dailies) getDailies = dailies;
  const T = ctx.texts.mail ?? {};
  const button = el("button", "mail-button");
  button.type = "button";
  button.setAttribute("aria-label", T.title ?? "");
  const iconHost = el("span", "");
  button.append(iconHost);
  const badge = el("span", "mail-badge");
  button.append(badge);
  box.append(button);
  if (icon) iconHost.replaceWith(icon("mail"));

  const paint = () => {
    const n = unreadCount();
    badge.textContent = String(n);
    badge.hidden = n === 0;
    button.classList.toggle("has-new", n > 0);
    button.setAttribute("aria-label", n ? `${T.title}: ${fill(T.newCount, { n })}` : T.title ?? "");
  };
  document.addEventListener("hub:mail-changed", paint);
  // первое письмо — приветствие Мира
  if (!get().letters.length && !get().keys.length) postMail({ key: "welcome", from: "mir", title: T.welcomeTitle, text: T.welcomeText });
  const currentDay = dayNum(todayKey());
  for (const news of T.worldNews ?? []) {
    const age = currentDay - dayNum(news.day);
    if (age >= 0 && age <= KEEP_DAYS && addLetter(get(), { ...news, key: `world-${news.key}`, from: "world" }, news.day)) save();
  }
  paint();

  button.addEventListener("click", () => ctx.modal.showNode(T.title ?? "", windowNode(), "modal-wide modal-mail mail-reader"));

  function windowNode() {
    const state = get();
    const root = el("div", "mail-window");
    const sidebar = el("aside", "mail-sidebar");
    const folders = el("nav", "mail-folders");
    folders.setAttribute("aria-label", T.foldersLabel);
    const list = el("div", "mail-list");
    const pane = el("div", "mail-pane");
    const letters = [...state.letters].reverse().sort((a, b) => dayNum(b.day) - dayNum(a.day));
    const entries = letters.flatMap((letter) => letterSections(letter).map(({ folder, parts }) => {
      const title = folder === folderOf(letter.from) ? letter.title
        : folder === "mera" && parts?.some((part) => part.t === "schedule") ? T.schedule.title : T.folders[folder];
      return { folder, parts, title, letter };
    }));
    const first = entries.find(({ letter }) => !letter.read) ?? entries[0];
    let folder = first?.folder ?? "summary";
    let openId = first?.letter.id;
    const inFolder = (key) => entries.filter((entry) => entry.folder === key);
    const folderButtons = new Map();
    const today = dayNum(todayKey());
    const dateLabel = (day) => {
      const n = today - dayNum(day);
      return n === 0 ? T.today : n === 1 ? T.yesterday : fill(T.daysAgo, { n });
    };
    for (const key of Object.keys(SEALS)) {
      if (key === "kazna" && !inFolder(key).length) continue;
      const tab = el("button", "mail-folder");
      tab.type = "button";
      const seal = el("span", "mail-folder-seal", SEALS[key]);
      seal.setAttribute("aria-hidden", "true");
      const count = el("span", "mail-folder-count");
      tab.append(seal, el("span", "", T.folders[key]), count);
      tab.addEventListener("click", () => {
        if (folder === key) return;
        folder = key;
        const matches = inFolder(folder);
        openId = (matches.find(({ letter }) => !letter.read) ?? matches[0])?.letter.id;
        list.scrollTop = 0;
        show();
      });
      folders.append(tab);
      folderButtons.set(key, { tab, count });
    }
    const show = () => {
      const matches = inFolder(folder);
      const cur = matches.find(({ letter }) => letter.id === openId);
      if (cur && !cur.letter.read) {
        cur.letter.read = true;
        save();
      }
      for (const [key, { tab, count }] of folderButtons) {
        const unread = inFolder(key).filter(({ letter }) => !letter.read).length;
        tab.setAttribute("aria-pressed", String(key === folder));
        tab.setAttribute("aria-label", unread ? `${T.folders[key]}, ${fill(T.newCount, { n: unread })}` : T.folders[key]);
        count.hidden = unread === 0;
        count.textContent = String(unread);
      }
      list.replaceChildren();
      for (const { letter: l, title } of matches) {
        const row = el("button", `mail-row from-${folder}${l.id === openId ? " open" : ""}${l.read ? "" : " new"}`);
        row.type = "button";
        if (l.id === openId) row.setAttribute("aria-current", "true");
        const txt = el("span", "mail-row-text");
        txt.append(el("span", "mail-row-title", title), el("span", "mail-row-from", dateLabel(l.day)));
        row.append(el("span", `mail-seal from-${folder}`, SEALS[folder]), txt);
        if (!l.read) row.append(el("span", "mail-dot"));
        row.addEventListener("click", (event) => {
          openId = l.id;
          show();
          if (event.detail === 0) list.querySelector(".mail-row.open")?.focus();
        });
        list.append(row);
      }
      if (!matches.length) list.append(el("p", "mail-empty", T.empty));
      pane.replaceChildren();
      if (cur) {
        const { letter, title, parts } = cur;
        const head = el("div", "mail-pane-head");
        const who = el("span", "mail-pane-who");
        who.append(el("b", "", T.from[folder]), el("span", "", dateLabel(letter.day)));
        head.append(el("span", `mail-seal big from-${folder}`, SEALS[folder]), who);
        pane.append(head, el("h3", "", title), parts?.length ? partsNode(parts, T.ui ?? {}, letter.day) : el("p", "mail-text", letter.text));
      }
      pane.append(el("p", "mail-rule", T.rule));
      pane.scrollTop = 0;
    };
    show();
    sidebar.append(folders, list);
    root.append(sidebar, pane);
    return root;
  }
}

// ---------- табличка письма (автор, 27.10: «как и везде — грани, таблички; Воля синим, бонус зелёным») ----------

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const ORDER = { day: 0, period: 0, growth: 1, level: 1, mera: 2, exp: 3 };

function line(label, value, cls = "") {
  const r = el("div", `mail-line ${cls}`);
  r.append(el("span", "mail-line-label", label), el("b", "mail-line-value", value));
  return r;
}

/** Табличка письма. parts: { t: "day" | "level" | "mera" | "period", ... }. */
export function partsNode(parts, U, date) {
  const box = el("div", "mail-parts");
  const sorted = [...parts].sort((a, b) => (ORDER[a.t] ?? 3) - (ORDER[b.t] ?? 3));
  const levels = sorted.filter((p) => p.t === "level");
  let levelsDone = false;
  for (const p of sorted) {
    if (p.t === "day") box.append(dayCard(p, U));
    else if (p.t === "period") box.append(periodCard(p, U));
    else if (p.t === "growth") box.append(growthCard(p, U));
    else if (p.t === "exp") box.append(expLine(p, U));
    else if (p.t === "open") box.append(openCard(p, U));
    else if (p.t === "level" && !levelsDone && !sorted.some((x) => x.t === "growth")) {
      levelsDone = true;
      box.append(levelsCard(levels, U));
    } else if (p.t === "mera") box.append(meraCard(p, U));
    else if (p.t === "schedule") box.append(scheduleCard(p, U, date));
    else if (p.t === "text") box.append(el("p", "mail-text", p.text));
  }
  const day = sorted.find((p) => p.t === "day");
  const exp = sorted.find((p) => p.t === "exp");
  return day && exp ? daySummary(box, day, exp, U) : box;
}

function daySummary(parts, day, exp, U) {
  const root = el("div", "mail-summary");
  const metrics = el("div", "mail-metrics");
  const metric = (label, amount, unit, cls) => {
    const cell = el("div", `mail-metric ${cls}`);
    const value = el("b", "", String(amount));
    if (unit) value.append(el("small", "", ` ${unit}`));
    cell.append(el("span", "", label), value);
    return cell;
  };
  // У писем прежней версии сохранён общий баланс, а сумма зачисления неизвестна.
  const credited = Number.isFinite(exp.credited);
  const will = metric(U.willTitle, sign(day.total), "", "will");
  const willTrack = parts.querySelector(".mail-bar .mail-bar-track");
  if (willTrack) will.append(willTrack);
  metrics.append(metric(credited ? U.expCredited : U.expHand, credited ? exp.credited : exp.hand, U.expUnit, "hand"), will);

  root.append(el("span", `mail-summary-grade g-${day.grade}`, `✓ ${day.gradeName}`), metrics);
  const growth = parts.querySelector(".mail-growth-card");
  if (growth) root.append(growth);

  const actions = el("div", "mail-summary-actions");
  const wallet = parts.querySelector(".mail-wallet-go");
  wallet.textContent = U.expOpen;
  const details = el("details");
  details.append(el("summary", "", U.dayDetails), parts);
  actions.append(wallet, details);
  root.append(actions);
  return root;
}

function scheduleCard(part, U, date) {
  const schedule = el("div", "mail-schedule");
  const [training, rest, holidays] = part.rows ?? [];
  if (!training || !rest || !holidays) {
    schedule.append(el("span", "mail-schedule-note", part.note));
    for (const [label, value] of part.rows ?? []) schedule.append(line(label, value));
    return schedule;
  }
  const numbers = ([, days]) => days.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const trainingDays = new Set(numbers(training));
  const days = [...new Set([...trainingDays, ...numbers(rest)])].sort((a, b) => a - b);
  const current = koloDate();
  const [year, month, day] = String(date ?? "").split("-").map(Number);
  const dateWeek = koloDate(new Date(year, month - 1, day));
  const today = current.year === dateWeek.year && current.month === dateWeek.month && current.week === dateWeek.week ? current.wday : 0;
  const icon = (isTraining) => {
    const image = el("img");
    image.src = `/assets/hub/icons/${isTraining ? "chart" : "leaf"}.svg`;
    image.alt = "";
    return image;
  };
  const week = el("ol", "mail-schedule-week");
  week.setAttribute("aria-label", U.scheduleDays);
  for (const n of days) {
    const isTraining = trainingDays.has(n);
    const tile = el("li", `mail-schedule-day ${isTraining ? "training" : "rest"}`);
    if (n === today) tile.setAttribute("aria-current", "date");
    tile.setAttribute("aria-label", fill(U.scheduleDay, { n, kind: isTraining ? U.training : U.rest }));
    tile.append(icon(isTraining), el("span", "", String(n)));
    week.append(tile);
  }
  const legend = el("div", "mail-schedule-legend");
  const trainingKey = el("span", "training", U.training);
  const restKey = el("span", "rest", U.rest);
  trainingKey.prepend(icon(true));
  restKey.prepend(icon(false));
  legend.append(trainingKey, restKey);
  if (today) legend.append(el("span", "today-key", U.today));
  const holidaysRow = el("div", "mail-schedule-holidays");
  holidaysRow.append(el("span", "", holidays[0]), el("span", "", holidays[1]));
  schedule.append(el("span", "mail-schedule-note", part.note), week, legend, holidaysRow);
  return schedule;
}

// Воля за день: цвет дня — полоска и плашка; Воля — синим; бонус — цветом дня, которого ещё нет — пунктиром
function dayCard(p, U) {
  const card = el("div", `mail-card mail-day-card g-${p.grade}`);
  const head = el("div", "mail-card-head");
  head.append(el("span", "mail-card-title", U.willTitle ?? ""), el("span", `mail-grade g-${p.grade}`, p.gradeName ?? ""));
  card.append(head);
  if (p.grade === "green") {
    card.append(line(U.forDay, sign(p.half), "will"), line(U.bonusFull, sign(p.bonus), "bonus g-green"));
  } else if (p.grade === "yellow") {
    card.append(line(U.forDay, sign(p.base), "will"), line(U.ifFull, sign(p.bonus), "ghost g-green"));
  } else {
    card.append(line(U.forDay, sign(p.base), "will"), line(U.ifHalf, sign(p.half), "ghost g-yellow"), line(U.ifFull, sign(p.bonus), "ghost g-green"));
  }
  if (p.balance) card.append(line(U.balance, sign(p.balance), "will"));
  card.append(line(U.total, sign(p.total), "will total"));
  if (p.bar?.need) card.append(barNode(p.bar, U));
  if (p.note) card.append(el("p", "mail-card-note", p.note));
  return card;
}

function levelsCard(levels, U) {
  const card = el("div", "mail-card mail-levels-card");
  const head = el("div", "mail-card-head");
  head.append(el("span", "mail-card-title", levels.length > 1 ? U.levels ?? "" : U.level ?? ""));
  card.append(head);
  for (const p of levels) {
    const r = el("div", `mail-lvl a-${p.attr}`);
    const txt = el("span", "mail-lvl-text");
    txt.append(el("span", "mail-lvl-name", p.name ?? p.attr), el("span", "mail-lvl-say", p.say ?? ""));
    r.append(txt, el("b", "mail-lvl-n", String(p.n)));
    card.append(r);
  }
  return card;
}

function meraCard(p, U) {
  const card = el("div", "mail-card mail-mera-card");
  const head = el("div", "mail-card-head");
  const title = p.kind === "step" ? U.meraStep : p.kind === "raised" ? U.meraRaised : p.kind === "hello" ? U.meraHello : U.meraLag;
  head.append(el("span", "mail-seal from-mera", "Т"), el("span", "mail-card-title", title ?? ""));
  card.append(head, el("p", "mail-mera-text", p.text ?? ""));
  if (p.kind === "step" && p.task) card.append(stepActs(p, U));
  return card;
}

// «Пора выше»: взять ступень прямо из письма или посмотреть в заданиях; уже взята — кнопки гаснут
function stepActs(p, U) {
  const acts = el("div", "mail-acts");
  const now = getDailies()?.steps?.[p.task]?.step;
  const taken = now !== undefined && now !== p.step;
  if (taken) {
    acts.append(el("span", "mail-acts-done", fill(U.stepTaken, { next: p.next })));
    return acts;
  }
  const take = el("button", "mail-act main", U.stepTake ?? "");
  take.type = "button";
  const show = el("button", "mail-act", U.stepShow ?? "");
  show.type = "button";
  take.addEventListener("click", () => {
    document.dispatchEvent(new CustomEvent("hub:step-take", { detail: { task: p.task, step: p.step } }));
    acts.replaceChildren(el("span", "mail-acts-done", fill(U.stepTakenNow, { name: p.name, next: p.next })));
  });
  show.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:step-show", { detail: { task: p.task } })));
  acts.append(take, show, el("span", "mail-acts-note", U.stepBack ?? ""));
  return acts;
}

function periodCard(p, U) {
  const card = el("div", "mail-card mail-period-card");
  const head = el("div", "mail-card-head");
  head.append(el("span", "mail-card-title", p.kind === "month" ? U.month ?? "" : U.week ?? ""));
  card.append(head);
  card.append(line(U.daysWith, p.of ? `${p.days} ${U.of ?? "из"} ${p.of}` : String(p.days)), line(U.daysFull, String(p.green), "g-green"), line(U.tasks, String(p.done)), line(U.xp, sign(p.xp), "up"));
  if (p.bonus > 0) card.append(line(p.kind === "month" ? U.bonusMonth : U.bonusWeek, `${sign(p.bonus)} ${U.expUnit}`, "up"));
  if (p.bestName) card.append(line(p.kind === "month" ? U.bestMonth : U.bestWeek, p.bestName, `best a-${p.best}`));
  if (p.note) card.append(el("p", "mail-card-note", p.note));
  if (p.koloMonth) {
    const go = el("button", "mail-exp-go mail-kolo-go", U.openKolo ?? "");
    go.type = "button";
    go.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:action", { detail: `kolo-month:${p.koloMonth}` })));
    card.append(go);
  }
  return card;
}

// Анимация полосок: старое — ровным цветом, прибавка дня — светлым, ползёт при открытии письма; числа считаются вверх
const reduceMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
function later(fn, delay = 250) {
  if (typeof requestAnimationFrame === "undefined") return fn();
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(fn, delay)));
}
function countUp(node, from, to, tpl = (v) => String(v), ms = 1400) {
  node.textContent = tpl(from);
  if (from === to || reduceMotion()) return void (node.textContent = tpl(to));
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    node.textContent = tpl(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Дорожка полоски: { from, to, need } → узел + run() (запустить «доползание»). */
function track(b, cls = "") {
  const tr = el("div", `mail-bar-track ${cls}`);
  const old = el("span", "mail-bar-old");
  const gain = el("span", "mail-bar-gain");
  const pct = (v) => Math.min(100, (v / b.need) * 100);
  old.style.width = `${pct(b.from)}%`;
  gain.style.left = `${pct(b.from)}%`;
  gain.style.width = "0%";
  tr.append(old, gain);
  return { node: tr, run: () => (gain.style.width = `${Math.max(0, pct(b.to) - pct(b.from))}%`) };
}

// Полоска Воли под «Всего Воле»
function barNode(b, U) {
  const box = el("div", "mail-bar");
  const head = el("div", "mail-bar-head");
  const num = el("b", "mail-bar-num", `${b.from} / ${b.need}`);
  head.append(el("span", "mail-bar-lvl", fill(b.up ? U.barUp : U.barLvl, { n: b.lvl })), num);
  const tr = track(b);
  box.append(head, tr.node, el("span", "mail-bar-left", fill(U.barLeft, { n: b.lvl + 1, left: Math.max(0, b.need - b.to) })));
  later(() => {
    tr.run();
    countUp(num, b.from, b.to, (v) => `${v} / ${b.need}`);
  });
  return box;
}

// «Рост за день»: Интеллект сверху (число растёт, полоска — до ближайшего нового уровня), ниже — каждая выросшая сила
function growthCard(p, U) {
  const card = el("div", "mail-card mail-growth-card");
  const head = el("div", "mail-card-head");
  head.append(el("span", "mail-card-title", U.growth ?? ""));
  card.append(head);
  const I = p.intel;
  // compact (сводка дня): Интеллект — только если вырос; силы — одной строкой, подпись — только у нового уровня
  if (p.compact) card.classList.add("compact");
  if (I && !(p.compact && I.to <= I.from)) {
    const intel = el("div", "mail-intel");
    const top = el("div", "mail-intel-top");
    const num = el("b", "mail-intel-num", String(I.from));
    const plus = I.to - I.from;
    top.append(el("span", "mail-intel-name", U.intel ?? ""), num);
    if (plus > 0) top.append(el("span", "mail-intel-plus", sign(plus)));
    intel.append(top);
    if (I.near && !p.compact) {
      const tr = track({ from: I.near.progress, to: I.near.progress, need: I.near.need }, "intel");
      intel.append(tr.node, el("span", "mail-bar-left", fill(U.intelNear, { power: I.near.name, left: I.near.left })));
    }
    card.append(intel);
    later(() => countUp(num, I.from, I.to), 600);
  }
  const grid = el("div", "mail-grow-grid");
  card.append(grid);
  p.rows.forEach((r, i) => {
    const row = el("div", `mail-grow a-${r.attr}${r.up ? " up" : ""}`);
    const top = el("div", "mail-grow-top");
    const txt = el("span", "mail-grow-name", r.name);
    top.append(txt, el("span", "mail-grow-gain", sign(r.gain)), el("b", "mail-lvl-n", String(r.lvl)));
    const tr = track(r, "power");
    row.append(top, tr.node);
    if (r.up || !p.compact) row.append(el("span", "mail-grow-foot", r.up ? `${U.newLevel} ${r.say}` : fill(U.left, { n: r.lvl + 1, left: Math.max(0, r.need - r.to) })));
    grid.append(row);
    later(tr.run, 350 + i * 180);
  });
  return card;
}

// Опыт за день — одной строкой цветом Кошелька, не таблицей: опыт — деньги, Воля и силы — рост
function expLine(p, U) {
  const row = el("div", "mail-exp");
  const part = (label, value, cls) => {
    const x = el("span", "mail-exp-part");
    x.append(el("span", "", label), el("b", cls, value));
    return x;
  };
  row.append(el("span", "mail-exp-ic", "◈"), part(U.expEarned, sign(p.earned), "up"));
  if (p.spent) row.append(part(U.expSpent, `−${p.spent}`, "down"));
  row.append(part(U.expHand, String(p.hand), "hand"));
  const go = el("button", "mail-exp-go mail-wallet-go", U.expGo ?? "");
  go.type = "button";
  go.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:open-wallet")));
  row.append(go);
  return row;
}

// «Мир открыл новое» — отдельное важное письмо, цветом силы
function openCard(p, U) {
  const card = el("div", `mail-card mail-open-card a-${p.attr}`);
  const head = el("div", "mail-card-head");
  head.append(el("span", "mail-card-title", U.openCard ?? ""), el("span", "mail-open-power", p.power ?? ""));
  card.append(head, el("b", "mail-open-name", p.name ?? ""), el("p", "mail-card-note", p.text ?? ""));
  return card;
}
