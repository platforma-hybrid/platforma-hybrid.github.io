// Анкета входа (автор, 28.10; claude/SPEC_HEALTH.md §2): при первом открытии «Заданий», до 7 экранов, всё кнопками, всё можно пропустить.
// 29.10 (автор): после возраста — «Как самочувствие?»: «Всё хорошо» сразу ведёт к пробе сил, вопросы о болезнях видит только тот, кому есть что учесть.
// Профиль хранится только в этом браузере (gibrid.health.v1). Ответы о здоровье — только с согласием «Тайна здоровья».
// Итог отдаётся событием hub:anketa-done — его применяют ежедневные задания (стартовые ступени, «Бережно», 60+, письмо Тренера).

const KEY = "gibrid.health.v1";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function loadHealth() {
  try {
    const p = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}
function saveHealth(p) {
  try {
    if (p) window.localStorage.setItem(KEY, JSON.stringify(p));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* хранилище закрыто — анкета спросит снова в следующий раз */
  }
}
export const needAnketa = () => !loadHealth()?.done;

/** Бережно: есть хоть одно «да», беременность или после родов. Чистая функция — для тестов. */
export function isCareful(p) {
  if (!p?.consent) return false;
  return (p.parq ?? []).some(Boolean) || p.now === "preg" || p.now === "post";
}

/** Стартовые ступени по пробе (SPEC_HEALTH §3.1). Без согласия, с «Бережно» или без пробы — ничего не меняем (кроме «Бережно» — самая лёгкая). */
export function startSteps(p) {
  if (!p?.consent && !p?.well) return {};
  if (isCareful(p)) return { pushups: 0, squats: 0 };
  const push = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }[p.probe?.push];
  const squat = { 0: 0, 1: 1, 2: 2, 3: 3 }[p.probe?.squat];
  const out = {};
  if (push !== undefined) out.pushups = push;
  if (squat !== undefined) out.squats = squat;
  return out;
}

