function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(id) {
  const image = element("span", `daily-card-icon daily-card-icon-${id}`);
  image.setAttribute("aria-hidden", "true");
  return image;
}

const RARITIES = ["ordinary", "uncommon", "rare"];
const plural = new Intl.PluralRules("ru");

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
  const invitation = element("p", "daily-card-invitation");
  const take = element("button", "dailies-submit", texts.take);
  take.type = "button";
  front.append(frontEmblem, invitation, take);
  const rows = element("div", "daily-card-rows");
  const reward = element("div", "daily-card-reward");
  const score = element("strong", "daily-card-score");
  reward.append(element("span", "", texts.reward), score);
  const back = element("button", "dailies-lib-btn daily-card-back", texts.back);
  back.type = "button";
  card.append(title, front, rows, reward, back);
  overlay.append(card);

  let active = null;
  let trigger = null;
  const entries = new Map();

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
    title.replaceChildren(document.createTextNode(group.title));
    if (!info.taken && group.id !== "strength") frontEmblem.replaceChildren(icon(group.id));
    else frontEmblem.replaceChildren();
    front.hidden = info.taken;
    rows.hidden = reward.hidden = !info.taken;
    invitation.textContent = texts.invitation[group.id] ?? "";
    if (info.taken) {
      if (rows.firstChild !== entry.rows) rows.replaceChildren(entry.rows);
      score.textContent = `${info.earned} / ${info.maximum}`;
    }
  }

  function open(id, source = null) {
    if (!entries.get(id)?.info?.count) return;
    active = id;
    trigger = source;
    overlay.hidden = false;
    draw();
    title.focus();
  }

  for (const [index, group] of groups.entries()) {
    const face = element("article", "daily-card daily-card-summary");
    face.dataset.power = group.id;
    face.style.setProperty("--face-position", `${index * 20}%`);
    const rarity = RARITIES.includes(previewRarities[index]) ? previewRarities[index] : "ordinary";
    const status = element("span", "daily-card-status");
    const rarityLabel = element("span", "daily-card-rarity");
    const button = element("button", "dailies-lib-btn", texts.open);
    button.type = "button";
    button.setAttribute("aria-label", `${texts.open} · ${group.title}`);
    button.addEventListener("click", () => open(group.id, button));
    face.append(element("h3", "", group.title), rarityLabel, status, button);
    entries.set(group.id, { group, face, button, status, rarityLabel, previewRarity: rarity, rows: null, info: null });
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
  back.addEventListener("click", () => close());
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
    if ((event.shiftKey && (document.activeElement === first || document.activeElement === title))
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
        entry.rarityLabel.textContent = texts[entry.rarity];
        entry.status.textContent = info.count ? `${info.count} ${texts.tasks[plural.select(info.count)]}` : texts.empty;
        entry.button.disabled = !info.count;
        entry.button.setAttribute("aria-label", `${texts.open} · ${entry.group.title}`);
      }
      if (active && !entries.get(active).info.count) close(false);
      else draw();
    },
  };
}
