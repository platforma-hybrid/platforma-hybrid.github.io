// Лестница уровней сил и Воли (автор, 24.10.2026): первые уровни — быстро, дальше всё медленнее, потолок ~100.
// Цена уровня: первый стоит base очков; каждый следующий дороже на steps[i] — шаг меняется каждые `every` уровней
// (+20 %, +15 %, +10 %, +5 %), дальше — ровно floor (+4 %). Настройка — dailies.json → levelCurve.
// Хранение не меняется: колба = { level, progress }, progress — очки внутри текущего уровня.

const DEFAULT = { base: 10, steps: [0.2, 0.15, 0.1, 0.05], every: 5, floor: 0.04 };

/** Сколько очков нужно, чтобы с уровня level подняться на level + 1. Число — старая ровная шкала. */
export function levelNeed(curve, level) {
  if (typeof curve === "number") return curve;
  const c = { ...DEFAULT, ...(curve ?? {}) };
  let need = c.base;
  for (let l = 1; l <= level; l++) {
    const i = Math.floor((l - 1) / c.every);
    need *= 1 + (i < c.steps.length ? c.steps[i] : c.floor);
  }
  return Math.max(1, Math.round(need));
}

/** Добавить (или снять) очки: уровень растёт и падает по лестнице, ниже нуля не уходит. Возвращает, на сколько изменился уровень. */
export function addPoints(curve, flask, amount) {
  const before = flask.level;
  flask.progress += amount;
  while (flask.progress >= levelNeed(curve, flask.level)) {
    flask.progress -= levelNeed(curve, flask.level);
    flask.level += 1;
  }
  while (flask.progress < 0 && flask.level > 0) {
    flask.level -= 1;
    flask.progress += levelNeed(curve, flask.level);
  }
  flask.progress = Math.max(0, Math.round(flask.progress));
  return flask.level - before;
}

/** Дробный уровень: 7 и половина пути до 8 → 7.5. Для равновесия и формы — по видимым числам, а не по сумме очков. */
export function fractionalLevel(curve, flask) {
  if (!flask) return 0;
  return (flask.level ?? 0) + (flask.progress ?? 0) / levelNeed(curve, flask.level ?? 0);
}

/** Перевод старой ровной шкалы (каждый уровень = max очков) на лестницу: все накопленные очки сохраняются. */
export function migrateFlask(curve, flask, oldMax) {
  const total = (flask.level ?? 0) * oldMax + (flask.progress ?? 0);
  const out = { level: 0, progress: 0 };
  addPoints(curve, out, total);
  return out;
}
