// Мини-обучение: при первом входе — несколько подсказок по экрану, по одной, с подсветкой места.
// Тексты — hub.texts.json → tour. Показ: первый вход (метка в браузере), ?tour=1 — показать снова; кнопка «?» в углу — тоже.

const DONE_KEY = "hub.tour.v1";

// Где подсвечивать: селектор (или несколько — берётся общая рамка). Пусто — подсказка по центру, без подсветки.
const TARGETS = {
  welcome: [],
  kolo: [".kolo-rim"],
  // .ph-* — панель телефона (phone.js): на телефоне доски сцены скрыты, подсвечиваем её кнопки
  dailies: ['[data-id="dailies"]', ".ph-dailies"],
  today: [".kolo-today", ".ph-today"],
  menu: [".kolo-menu-item", ".ph-menu-item"],
  book: ['[data-id="book"]', '[data-id="figure"]'],
  planet: ['[data-id="planet"]'],
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

  const close = () => {
    remember();
    layer?.remove();
    layer = null;
    window.removeEventListener("resize", place);
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
    const box = rectOf(TARGETS[step.target] ?? []);
    const W = window.innerWidth, H = window.innerHeight, pad = 10;
    if (box === null) {
      hole.classList.add("none");
      card.style.left = `${Math.max(16, (W - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(16, (H - card.offsetHeight) / 2)}px`;
      return;
    }
    hole.classList.remove("none");
    Object.assign(hole.style, { left: `${box.l - pad}px`, top: `${box.t - pad}px`, width: `${box.r - box.l + pad * 2}px`, height: `${box.b - box.t + pad * 2}px` });
    // Карточка — с той стороны, где больше места; не вылезает за экран.
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 22;
    const room = { right: W - box.r, left: box.l, below: H - box.b, above: box.t };
    let x, y;
    if (room.right >= cw + gap * 2) { x = box.r + gap; y = (box.t + box.b) / 2 - ch / 2; }
    else if (room.left >= cw + gap * 2) { x = box.l - gap - cw; y = (box.t + box.b) / 2 - ch / 2; }
    else if (room.below >= ch + gap * 2) { x = (box.l + box.r) / 2 - cw / 2; y = box.b + gap; }
    else { x = (box.l + box.r) / 2 - cw / 2; y = box.t - gap - ch; }
    card.style.left = `${Math.min(Math.max(16, x), W - cw - 16)}px`;
    card.style.top = `${Math.min(Math.max(16, y), H - ch - 16)}px`;
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
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    show();
  }

  help.addEventListener("click", open);
  const params = new URLSearchParams(window.location.search);
  if (params.get("tour") === "1" || !seen()) setTimeout(open, 900); // сцена успевает проявиться
}
