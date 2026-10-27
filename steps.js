// Ступени заданий (автор, 26–27.10; claude/SPEC_TASKS.md): ступень — это сложнее само движение (с колен → классика).
// Гибрид двух путей, что раньше — то и срабатывает:
//  • по времени: с 3 недель на ступени — кнопка «Взять новую сложность» (награда мягко тает −20 % в неделю, не ниже 50 %),
//    через 5 недель мир поднимает сам;
//  • по делу: 2 недели подряд «сложная» (5 подходов) почти каждый день (12 из 14) — сразу ступень выше.
// Считаются только недели с делом (задание сделано хотя бы 4 дня из 7). Вернуть ступень — одна кнопка, без штрафа;
// тогда выше мир предложит не раньше чем через 2 недели. При ограничениях по здоровью — ни автомата, ни таяния.
// Чистые функции без браузера — проверяются тестом hub-steps.test.ts.

export const STEP_RULE = { offerWeeks: 3, autoWeeks: 5, weekDays: 4, fastDays: 12, fastWindow: 14, melt: 0.2, meltFloor: 0.5, cooldownDays: 14, returnDays: 7 };

/** «2026-10-27» → номер дня (для разницы дат). */
export function dayNum(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000);
}

/** Где человек на ступени задания и что ему положено сегодня. entry = { step, since, raisedAt?, noOfferUntil? }. */
export function stepStatus(ruleIn, id, entry, history, todayKey, opts = {}) {
  const rule = { ...STEP_RULE, ...(ruleIn ?? {}) };
  const today = dayNum(todayKey);
  const since = dayNum(entry.since ?? todayKey);
  const done = new Set();
  const hard = new Set();
  for (const h of history ?? []) {
    if (!h?.day) continue;
    const n = dayNum(h.day);
    if (n < since || n >= today) continue;
    if ((h.ids ?? []).includes(id)) done.add(n);
    if ((h.sets?.[id] ?? 0) >= (opts.setsMax ?? 5)) hard.add(n);
  }
  let activeWeeks = 0;
  for (let w = 0; since + 7 * (w + 1) <= today; w++) {
    let n = 0;
    for (let d = since + 7 * w; d < since + 7 * (w + 1); d++) if (done.has(d)) n++;
    if (n >= rule.weekDays) activeWeeks++;
  }
  let hardDays = 0;
  for (let d = today - rule.fastWindow; d < today; d++) if (hard.has(d)) hardDays++;
  const restricted = !!opts.restricted;
  const top = (opts.last ?? 0) <= (entry.step ?? 0);
  const cooled = today >= (entry.noOfferUntil != null ? dayNum(entry.noOfferUntil) : -Infinity);
  const offer = !top && cooled && activeWeeks >= rule.offerWeeks;
  const fast = !top && cooled && today - since >= rule.fastWindow && hardDays >= rule.fastDays;
  const auto = !restricted && !top && cooled && (activeWeeks >= rule.autoWeeks || fast);
  const mult = restricted || activeWeeks < rule.offerWeeks ? 1 : Math.max(rule.meltFloor, 1 - rule.melt * (activeWeeks - rule.offerWeeks + 1));
  const canReturn = (entry.step ?? 0) > 0 && entry.raisedAt != null && today - dayNum(entry.raisedAt) <= rule.returnDays;
  return { activeWeeks, hardDays, offer: offer || fast, auto, fast, mult, canReturn, top };
}

/** Ступень выше / ниже: новая запись (старую не меняем). */
export function stepUp(entry, todayKey) {
  return { step: (entry.step ?? 0) + 1, since: todayKey, raisedAt: todayKey };
}
export function stepDown(entry, todayKey, rule = STEP_RULE) {
  const until = dayNum(todayKey) + (rule.cooldownDays ?? 14);
  const d = new Date(until * 86400000);
  return { step: Math.max(0, (entry.step ?? 0) - 1), since: todayKey, noOfferUntil: `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` };
}
