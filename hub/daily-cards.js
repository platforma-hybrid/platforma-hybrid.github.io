function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const RARITIES = ["ordinary", "uncommon", "rare"];

export function createDailyCards(groups, texts, onTake, previewRarities = []) {
  const grid = element("div", "daily-card-grid");
  const overlay = element("div", "daily-card-overlay");
  overlay.hidden = true;
  const card = element("section", "daily-card daily-card-detail");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "daily-card-title");
  const title = element("h3", "daily-card-title");
  title.id = "daily-card-title";
  title.tabIndex = -1;
  const front = element("div", "daily-card-front");
  const frontEmblem = element("div", "daily-card-front-emblem");
  frontEmblem.setAttribute("aria-hidden", "true");
  frontEmblem.append(element("span", "daily-card-front-glyph"));
  const invitation = element("p", "daily-card-invitation");
  const take = element("button", "daily-card-turn");
  take.type = "button";
  take.append(element("span", "daily-card-turn-label", texts.take));
  front.append(frontEmblem, invitation, take);
  const rows = element("div", "daily-card-rows");
  const reward = element("div", "daily-card-reward");
  const score = element("strong", "daily-card-score");
  reward.append(element("span", "", texts.reward), score);
  card.append(title, front, rows, reward);
  overlay.append(card);

  let active = null;
  let trigger = null;
  const entries = new Map();
  const pointerShine = window.matchMedia("(any-hover: hover) and (prefers-reduced-motion: no-preference)");

  function close(restoreFocus = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    rows.replaceChildren();
    active = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    trigger = null;
  }

  function draw() {
    const entry = entries.get(active);
    if (!entry) return;
    const { group, info } = entry;
    card.dataset.rarity = entry.rarity;
    card.dataset.power = group.id;
    card.dataset.side = info.taken ? "back" : "front";
    card.style.setProperty("--face-position", entry.face.style.getPropertyValue("--face-position"));
    title.replaceChildren(document.createTextNode(group.title));
    front.hidden = info.taken;
    rows.hidden = reward.hidden = !info.taken;
    invitation.textContent = texts.invitation[group.id] ?? "";
    if (info.taken) {
      if (rows.firstChild !== entry.rows) rows.replaceChildren(entry.rows);
      score.textContent = `${info.earned} / ${info.maximum}`;
    }
  }

  function open(id, source = null, focusTurn = false) {
    if (!entries.get(id)?.info?.count) return;
    active = id;
    trigger = source;
    overlay.hidden = false;
    draw();
    (focusTurn && !front.hidden ? take : title).focus();
  }

  for (const [index, group] of groups.entries()) {
    const face = element("article", "daily-card daily-card-summary");
    face.dataset.power = group.id;
    face.style.setProperty("--face-position", `${index * 20}%`);
    const rarity = RARITIES.includes(previewRarities[index]) ? previewRarities[index] : "ordinary";
    const finish = element("span", "daily-card-finish");
    finish.setAttribute("aria-hidden", "true");
    const button = element("button", "dailies-lib-btn", texts.open);
    button.type = "button";
    face.addEventListener("click", (event) => open(group.id, button, event.detail === 0));
    face.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse" || !pointerShine.matches || face.dataset.rarity === "ordinary" || button.disabled) return;
      const bounds = face.getBoundingClientRect();
      face.style.setProperty("--shine-x", `${(event.clientX - bounds.left) / bounds.width * 100}%`);
      face.style.setProperty("--shine-y", `${(event.clientY - bounds.top) / bounds.height * 100}%`);
      face.dataset.shine = "";
    });
    face.addEventListener("pointerleave", () => delete face.dataset.shine);
    face.append(finish, element("h3", "", group.title), button);
    entries.set(group.id, { group, face, button, previewRarity: rarity, rows: null, info: null });
    grid.append(face);
  }

  take.addEventListener("click", () => {
    if (!active || !onTake(active)) return;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      card.animate([
        { transform: "perspective(900px) rotateY(-80deg)" },
        { transform: "perspective(900px) rotateY(0)" },
      ], { duration: 280, easing: "ease-out" });
    }
    title.focus();
  });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== "Tab") return;
    const buttons = [...card.querySelectorAll("button:not(:disabled), input:not(:disabled)")]
      .filter((node) => node.getClientRects().length > 0);
    const first = buttons[0], last = buttons.at(-1);
    if (!first) {
      event.preventDefault();
      title.focus();
    } else if ((event.shiftKey && (document.activeElement === first || document.activeElement === title))
        || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  });

  return {
    grid,
    overlay,
    open,
    close,
    setRows(id, groupRows) {
      entries.get(id).rows = groupRows;
    },
    update(getInfo) {
      for (const [id, entry] of entries) {
        const info = getInfo(id);
        entry.info = info;
        entry.rarity = RARITIES.includes(info.rarity) ? info.rarity : entry.previewRarity;
        entry.face.dataset.rarity = entry.rarity;
        entry.button.disabled = !info.count;
        const action = info.count ? texts.open : texts.empty;
        const label = [action, entry.group.title];
        if (entry.rarity !== "ordinary") label.push(texts[entry.rarity]);
        entry.button.setAttribute("aria-label", label.join(" · "));
      }
      if (active && !entries.get(active).info.count) close(false);
      else draw();
    },
  };
}
