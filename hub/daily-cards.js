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
  const journalOverlay = element("div", "daily-journal-overlay");
  journalOverlay.hidden = true;
  const journal = element("section", "daily-journal");
  journal.setAttribute("role", "dialog");
  journal.setAttribute("aria-modal", "true");
  journal.setAttribute("aria-labelledby", "daily-journal-title");
  const journalHeader = element("header", "daily-journal-header");
  const journalTitle = element("h3", "", texts.journalTitle);
  journalTitle.id = "daily-journal-title";
  journalTitle.tabIndex = -1;
  const journalCount = element("span", "daily-journal-count");
  const journalClose = element("button", "daily-journal-close", "×");
  journalClose.type = "button";
  journalClose.setAttribute("aria-label", texts.journalClose);
  journalHeader.append(journalTitle, journalCount, journalClose);
  const journalBody = element("div", "daily-journal-body");
  const journalTable = element("table", "daily-journal-table");
  journalTable.setAttribute("aria-labelledby", journalTitle.id);
  const columns = element("colgroup", "");
  for (const name of ["power", "name", "actions", "open"]) columns.append(element("col", `daily-journal-col-${name}`));
  const journalRows = element("tbody", "");
  journalTable.append(columns, journalRows);
  const journalEmpty = element("div", "daily-journal-empty");
  const journalBack = element("button", "daily-journal-back", texts.journalBack);
  journalBack.type = "button";
  journalEmpty.append(element("p", "", texts.journalEmpty), journalBack);
  journalBody.append(journalTable, journalEmpty);
  journal.append(journalHeader, journalBody);
  journalOverlay.append(journal);
  document.body.append(journalOverlay);
  let journalTrigger = null;
  let returnToJournal = false;

  const plural = (count, forms) => forms[count % 100 >= 11 && count % 100 <= 14 ? "many"
    : count % 10 === 1 ? "one" : count % 10 >= 2 && count % 10 <= 4 ? "few" : "many"];

  function closeJournal(restoreFocus = true) {
    if (journalOverlay.hidden) return;
    journalOverlay.hidden = true;
    journalTrigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus && journalTrigger?.isConnected) journalTrigger.focus();
  }

  function fitJournal() {
    if (journalOverlay.hidden) return;
    const frame = journalTrigger?.closest(".modal-quests-day")?.getBoundingClientRect();
    const scale = Math.min(Math.max((frame?.width ?? 1044) / 1536, .6), (window.innerWidth - 24) / 1170);
    journalOverlay.style.setProperty("--journal-u", `${scale}px`);
  }

  function drawJournal() {
    if (journalOverlay.hidden) return;
    const focused = journal.contains(document.activeElement) ? document.activeElement?.dataset.journalAction : null;
    const scrollTop = journalBody.scrollTop;
    const taken = [...entries].filter(([, entry]) => entry.info?.taken && entry.info.count && entry.rows);
    const fragment = document.createDocumentFragment();
    let taskCount = 0;
    for (const [id, entry] of taken) {
      const taskRows = [...entry.rows.querySelectorAll(":scope > .dailies-task")];
      for (const [index, source] of taskRows.entries()) {
        taskCount++;
        const row = element("tr", "daily-journal-row");
        row.dataset.power = id;
        const power = element("td", "daily-journal-power");
        const powerLabel = element("span", "daily-journal-power-label");
        const glyph = element("i", "daily-journal-glyph");
        glyph.setAttribute("aria-hidden", "true");
        glyph.style.setProperty("--face-position", entry.face.style.getPropertyValue("--face-position"));
        powerLabel.append(glyph, element("span", "", entry.group.title));
        power.append(powerLabel);
        const sourceName = source.querySelector(".dailies-task-name");
        const name = source.classList.contains("dailies-sets") ? sourceName?.firstElementChild?.textContent : sourceName?.textContent;
        const nameCell = element("td", "daily-journal-name", name ?? "");
        const actions = element("td", "daily-journal-actions");
        const actionBox = element("div", "daily-journal-actions-inner");
        const dots = [...source.querySelectorAll(".dailies-dot")];
        for (const [dotIndex, dot] of dots.entries()) {
          const button = element("button", `daily-journal-approach${dot.classList.contains("on") ? " on" : ""}`, dot.textContent);
          button.type = "button";
          button.disabled = dot.disabled;
          button.dataset.journalAction = `${id}:${index}:set:${dotIndex}`;
          button.setAttribute("aria-label", dot.getAttribute("aria-label") ?? `${name} · ${dot.textContent}`);
          button.addEventListener("click", () => dot.click());
          actionBox.append(button);
        }
        const check = source.querySelector('input[type="checkbox"]');
        if (check) {
          const button = element("button", `daily-journal-mark${check.checked ? " done" : ""}`);
          button.type = "button";
          button.disabled = check.disabled;
          button.dataset.journalAction = `${id}:${index}:check`;
          button.setAttribute("aria-pressed", String(check.checked));
          button.setAttribute("aria-label", `${check.checked ? texts.journalMarked : texts.journalMark} · ${name}`);
          const icon = element("i", "", check.checked ? "✓" : "");
          icon.setAttribute("aria-hidden", "true");
          button.append(icon, element("span", "", check.checked ? texts.journalMarked : texts.journalMark));
          button.addEventListener("click", () => {
            if (check.disabled) return;
            check.checked = !check.checked;
            check.dispatchEvent(new Event("change", { bubbles: true }));
          });
          actionBox.append(button);
        }
        actions.append(actionBox);
        const openCell = element("td", "daily-journal-open-cell");
        const openButton = element("button", "daily-journal-open-card", "›");
        openButton.type = "button";
        openButton.dataset.journalAction = `${id}:${index}:open`;
        openButton.setAttribute("aria-label", `${texts.journalOpenCard} · ${entry.group.title}`);
        openButton.addEventListener("click", () => open(id, journalTrigger, false, true));
        openCell.append(openButton);
        row.append(power, nameCell, actions, openCell);
        fragment.append(row);
      }
    }
    journalRows.replaceChildren(fragment);
    journalCount.textContent = `${taken.length} ${plural(taken.length, texts.journalCards)} · ${taskCount} ${plural(taskCount, texts.tasks)}`;
    journalTable.hidden = !taskCount;
    journalEmpty.hidden = Boolean(taskCount);
    journalBody.scrollTop = scrollTop;
    if (focused) {
      const next = [...journal.querySelectorAll("[data-journal-action]")].find(button => button.dataset.journalAction === focused && !button.disabled);
      (next ?? journalTitle).focus({ preventScroll: true });
    }
  }

  function openJournal(source = journalTrigger) {
    journalTrigger = source;
    returnToJournal = false;
    closeCard(false);
    journalOverlay.hidden = false;
    journalTrigger?.setAttribute("aria-expanded", "true");
    fitJournal();
    drawJournal();
    journalClose.focus();
  }

  function closeCard(restoreFocus = true) {
    if (overlay.hidden) return;
    overlay.hidden = true;
    rows.replaceChildren();
    active = null;
    const reopen = returnToJournal;
    returnToJournal = false;
    if (restoreFocus && reopen) openJournal();
    else if (restoreFocus && trigger?.isConnected) trigger.focus();
    trigger = null;
  }

  function close(restoreFocus = true) {
    returnToJournal = false;
    closeCard(restoreFocus);
    closeJournal(restoreFocus);
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

  function open(id, source = null, focusTurn = false, fromJournal = false) {
    if (!entries.get(id)?.info?.count) return;
    closeJournal(false);
    returnToJournal = fromJournal;
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
    if (event.target === overlay) closeCard();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCard();
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

  journalClose.addEventListener("click", () => closeJournal());
  journalBack.addEventListener("click", () => closeJournal());
  journalOverlay.addEventListener("click", event => {
    if (event.target === journalOverlay) closeJournal();
  });
  document.addEventListener("keydown", event => {
    if (journalOverlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeJournal();
    } else if (event.key === "Tab") {
      const buttons = [...journal.querySelectorAll("button:not(:disabled)")].filter(button => button.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  }, { capture: true });
  window.addEventListener("resize", () => requestAnimationFrame(fitJournal));

  return {
    grid,
    overlay,
    open,
    openJournal,
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
      drawJournal();
    },
  };
}
