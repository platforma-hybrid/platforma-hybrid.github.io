// Режим правки Main Hub (?edit=1): слои вкл/выкл, перетаскивание элементов,
// колёсико — размер блока, точные координаты, скрыть/показать,
// сохранение hub.layout.json в файл (или копирование). Действия кнопок в этом режиме отключены.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function startEditMode(ctx, { placeItem }) {
  const { stage, layout } = ctx;
  stage.classList.add("edit-mode");
  const itemsById = new Map(layout.items.map((item) => [item.id, item]));
  let selected = null;

  const panel = el("aside", "edit-panel");
  panel.setAttribute("aria-label", "Режим правки");
  const header = el("h2", "", "Правка хаба");
  const collapse = el("button", "edit-collapse", "свернуть");
  collapse.type = "button";
  collapse.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    collapse.textContent = collapsed ? "развернуть" : "свернуть";
  });
  header.append(collapse);
  panel.append(header);

  // слои
  const layersBox = el("fieldset");
  layersBox.append(el("legend", "", "Слои"));
  for (const layer of layout.layers) {
    const label = el("label");
    const box = el("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => {
      const node = stage.querySelector(`[data-layer="${layer.id}"]`);
      if (node instanceof HTMLElement) node.style.display = box.checked ? "" : "none";
    });
    label.append(box, ` ${layer.id} · ${layer.name}`);
    layersBox.append(label);
  }
  const animLabel = el("label");
  const animBox = el("input");
  animBox.type = "checkbox";
  animBox.checked = !document.body.classList.contains("no-anim");
  animBox.addEventListener("change", () => {
    document.body.classList.toggle("no-anim", !animBox.checked);
    layout.animations = animBox.checked;
  });
  animLabel.append(animBox, " Анимации");
  layersBox.append(animLabel);

  // масштаб интерфейса: меняется сразу на сцене и попадает в копируемый JSON
  const scaleLabel = el("label", "edit-field");
  const scaleInput = el("input");
  scaleInput.type = "number";
  scaleInput.step = "0.05";
  scaleInput.min = "0.3";
  scaleInput.max = "1.5";
  scaleInput.value = String(layout.uiScale ?? 1);
  scaleInput.addEventListener("input", () => {
    const value = Number(scaleInput.value);
    if (!Number.isFinite(value) || value <= 0) return;
    layout.uiScale = value;
    stage.style.setProperty("--ui-scale", String(value));
  });
  scaleLabel.append("uiScale ", scaleInput);
  layersBox.append(scaleLabel);

  // выбранный элемент
  const itemBox = el("fieldset");
  itemBox.append(el("legend", "", "Элемент"));
  const itemName = el("div", "edit-name", "— щёлкните по элементу —");
  // список всех элементов: так можно выбрать и скрытый, и закрытый другими
  const picker = el("select");
  picker.append(new Option("— выбрать из списка —", ""));
  for (const item of layout.items) picker.append(new Option(`${item.id} · ${item.layer}`, item.id));
  picker.addEventListener("change", () => {
    const node = stage.querySelector(`.item[data-id="${CSS.escape(picker.value)}"]`);
    if (node instanceof HTMLElement) select(node);
  });
  itemBox.append(itemName, picker);
  const inputs = {};
  for (const key of ["x", "y", "w", "h"]) {
    const label = el("label", "edit-field");
    const input = el("input");
    input.type = "number";
    input.step = "1";
    input.disabled = true;
    input.addEventListener("input", () => {
      if (!selected) return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      selected.item[key] = Math.round(value);
      placeItem(selected.node, selected.item);
    });
    inputs[key] = input;
    label.append(`${key} `, input);
    itemBox.append(label);
  }

  // размер: у блоков интерфейса — свой масштаб (scale), у картинок — ширина/высота
  const sizeLabel = el("label", "edit-field");
  const sizeInput = el("input");
  sizeInput.type = "number";
  sizeInput.style.width = "56px";
  sizeInput.step = "5";
  sizeInput.min = "20";
  sizeInput.max = "400";
  sizeInput.disabled = true;
  sizeInput.addEventListener("input", () => {
    if (!selected) return;
    const value = Number(sizeInput.value);
    if (!Number.isFinite(value) || value < 20) return;
    resizeTo(selected, value / 100);
  });
  sizeLabel.append("размер % ", sizeInput);
  const visLabel = el("label");
  const visBox = el("input");
  visBox.type = "checkbox";
  visBox.disabled = true;
  visBox.addEventListener("change", () => {
    if (!selected) return;
    if (visBox.checked) delete selected.item.visible;
    else selected.item.visible = false;
    selected.node.hidden = !visBox.checked;
  });
  visLabel.append(visBox, " показывать");
  itemBox.append(sizeLabel, visLabel);

  // вывод JSON
  const actions = el("div", "edit-actions");
  const copyButton = el("button", "", "Скопировать layout JSON");
  copyButton.type = "button";
  const output = el("textarea");
  output.readOnly = true;
  output.hidden = true;
  const toJson = () => `${JSON.stringify(layout, null, 2)}\n`;
  copyButton.addEventListener("click", async () => {
    const json = toJson();
    output.value = json;
    try {
      await navigator.clipboard.writeText(json);
      copyButton.textContent = "Скопировано ✓";
    } catch {
      output.hidden = false;
      output.select();
      copyButton.textContent = "Скопируйте из поля ниже";
    }
    window.setTimeout(() => (copyButton.textContent = "Скопировать layout JSON"), 2000);
  });
  // «Сохранить в файл»: первый раз Chrome спросит файл (выберите hub/hub.layout.json), дальше пишет молча
  const saveButton = el("button", "edit-save", "Сохранить в файл");
  saveButton.type = "button";
  let fileHandle = null;
  saveButton.addEventListener("click", async () => {
    if (!("showSaveFilePicker" in window)) {
      saveButton.textContent = "Браузер не умеет — жмите «Скопировать»";
      return;
    }
    try {
      fileHandle ??= await window.showSaveFilePicker({
        suggestedName: "hub.layout.json",
        types: [{ description: "Раскладка хаба", accept: { "application/json": [".json"] } }],
      });
      const writable = await fileHandle.createWritable();
      await writable.write(toJson());
      await writable.close();
      saveButton.textContent = `Сохранено ✓ (${fileHandle.name})`;
    } catch (error) {
      if (error?.name === "AbortError") return; // окно выбора закрыли
      console.error("[hub.edit] не удалось сохранить:", error);
      saveButton.textContent = "Не сохранилось — жмите «Скопировать»";
    }
    window.setTimeout(() => (saveButton.textContent = "Сохранить в файл"), 2500);
  });
  actions.append(saveButton, copyButton);

  const help = el(
    "p",
    "edit-help",
    "Перетаскивайте мышью, стрелки — сдвиг на 1 px (Shift — 10 px). Колёсико над блоком — меньше/больше (Shift — точнее). «Сохранить в файл» — выберите frontend-v0/hub/hub.layout.json, потом обновите страницу без ?edit=1.",
  );
  panel.append(layersBox, itemBox, actions, output, help);
  document.body.append(panel);

  const refresh = () => {
    if (!selected) return;
    itemName.textContent = `${selected.item.id} · ${selected.item.layer}`;
    for (const key of ["x", "y", "w", "h"]) {
      inputs[key].disabled = false;
      inputs[key].value = String(selected.item[key]);
    }
    sizeInput.disabled = false;
    sizeInput.value = String(Math.round(sizeOf(selected) * 100));
    visBox.disabled = false;
    visBox.checked = selected.item.visible !== false;
    picker.value = selected.item.id;
  };

  // блок интерфейса (с якорем) — масштаб к якорю; картинка — ширина/высота от центра
  const isUi = (item) => Boolean(item.anchor);
  const baseSize = new Map(); // исходные w/h картинок, чтобы «размер %» считался от них
  const sizeOf = ({ item }) => {
    if (isUi(item)) return item.scale ?? 1;
    if (!baseSize.has(item.id)) baseSize.set(item.id, { w: item.w, h: item.h });
    return item.w / baseSize.get(item.id).w;
  };
  const resizeTo = (target, factor) => {
    const f = Math.min(4, Math.max(0.2, factor));
    const { item, node } = target;
    if (isUi(item)) {
      item.scale = Math.round(f * 100) / 100;
      if (item.scale === 1) delete item.scale;
      node.style.setProperty("--item-scale", String(item.scale ?? 1));
    } else {
      sizeOf(target);
      const base = baseSize.get(item.id);
      const w = Math.round(base.w * f);
      const h = Math.round(base.h * f);
      item.x = Math.round(item.x - (w - item.w) / 2);
      item.y = Math.round(item.y - (h - item.h) / 2);
      item.w = w;
      item.h = h;
      placeItem(node, item);
    }
    refresh();
  };

  const select = (node) => {
    stage.querySelector(".item.selected")?.classList.remove("selected");
    const item = itemsById.get(node.dataset.id ?? "");
    if (!item) return;
    selected = { node, item };
    node.classList.add("selected");
    refresh();
  };

  // перетаскивание
  stage.addEventListener("pointerdown", (event) => {
    const node = event.target instanceof Element ? event.target.closest(".item") : null;
    if (!(node instanceof HTMLElement) || node.classList.contains("locked")) return;
    event.preventDefault();
    select(node);
    if (!selected) return;
    const { item } = selected;
    const scale = Number(stage.dataset.scale) || 1;
    const start = { x: event.clientX, y: event.clientY, itemX: item.x, itemY: item.y };
    node.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      item.x = Math.round(start.itemX + (moveEvent.clientX - start.x) / scale);
      item.y = Math.round(start.itemY + (moveEvent.clientY - start.y) / scale);
      placeItem(node, item);
      refresh();
    };
    const up = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
  });

  // колёсико над блоком: вверх — больше, вниз — меньше (Shift — шаг 1%, иначе 5%)
  stage.addEventListener(
    "wheel",
    (event) => {
      const node = event.target instanceof Element ? event.target.closest(".item") : null;
      if (!(node instanceof HTMLElement) || node.classList.contains("locked")) return;
      event.preventDefault();
      if (selected?.node !== node) select(node);
      if (!selected) return;
      const step = event.shiftKey ? 0.01 : 0.05;
      // Shift+колёсико в Chrome даёт deltaX вместо deltaY
      const delta = event.deltaY || event.deltaX;
      resizeTo(selected, sizeOf(selected) + (delta < 0 ? step : -step));
    },
    { passive: false },
  );

  document.addEventListener("keydown", (event) => {
    if (!selected || event.target instanceof HTMLInputElement) return;
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    selected.item.x += delta[0];
    selected.item.y += delta[1];
    placeItem(selected.node, selected.item);
    refresh();
  });
}
