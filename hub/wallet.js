// Кошелёк (автор, 26–27.10; claude/SPEC_WALLET.md): в углу хаба — «◈ В руке · ⧗ В закромах», нажатие → окно «Кошелёк».
// Первая версия: Казна целиком (история по дням, сводка недели, «Ты внёс в Фонд», на что тратить);
// Закрома, Открытая цель, Обмен и Знаки ждут сервера. Опыт мира пока показывает выбор периода.
// Данные — из ежедневных заданий (событие hub:dailies); «Путь» живёт в карточке персонажа.

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const fill = (tpl, v) => String(tpl ?? "").replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
const dayNum = (key) => {
  const [y, m, d] = String(key).split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
};
const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function dayNet(day) {
  const earned = Object.values(day.dayGains ?? {}).reduce((sum, gain) => sum + gain, 0);
  return earned - (day.bought ?? []).reduce((sum, item) => sum + item.price, 0);
}

// Положительный остаток ждёт сдачи дня. Траты сверх заработанного покрывает текущий кошелёк.
export function settleDayWallet(state, day, close = false) {
  const paid = day.walletPaid ?? 0;
  const delta = dayNet(day) - paid;
  if (!close && delta >= 0) return;
  const applied = Math.max(-state.wallet, delta);
  state.wallet += applied;
  day.walletPaid = paid + applied;
}

/**
 * Строки одного дня — по источникам, без разжёвывания (автор, 27.10: «просто за ежедневки… а то утонем»):
 * «Ежедневные задания +13», «Слабости −15»; позже — «Квесты», «Продажи» (rec.income = { quests: 20, sales: 40 }).
 */
export function dayRows(rec, L = {}, reward = 5) {
  const rows = [];
  const tasks = rec.gains ? Object.values(rec.gains).reduce((a, b) => a + b, 0) : rec.earned ?? (rec.done ?? 0) * reward;
  if (tasks) rows.push({ amount: tasks, label: L.dailies ?? "" });
  for (const [src, amount] of Object.entries(rec.income ?? {})) if (amount) rows.push({ amount, label: L.income?.[src] ?? src });
  const spent = rec.bought ? rec.bought.reduce((a, b) => a + b.price, 0) : rec.spent ?? 0;
  if (spent) rows.push({ amount: -spent, label: L.weak ?? "" });
  return rows;
}

