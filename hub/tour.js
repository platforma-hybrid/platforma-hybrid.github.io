// Мини-обучение: при первом входе — несколько подсказок по экрану, по одной, с подсветкой места.
// Тексты — hub.texts.json → tour. Показ: первый вход (метка в браузере), ?tour=1 — показать снова; кнопка «?» в углу — тоже.

import { isPhone } from "./phone.js";

const DONE_KEY = "hub.tour.v1";

// Где подсвечивать: селектор (или несколько — берётся общая рамка). Пусто — подсказка по центру, без подсветки.
const TARGETS = {
  welcome: [],
  kolo: [".kolo-rim"],
  dailies: ['[data-id="dailies"]'],
  today: [".kolo-today"],
  wallet: [".wallet-plank"],
  mail: [".mail-button"],
  menu: [".kolo-menu-item"],
  book: ['[data-id="book"]', '[data-id="figure"]'],
  planet: ['[data-id="planet"]'],
};

const PHONE_TARGETS = {
  kolo: [".ph-kolo-svg"],
  dailies: [".ph-dailies"],
  today: [".ph-today"],
  wallet: [".ph-wallet"],
  mail: [".ph-right .ph-icon"],
  menu: [".ph-menu-item"],
  book: ['[data-id="book"]'],
};

function rectOf(selectors) {
  let box = null;
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      box = box === null ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : { l: Math.min(box.l, r.left), t: Math.min(box.t, r.top), r: Math.max(box.r, r.right), b: Math.max(box.b, r.bottom) };
    }
  }
  return box;
}

function seen() {
  try { return window.localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
}
function remember() {
  try { window.localStorage.setItem(DONE_KEY, "1"); } catch { /* приватный режим — просто покажем ещё раз */ }
}

export function initTour(ctx) {
  const t = ctx.texts.tour;
  if (!t || !Array.isArray(t.steps) || t.steps.length === 0) return;

  const help = document.createElement("button");
  help.type = "button";
  help.className = "tour-help";
  help.textContent = "?";
  help.setAttribute("aria-label", t.again);
  help.title = t.again;
  document.body.append(help);

  let layer = null;
  let index = 0;
  let resizeFrame = 0;

  function onResize() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(place);
  }

  const close = () => {
    remember();
    layer?.remove();
    layer = null;
    cancelAnimationFrame(resizeFrame);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey);
  };

  function onKey(event) {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight" || event.key === "Enter") next();
    else if (event.key === "ArrowLeft") back();
  }

  function next() { if (index < t.steps.length - 1) { index += 1; show(); } else close(); }
  function back() { if (index > 0) { index -= 1; show(); } }

  function place() {
    if (layer === null) return;
    const step = t.steps[index];
    const hole = layer.querySelector(".tour-hole");
    const card = layer.querySelector(".tour-card");
    const phone = isPhone();
    const selectors = (phone ? PHONE_TARGETS[step.target] : undefined) ?? TARGETS[step.target] ?? [];
    const target = rectOf(selectors);
    const { innerWidth: width, innerHeight: height } = window;
    const { width: cardWidth, height: cardHeight } = card.getBoundingClientRect();
    const margin = phone ? 12 : 16;
    const clamp = (offset, space) => Math.max(margin, Math.min(offset, space - margin));
    let position;
    if (target) {
      const pad = 10, gap = phone ? 10 : 12;
      const left = Math.max(0, target.l - pad), right = Math.min(width, target.r + pad);
      const top = Math.max(0, target.t - pad), bottom = Math.min(height, target.b + pad);
      const centerX = (left + right - cardWidth) / 2, centerY = (top + bottom - cardHeight) / 2;
      const alignX = phone ? left : centerX;
      const sides = [[right + gap, centerY], [left - gap - cardWidth, centerY]];
      const below = [alignX, bottom + gap], above = [alignX, top - gap - cardHeight];
      const choices = phone && step.target === "dailies" ? [below, ...sides, above] : [...sides, below, above];
      position = choices
        .map(([x, y]) => [clamp(x, width - cardWidth), clamp(y, height - cardHeight)])
        .find(([x, y]) => x >= right || x + cardWidth <= left || y >= bottom || y + cardHeight <= top);
      if (position) {
        Object.assign(hole.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      }
    }
    // Когда свободной стороны нет, показываем текст по центру без рамки под карточкой.
    hole.classList.toggle("none", !position);
    const [x, y] = position ?? [(width - cardWidth) / 2, (height - cardHeight) / 2];
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  function show() {
    const step = t.steps[index];
    const last = index === t.steps.length - 1;
    const card = layer.querySelector(".tour-card");
    card.innerHTML = "";
    const dots = document.createElement("div");
    dots.className = "tour-dots";
    dots.textContent = t.steps.map((_, i) => (i === index ? "●" : "○")).join(" ");
    const title = document.createElement("h3");
    title.textContent = step.title;
    const body = document.createElement("p");
    body.textContent = step.text;
    const row = document.createElement("div");
    row.className = "tour-row";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "tour-skip";
    skip.textContent = last ? "" : t.skip;
    skip.hidden = last;
    skip.onclick = close;
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "tour-prev";
    prev.textContent = "←";
    prev.hidden = index === 0;
    prev.onclick = back;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "tour-next";
    go.textContent = last ? t.finish : t.next;
    go.onclick = next;
    row.append(skip, prev, go);
    card.append(dots, title, body, row);
    card.classList.remove("in");
    void card.offsetWidth;
    card.classList.add("in");
    place();
    go.focus({ preventScroll: true });
  }

  function open() {
    if (layer !== null) return;
    index = 0;
    layer = document.createElement("div");
    layer.className = "tour";
    layer.setAttribute("role", "dialog");
    layer.setAttribute("aria-modal", "true");
    const hole = document.createElement("div");
    hole.className = "tour-hole none";
    const card = document.createElement("div");
    card.className = "tour-card";
    layer.append(hole, card);
    // Клик мимо карточки ничего не делает: подсказку закрывают «Пропустить» или последняя кнопка.
    layer.addEventListener("click", (event) => event.stopPropagation());
    document.body.append(layer);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    show();
    document.fonts.ready.then(place);
  }

  help.addEventListener("click", open);
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") === "1" || !seen()) setTimeout(open, 900); // сцена успевает проявиться
}
