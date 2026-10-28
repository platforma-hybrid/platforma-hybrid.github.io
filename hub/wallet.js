// Кошелёк (автор, 26–27.10; claude/SPEC_WALLET.md): в углу хаба — «◈ В руке · ⧗ В закромах», нажатие → окно «Кошелёк».
// Первая версия: Казна целиком (история по дням, сводка недели, «Ты внёс в Фонд», на что тратить);
// Закрома, Открытая цель, Обмен, Знаки, Мир сегодня — вкладки «скоро» (нужны сервер и люди).
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
      pane.replaceChildren(id === "kazna" ? kazna(d) : soon(id));
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

  function kazna(d) {
    const box2 = el("div", "wallet-kazna");
    const hist = el("div", "wallet-hist");
    const side = el("div", "wallet-side");
    const reward = d?.reward ?? 5;
    // сегодня — по живым данным, дальше — история (новые к старым), 30 дней
    const today = { day: d?.day, gains: d?.dayGains ?? {}, bought: d?.bought ?? [] };
    const days = [today, ...[...(d?.history ?? [])].reverse()].slice(0, 30);
    const todayN = d?.day ? dayNum(d.day) : 0;
    let weekIn = 0;
    let weekOut = 0;
    for (const rec of days) {
      const rows = dayRows(rec, T.rows ?? {}, reward);
      const n = rec.day ? todayN - dayNum(rec.day) : 0;
      if (n < 7) for (const r of rows) r.amount > 0 ? (weekIn += r.amount) : (weekOut -= r.amount);
      if (!rows.length && rec !== today) continue;
      const block = el("div", "wallet-day");
      const total = rows.reduce((s, r) => s + r.amount, 0);
      const head = el("div", "wallet-day-head");
      head.append(el("span", "", n === 0 ? T.today : n === 1 ? T.yesterday : fill(T.daysAgo, { n })), el("span", "wallet-day-total", `${T.total} ${sign(total)}`));
      block.append(head);
      if (!rows.length) block.append(el("p", "wallet-empty", T.emptyToday));
      for (const r of rows) {
        const row = el("div", "wallet-row");
        row.append(el("b", r.amount > 0 ? "up" : "down", sign(r.amount)), el("span", "", r.label));
        block.append(row);
      }
      hist.append(block);
    }
    const week = el("div", "wallet-card");
    week.append(el("span", "wallet-card-title", T.week));
    const line = (label, value, cls) => {
      const r = el("div", "wallet-line");
      r.append(el("span", "", label), el("b", cls, value));
      return r;
    };
    week.append(line(T.weekIn, sign(weekIn), "up"), line(T.weekOut, weekOut ? `−${weekOut}` : "0", "down"), line(T.fund, "0", "store"));
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