export function initWallet(box, ctx, getDailies) {
  const T = ctx.texts.wallet ?? {};

  const button = el("button", "wood plank wallet-plank");
  button.type = "button";
  button.setAttribute("aria-label", T.title ?? "");
  const hand = el("b", "wallet-num", "0");
  const store = el("b", "wallet-num store", "0");
  const flash = el("span", "wallet-flash");
  flash.setAttribute("aria-hidden", "true");
  const handBox = el("span", "wallet-part");
  handBox.append(el("span", "wallet-label", T.inHand ?? ""), hand);
  const storeBox = el("span", "wallet-part");
  storeBox.append(el("span", "wallet-label store", T.inStore ?? ""), store);
  button.append(handBox, el("span", "wallet-sep"), storeBox, flash);
  box.append(button);

  let last = null;
  let flashTimer = 0;
  const update = (d) => {
    if (!d) return;
    const now = d.wallet ?? 0;
    if (last !== null && now !== last) {
      const diff = now - last;
      flash.textContent = sign(diff);
      flash.className = `wallet-flash on ${diff > 0 ? "up" : "down"}`;
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => (flash.className = "wallet-flash"), 1400);
    }
    last = now;
    hand.textContent = String(now);
    store.textContent = String(d.stored ?? 0);
  };
  document.addEventListener("hub:dailies", (event) => update(event.detail));
  update(getDailies());

  const openWallet = () => ctx.modal.showNode(T.title ?? "", windowNode(getDailies()), "modal-wide modal-wallet");
  button.addEventListener("click", openWallet);
  // из письма «Сводка дня» → «Кошелёк»
  document.addEventListener("hub:open-wallet", openWallet);

  function windowNode(d) {
    const root = el("div", "wallet-window");
    const nums = el("div", "wallet-nums");
    const big = (label, value, cls) => {
      const b = el("div", `wallet-big ${cls}`);
      b.append(el("span", "wallet-big-label", label), el("b", "", String(value)));
      // под Закромами — без пояснений (автор, 27.10): что такое «отложено» — во вкладке «Закрома»
      const hint = cls === "store" ? T.storeHint : T.handHint;
      if (hint) b.append(el("span", "wallet-big-hint", hint));
      return b;
    };
    nums.append(big(T.inHand, d?.wallet ?? 0, "hand"), big(T.inStore, d?.stored ?? 0, "store"));
    const tabs = el("div", "wallet-tabs");
    tabs.setAttribute("role", "tablist");
    const pane = el("div", "wallet-pane");
    const list = [
      ["kazna", T.tabs?.kazna],
      ["zakroma", T.tabs?.zakroma],
      ["cel", T.tabs?.cel],
      ["obmen", T.tabs?.obmen],
      ["znaki", T.tabs?.znaki],
      ["mir", T.tabs?.mir],
    ];
    const buttons = [];
    const open = (id) => {
      for (const b of buttons) {
        const on = b.dataset.tab === id;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (id === "kazna") pane.replaceChildren(kazna(d));
      else if (id === "mir" && T.worldExperience) pane.replaceChildren(worldExperience());
      else pane.replaceChildren(soon(id));
    };
    for (const [id, label] of list) {
      const b = el("button", "wallet-tab", label ?? id);
      b.type = "button";
      b.dataset.tab = id;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => open(id));
      buttons.push(b);
      tabs.append(b);
    }
    root.append(nums, tabs, pane);
    open("kazna");
    return root;
  }

  function worldExperience() {
    const text = T.worldExperience;
    const box = el("section", "wallet-soon wallet-side");
    const periods = el("div", "wallet-tabs");
    periods.setAttribute("role", "group");
    periods.setAttribute("aria-label", text.periodLabel);
    const total = el("div", "wallet-big hand");
    total.setAttribute("aria-live", "polite");
    const label = el("span", "wallet-big-label");
    total.append(label, el("b", "", "—"), el("span", "wallet-big-hint", text.pending));
    const buttons = Object.entries(text.periods).map(([id, period]) => {
      const button = el("button", "wallet-tab", period.label);
      button.type = "button";
      button.addEventListener("click", () => select(id));
      periods.append(button);
      return { id, button };
    });
    function select(id) {
      for (const item of buttons) {
        const active = item.id === id;
        item.button.classList.toggle("on", active);
        item.button.setAttribute("aria-pressed", String(active));
      }
      label.textContent = text.periods[id].total;
    }
    select("day");
    box.append(periods, total);
    return box;
  }

  function kazna(d) {
    const box2 = el("div", "wallet-kazna");
    const hist = el("div", "wallet-hist");
    const side = el("div", "wallet-side");
    const reward = d?.reward ?? 5;
    // сегодня — по живым данным, дальше — история (новые к старым), 30 дней
    const today = { day: d?.day, gains: d?.dayGains ?? {}, bought: d?.bought ?? [] };
    const todayN = d?.day ? dayNum(d.day) : 0;
    const bonusDays = new Map(Object.entries(d?.periodBonuses ?? {}).map(([key, bonuses]) => [dayNum(key), { day: key, bonuses }]));
    const previous = new Map((d?.history ?? []).map((day) => [dayNum(day.day), day]));
    for (const [number, { day }] of bonusDays) {
      if (number !== todayN && !previous.has(number)) previous.set(number, { day });
    }
    previous.delete(todayN);
    const days = [today, ...[...previous.entries()].sort(([a], [b]) => b - a).map(([, day]) => day)].slice(0, 30);
    let weekIn = 0;
    let weekOut = 0;
    let weekBonus = 0;
    for (const rec of days) {
      const daily = dayRows(rec, T.rows ?? {}, reward);
      const number = rec.day ? dayNum(rec.day) : todayN;
      const n = todayN - number;
      const bonuses = bonusDays.get(number)?.bonuses;
      const bonusRows = Object.entries(bonuses ?? {}).filter(([, amount]) => amount)
        .map(([kind, amount]) => ({ amount, label: T.rows?.bonuses?.[kind] ?? "" }));
      if (n >= 0 && n < 7) {
        for (const r of daily) r.amount > 0 ? (weekIn += r.amount) : (weekOut -= r.amount);
        weekBonus += bonusRows.reduce((sum, r) => sum + r.amount, 0);
      }
      const rows = [...daily, ...bonusRows];
      if (!rows.length && rec !== today) continue;
      const block = el("div", "wallet-day");
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const head = el("div", "wallet-day-head");
      const awaitingCredit = rec === today && d?.closed === false && daily.length > 0 && Number.isFinite(d.walletCredit) && Boolean(T.dayCredit);
      const balanceLabel = awaitingCredit ? fill(T.dayCredit, { n: d.walletCredit }) : `${T.total} ${sign(total)}`;
      const balanceClass = awaitingCredit ? "wallet-day-total wallet-day-credit" : "wallet-day-total";
      head.append(el("span", "", n === 0 ? T.today : n === 1 ? T.yesterday : fill(T.daysAgo, { n })), el("span", balanceClass, balanceLabel));
      block.append(head);
      if (!rows.length) block.append(el("p", "wallet-empty", T.emptyToday));
      for (const r of rows) {
        const row = el("div", "wallet-row");
        row.append(el("b", r.amount > 0 ? "up" : "down", sign(r.amount)), el("span", "", r.label));
        block.append(row);
      }
      if (awaitingCredit) block.append(el("p", "wallet-day-credit-hint", T.dayCreditHint));
      hist.append(block);
    }
    const week = el("div", "wallet-card");
    week.append(el("span", "wallet-card-title", T.week));
    const line = (label, value, cls) => {
      const r = el("div", "wallet-line");
      r.append(el("span", "", label), el("b", cls, value));
      return r;
    };
    week.append(line(T.weekIn, sign(weekIn), "up"));
    if (weekBonus) week.append(line(T.weekBonus, sign(weekBonus), weekBonus > 0 ? "up" : "down"));
    week.append(line(T.weekOut, weekOut ? `−${weekOut}` : "0", "down"), line(T.fund, "0", "store"));
    const spend = el("div", "wallet-card");
    spend.append(el("span", "wallet-card-title", T.spendTitle));
    for (const [label, value, on] of T.spendList ?? []) {
      const r = line(label, value, on ? "" : "soon");
      if (!on) r.classList.add("soon");
      spend.append(r);
    }
    side.append(week, spend);
    box2.append(hist, side);
    return box2;
  }

  function soon(id) {
    const s = T.soon?.[id] ?? {};
    const box2 = el("div", "wallet-soon");
    box2.append(el("h3", "", s.title ?? ""), el("p", "", s.text ?? ""), el("span", "wallet-soon-tag", T.soonTag ?? ""));
    return box2;
  }
}
