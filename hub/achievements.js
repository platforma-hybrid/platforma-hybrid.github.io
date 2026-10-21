// Достижения (04.10.2026). Библиотека — hub/achievements.json.
// Награды «по факту»: атрибут поднят на +5/+10/+25/+50 уровней; опыта заработано всего 100/250/500/…
// Данные — из ежедневных заданий (событие hub:dailies: earned, flasks, start).

const KEY = "gibrid.achievements.v1";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
}
function load() {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "null") ?? { got: {} };
  } catch {
    return { got: {} };
  }
}
function save(state) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // хранилище недоступно
  }
}

export function initAchievements(ctx, getDailies) {
  const lib = ctx.achievements;
  const t = ctx.texts.achievements;
  const state = load();
  state.got ??= {};
  let openNode = null;

  // всплывающая табличка «Достижение получено» поверх сцены
  const pop = el("div", "wood ach-pop");
  pop.hidden = true;
  ctx.stage.append(pop);
  let popTimer = 0;
  const queue = [];
  function showNext() {
    if (!pop.hidden || !queue.length) return;
    pop.replaceChildren(el("span", "ach-pop-label", t.unlocked), el("b", "gold-text", queue.shift()));
    pop.hidden = false;
    popTimer = window.setTimeout(() => {
      pop.hidden = true;
      showNext();
    }, 3200);
  }
  pop.addEventListener("click", () => {
    window.clearTimeout(popTimer);
    pop.hidden = true;
    showNext();
  });

  function values(d) {
    const gained = {};
    for (const a of lib.attrs) {
      if (a.dev || !d?.flasks?.[a.key]) {
        gained[a.key] = 0;
        continue;
      }
      gained[a.key] = Math.max(0, d.flasks[a.key].level - (d.start?.[a.key]?.level ?? 0));
    }
    return { exp: d?.earned ?? 0, gained };
  }

  // список всех достижений: id, название, текущее значение, порог
  function list(v) {
    const items = lib.exp.tiers.map((n) => ({ id: `exp-${n}`, group: "exp", name: fmt(t.expName, { n }), cur: v.exp, target: n }));
    for (const a of lib.attrs)
      for (const n of lib.attrTiers)
        items.push({ id: `${a.key}-${n}`, group: a.key, name: fmt(t.attrName, { attr: a.name, n }), cur: v.gained[a.key], target: n, dev: !!a.dev });
    return items;
  }

  function refresh(silent = false) {
    const items = list(values(getDailies()));
    let fresh = false;
    for (const it of items) {
      if (it.dev || it.cur < it.target || state.got[it.id]) continue;
      state.got[it.id] = new Date().toISOString().slice(0, 10);
      fresh = true;
      if (!silent) queue.push(it.name);
    }
    if (fresh) save(state);
    showNext();
    const total = items.filter((x) => !x.dev).length;
    const got = items.filter((x) => state.got[x.id]).length;
    document.dispatchEvent(new CustomEvent("hub:achievements", { detail: { got, total } }));
    if (openNode?.isConnected) render(openNode, items);
  }

  function row(title, tiers, cur, dev, ids, unit) {
    const r = el("div", `ach-row${dev ? " dev" : ""}`);
    r.append(el("span", "ach-name", title));
    const medals = el("div", "ach-medals");
    tiers.forEach((n, i) => {
      const got = !!state.got[ids[i]];
      const m = el("span", `ach-medal${got ? " got" : ""}`, unit === "exp" ? (n >= 1000 ? `${String(n / 1000).replace(".", ",")}к` : String(n)) : `+${n}`);
      m.title = got ? `${t.gotOn} ${state.got[ids[i]]}` : "";
      medals.append(m);
    });
    r.append(medals);
    const next = tiers.find((n, i) => !state.got[ids[i]]);
    r.append(el("span", "ach-next", dev ? t.dev : next === undefined ? t.allDone : `${Math.min(cur, next)} / ${next}`));
    return r;
  }

  function render(node, items = list(values(getDailies()))) {
    node.replaceChildren();
    const got = items.filter((x) => state.got[x.id]).length;
    const total = items.filter((x) => !x.dev).length;
    node.append(el("div", "ach-count", fmt(t.count, { got, total })));

    node.append(el("h3", "ach-group", lib.exp.title));
    const v = values(getDailies());
    node.append(row(t.expRow, lib.exp.tiers, v.exp, false, lib.exp.tiers.map((n) => `exp-${n}`), "exp"));

    node.append(el("h3", "ach-group", t.attrsTitle));
    for (const a of lib.attrs) node.append(row(a.name, lib.attrTiers, v.gained[a.key], a.dev, lib.attrTiers.map((n) => `${a.key}-${n}`), "attr"));

    // высшие атрибуты: у каждого свой путь (не «+5»)
    if (lib.higher?.length) {
      node.append(el("h3", "ach-group", t.higherTitle));
      for (const h of lib.higher) {
        const r = el("div", "ach-row ach-higher dev");
        r.append(el("span", "ach-name", h.name), el("span", "ach-source", h.source), el("span", "ach-next", t.dev));
        node.append(r);
      }
    }
    node.append(el("p", "qb-hint", t.hint));
  }

  document.addEventListener("hub:dailies", () => refresh());
  refresh(true); // при загрузке — без всплывашек за старое

  return {
    open() {
      openNode = el("div", "ach-board");
      render(openNode);
      ctx.modal.showNode(t.title, openNode, "modal-wide modal-ach");
    },
  };
}