export function openAnketa(ctx, { again = false } = {}) {
  const T = ctx.texts.anketa ?? ctx.texts.dailies?.anketa ?? {};
  const p = again ? { ...(loadHealth() ?? {}) } : {};
  p.parq ??= Array(7).fill(false);
  p.flags ??= [];
  p.probe ??= {};
  const root = el("div", "anketa");
  // шаги: 0 кто ты · 1 самочувствие · 2 тайна · 3 семь вопросов · 4 сейчас (жен.) · 5 проба · 6 итог
  const LAST = 6;
  let step = 0;
  const shows = (i) => {
    if (p.well && (i === 2 || i === 3 || i === 4)) return false; // «Всё хорошо» — без вопросов о болезнях
    if (i === 5 && p.well) return true;
    if (i === 3 || i === 4 || i === 5) if (!p.consent) return false;
    if (i === 4 && p.sex !== "f") return false;
    if (i === 5 && isCareful(p)) return false;
    return true;
  };
  const go = (dir) => {
    let i = step + dir;
    while (i > 0 && i < LAST && !shows(i)) i += dir;
    step = Math.max(0, Math.min(LAST, i));
    draw();
  };
  const chips = (list, value, onPick) => {
    const box = el("div", "anketa-chips");
    for (const [id, label] of list) {
      const b = el("button", `anketa-chip${value === id ? " on" : ""}`, label);
      b.type = "button";
      b.setAttribute("aria-pressed", value === id ? "true" : "false");
      b.addEventListener("click", () => {
        onPick(value === id ? undefined : id);
        draw();
      });
      box.append(b);
    }
    return box;
  };
  const foot = (left, right) => {
    const f = el("div", "anketa-foot");
    f.append(left ?? el("span", ""), right);
    return f;
  };
  const btn = (text, cls, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const skip = () => btn(T.skip ?? "", "anketa-skip", () => go(1));
  const next = () => btn(T.next ?? "", "anketa-go", () => go(1));

  function finish() {
    p.done = true;
    p.at = new Date().toISOString();
    p.careful = isCareful(p);
    if (!p.consent) {
      p.parq = Array(7).fill(false);
      p.flags = [];
      p.now = undefined;
      if (!p.well) p.probe = {}; // проба сил — не тайна здоровья: у «Всё хорошо» она остаётся
    }
    saveHealth(p);
    document.dispatchEvent(new CustomEvent("hub:anketa-done", { detail: { profile: p, again } }));
    document.querySelector(".modal-close")?.click();
  }

  function draw() {
    root.replaceChildren();
    const dots = el("div", "anketa-dots");
    for (let i = 0; i <= LAST; i++) if (shows(i) || i === 0 || i === 1 || i === LAST) dots.append(el("i", i <= step ? "on" : ""));
    root.append(dots);
    const S = T.screens?.[step] ?? {};
    root.append(el("h2", "anketa-title", S.title ?? ""));
    if (S.text) root.append(el("p", "anketa-text", S.text));
    if (step === 0) {
      root.append(el("span", "anketa-lab", T.age ?? ""), chips(T.ages ?? [], p.age, (v) => (p.age = v)));
      root.append(el("span", "anketa-lab", T.sexLabel ?? ""), chips(T.sexes ?? [], p.sex, (v) => (p.sex = v)));
      root.append(foot(skip(), next()));
    } else if (step === 1) {
      const pick = el("div", "anketa-well");
      pick.append(
        btn(T.wellYes ?? "", `anketa-well-btn yes${p.well === true ? " on" : ""}`, () => {
          p.well = true;
          p.consent = false;
          go(1);
        }),
        btn(T.wellNo ?? "", `anketa-well-btn${p.well === false ? " on" : ""}`, () => {
          p.well = false;
          go(1);
        }),
      );
      root.append(pick, el("p", "anketa-honest", T.wellNote ?? ""));
    } else if (step === 2) {
      const box = el("div", "anketa-secret");
      for (const [k, v] of T.secret ?? []) {
        const row = el("div", "");
        row.append(el("b", "", `${k}: `), document.createTextNode(v));
        box.append(row);
      }
      root.append(box, el("p", "anketa-honest", T.honest ?? ""));
      root.append(
        foot(
          btn(T.noConsent ?? "", "anketa-alt", () => {
            p.consent = false;
            go(1);
          }),
          btn(T.consent ?? "", "anketa-go", () => {
            p.consent = true;
            p.consentAt = new Date().toISOString();
            p.consentV = T.consentV ?? 1;
            go(1);
          }),
        ),
      );
    } else if (step === 3) {
      (T.parq ?? []).forEach((q, i) => {
        const row = el("div", "anketa-q");
        row.append(el("span", "", q), chips([[true, T.yes], [false, T.no]], p.parq[i], (v) => (p.parq[i] = Boolean(v))));
        root.append(row);
      });
      if (p.parq.some(Boolean)) {
        root.append(el("span", "anketa-lab", T.what ?? ""));
        const box = el("div", "anketa-chips");
        for (const [id, label] of T.flags ?? []) {
          const on = p.flags.includes(id);
          const b = btn(label, `anketa-chip${on ? " on" : ""}`, () => {
            p.flags = on ? p.flags.filter((f) => f !== id) : [...p.flags, id];
            draw();
          });
          box.append(b);
        }
        root.append(box);
      }
      root.append(foot(skip(), next()));
    } else if (step === 4) {
      root.append(chips(T.nows ?? [], p.now, (v) => (p.now = v)), el("p", "anketa-honest", T.nowNote ?? ""));
      root.append(foot(skip(), next()));
    } else if (step === 5) {
      root.append(el("span", "anketa-lab", T.pushLabel ?? ""), chips(T.push ?? [], p.probe.push, (v) => (p.probe.push = v)));
      root.append(el("span", "anketa-lab", T.squatLabel ?? ""), chips(T.squat ?? [], p.probe.squat, (v) => (p.probe.squat = v)));
      root.append(foot(skip(), next()));
    } else {
      if (isCareful(p)) root.append(el("p", "anketa-mode", T.careful ?? ""));
      root.append(foot(null, btn(T.done ?? "", "anketa-go", finish)));
    }
    if (step > 0 && step < LAST) {
      const back = btn(T.back ?? "", "anketa-back", () => go(-1));
      root.prepend(back);
    }
    root.querySelector(".anketa-go")?.focus?.();
  }
  draw();
  ctx.modal.showNode(T.title ?? "", root, "modal-anketa");
}

/** «Моё здоровье»: пройти заново или стереть. */
export function openHealth(ctx) {
  const T = ctx.texts.anketa ?? ctx.texts.dailies?.anketa ?? {};
  const p = loadHealth();
  const root = el("div", "anketa");
  root.append(el("h2", "anketa-title", T.mineTitle ?? ""));
  root.append(el("p", "anketa-text", p?.consent ? T.mineHas ?? "" : T.mineNone ?? ""));
  const again = el("button", "anketa-go", T.again ?? "");
  again.type = "button";
  again.addEventListener("click", () => openAnketa(ctx, { again: true }));
  const wipe = el("button", "anketa-alt", T.wipe ?? "");
  wipe.type = "button";
  wipe.addEventListener("click", () => {
    const keep = loadHealth();
    saveHealth(keep ? { done: true, consent: false, at: keep.at } : null);
    document.dispatchEvent(new CustomEvent("hub:anketa-done", { detail: { profile: loadHealth(), again: true, wiped: true } }));
    wipe.textContent = T.wiped ?? "";
    wipe.disabled = true;
  });
  const f = el("div", "anketa-foot");
  f.append(wipe, again);
  root.append(f);
  ctx.modal.showNode(T.title ?? "", root, "modal-anketa");
}
