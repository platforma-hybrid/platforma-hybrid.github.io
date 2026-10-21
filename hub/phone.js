// Телефон лёжа (16.10.2026, решение автора: «сначала для телефона, горизонтального»).
// Большая картина хаба на телефоне ужимается в треть — текст 5–6 px. Поэтому на телефоне:
// картина заполняет экран целиком (без полей), а живое — панель поверх неё настоящими пикселями.
// Панель не хранит своих данных: зеркалит кнопки и надписи хаба и нажимает их же — логика одна.
const PHONE_MQ = "(orientation: landscape) and (max-height: 540px)";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function isPhone() {
  return document.documentElement.classList.contains("is-phone");
}

export function initPhone(ctx, { refit }) {
  const mq = window.matchMedia(PHONE_MQ);
  const hud = el("div", "ph-hud");
  hud.hidden = true;
  document.body.append(hud);

  const top = el("div", "ph-top");
  const date = el("button", "ph-chip ph-date");
  const dailies = el("button", "ph-chip ph-dailies");
  const right = el("div", "ph-right");
  const status = el("button", "ph-chip ph-status");
  const mail = el("button", "ph-chip ph-icon", "✉");
  mail.setAttribute("aria-label", "Почта");
  right.append(status, mail);
  top.append(date, dailies, right);
  // слева — коло (копия колеса хаба: месяцы нажимаются так же) и «Сегодня»; справа — меню
  const kolo = el("div", "ph-kolo");
  const today = el("div", "ph-today");
  const left = el("div", "ph-left");
  left.append(kolo, today);
  const menu = el("nav", "ph-menu");
  const loc = el("button", "ph-chip ph-loc");
  hud.append(top, left, menu, loc);
  for (const b of [date, dailies, status, mail, loc]) b.type = "button";

  // нажать ту же кнопку хаба — сработает её обычное действие
  // (у SVG-секторов коло нет .click(), поэтому — настоящее событие нажатия, всплывающее до сцены)
  const press = (action) => ctx.stage.querySelector(`[data-action="${CSS.escape(action)}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  date.addEventListener("click", () => press(date.dataset.action ?? ""));
  dailies.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:dailies-toggle")));
  status.addEventListener("click", () => press("modal:status"));
  mail.addEventListener("click", () => press("modal:mail"));
  loc.addEventListener("click", () => press("modal:location"));

  kolo.addEventListener("click", (event) => {
    const hit = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (hit?.dataset.action) press(hit.dataset.action);
  });
  // колесо: та же картинка, что в хабе, обрезанная до круга; id градиентов переименованы, чтобы не ссылаться на скрытый оригинал
  let koloKey = "";
  function syncKolo() {
    const svg = ctx.stage.querySelector(".kolo-svg");
    if (!svg) return kolo.replaceChildren();
    // перерисовываем, только если колесо в хабе изменилось (иначе кнопки пересоздавались бы на каждое движение анимаций)
    const key = svg.innerHTML;
    if (key === koloKey) return;
    koloKey = key;
    const copy = svg.cloneNode(true);
    copy.removeAttribute("width");
    copy.removeAttribute("height");
    copy.setAttribute("viewBox", "-6 66 532 540");
    copy.setAttribute("class", "ph-kolo-svg");
    copy.innerHTML = copy.innerHTML.replace(/id="k/g, 'id="ph-k').replace(/url\(#k/g, "url(#ph-k").replace(/href="#k/g, 'href="#ph-k');
    kolo.replaceChildren(copy);
  }

  // Ежедневные задания: на телефоне доска выезжает поверх экрана (её узлы и обработчики — те же, только переложены)
  const sheet = el("div", "ph-sheet");
  sheet.hidden = true;
  const sheetClose = el("button", "ph-sheet-close", "×");
  sheetClose.type = "button";
  sheetClose.setAttribute("aria-label", ctx.texts.close ?? "Закрыть");
  sheetClose.addEventListener("click", () => document.dispatchEvent(new CustomEvent("hub:dailies-toggle")));
  sheet.append(sheetClose);
  sheet.addEventListener("click", (event) => {
    if (event.target === sheet) document.dispatchEvent(new CustomEvent("hub:dailies-toggle"));
  });
  document.body.append(sheet);
  function syncSheet(on) {
    const box = ctx.stage.querySelector(".dailies-item");
    const board = document.querySelector(".dailies-board");
    if (!box || !board) return;
    const open = on && box.classList.contains("is-open");
    if (open && board.parentElement !== sheet) sheet.append(board);
    if (!open && board.parentElement === sheet) box.append(board);
    sheet.hidden = !open;
  }

  const text = (sel) => ctx.stage.querySelector(sel)?.textContent.replace(/\s+/g, " ").trim() ?? "";

  function sync() {
    syncSheet(!hud.hidden);
    if (hud.hidden) return;
    const caption = ctx.stage.querySelector(".kolo-caption");
    date.textContent = caption?.textContent.trim() ?? "";
    if (caption?.dataset.action) date.dataset.action = caption.dataset.action;
    dailies.replaceChildren(el("b", "", text(".dailies-strip .gold-text")), el("span", "", text(".dailies-meta")));
    status.textContent = text('[data-action="modal:status"]').replace(/^Статус:\s*/, "");
    loc.textContent = text('[data-action="modal:location"]');

    const origs = [...ctx.stage.querySelectorAll(".kolo-menu-item")];
    const menuKey = origs.map((o) => o.textContent).join("|");
    if (menuKey !== menu.dataset.key) {
      menu.dataset.key = menuKey;
      menu.replaceChildren();
    }
    for (const orig of menu.childElementCount ? [] : origs) {
      const copy = orig.cloneNode(true);
      copy.removeAttribute("style");
      copy.className = "ph-menu-item";
      copy.addEventListener("click", () => orig.click());
      menu.append(copy);
    }
    syncKolo();
    const t = ctx.stage.querySelector(".kolo-today");
    if ((t?.textContent ?? "") !== today.dataset.key) {
      today.dataset.key = t?.textContent ?? "";
      today.replaceChildren(...(t ? [...t.children].map((c) => c.cloneNode(true)) : []));
    }

    // открыто окно или подсказка — панель прячется, чтобы не лежать поверх
    const busy = document.querySelector(".modal-backdrop:not([hidden]), .st-backdrop:not([hidden]), .sk-backdrop:not([hidden]), .dailies-item.is-open");
    hud.classList.toggle("ph-busy", Boolean(busy));
  }

  let queued = false;
  const schedule = (mutations) => {
    if (Array.isArray(mutations) && mutations.every((m) => hud.contains(m.target))) return;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };
  // окна могут жить и в картине, и поверх экрана (body) — следим за обоими
  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"] });

  // окна на общем «модальном» каркасе (задания, достижения, книга, почта…) на телефоне живут поверх экрана, не внутри картины
  function placeModal(on) {
    const backdrop = document.querySelector(".modal-backdrop");
    if (!backdrop) return;
    backdrop.classList.toggle("ph-modal", on);
    (on ? document.body : ctx.stage).append(backdrop);
  }

  // окна с живописным фоном 1536×1024 («Задания»): картина вписывается в экран целиком; на маленьком телефоне текст крупнее
  function fitArt() {
    const z = Math.min(window.innerWidth / 1536, window.innerHeight / 1024);
    document.documentElement.style.setProperty("--ph-art-zoom", String(z));
    document.documentElement.classList.toggle("ph-art-small", z < 0.5);
  }
  window.addEventListener("resize", fitArt);
  fitArt();

  function apply() {
    const on = mq.matches;
    document.documentElement.classList.toggle("is-phone", on);
    hud.hidden = !on;
    placeModal(on);
    refit();
    schedule();
  }
  mq.addEventListener("change", apply);
  apply();
  return { isPhone };
}
