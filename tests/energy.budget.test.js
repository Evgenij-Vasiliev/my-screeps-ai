"use strict";
/**
 * ENERGY.BUDGET.TEST.JS — периодические имперские бюджеты направлений.
 *
 * С 24.11.2026 бюджет РЕАЛЬНО ограничивает расход: лимит проверяется при
 * выдаче задачи, стоимость атомарно резервируется на задаче, неизрасходованное
 * возвращается при отмене/завершении, между периодами не переносится.
 * Обхода лимита нет ни у одного направления (BUDGET.CRITICAL удалён).
 *
 * Проверяем:
 *   1) лимиты считаются от числа источников (10 источников → 30 000);
 *   2) сумма долей SHARES ровно 10000, лимиты совпадают с share * 3;
 *   3) лимит направления общий, задача списывает полную стоимость;
 *   4) при остатке меньше стоимости задача не выдаётся;
 *   5) направления независимы;
 *   6) граница периода создаёт новый бюджет; резерв прошлого периода
 *      не возвращается в новый;
 *   7) задача без направления бюджет не трогает;
 *   8) жизненные направления (spawn) тоже упираются в лимит, поблажка —
 *      только PROTECTED для обязательных задач;
 *   9) резерв живёт на задаче: повторная выдача не списывает дважды;
 *  10) отмена возвращает неизрасходованное, завершение — только остаток,
 *      повторный возврат ничего не возвращает;
 *  11) две задачи не получают один и тот же остаток;
 *  12) canReserve (резерв Storage) от бюджета не зависит;
 *  13) снятие/завершение задачи через task.manager освобождает резерв.
 *
 * Запуск: node tests/energy.budget.test.js
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(__dirname, "..", request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

global.Memory = {};
global.Game = { time: 0, rooms: {}, creeps: {} };
global.RESOURCE_ENERGY = "energy";
global.RESOURCE_BATTERY = "battery";
global.RESOURCE_POWER = "power";
global.STRUCTURE_SPAWN = "spawn";
global.STRUCTURE_TOWER = "tower";
global.STRUCTURE_EXTENSION = "extension";
global.STRUCTURE_LINK = "link";
global.STRUCTURE_LAB = "lab";
global.STRUCTURE_FACTORY = "factory";
global.STRUCTURE_POWER_SPAWN = "powerSpawn";
global.STRUCTURE_OBSERVER = "observer";
global.STRUCTURE_EXTRACTOR = "extractor";
global.STRUCTURE_NUKER = "nuker";

const { BUDGET } = require("../constants");
const energyPolicy = require("../energy.policy");
const taskManager = require("../task.manager");

for (let i = 1; i <= 5; i++) {
  Game.rooms["W1N" + i] = {
    name: "W1N" + i,
    controller: { my: true },
    sources: [{}, {}],
  };
}

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra === undefined ? "" : " — " + extra}`);
  }
}

/** Ставит остатки всех направлений на полный лимит текущего периода. */
function fillBudget() {
  const st = energyPolicy.budgetStatus();
  for (const k in st.limits) st.remaining[k] = st.limits[k];
}

/** Новая задача снабжения/траты энергии в направлении. */
function makeTask(direction, cost, extra) {
  const t = Object.assign({}, extra || {});
  t.direction = direction;
  t.reserve = cost;
  t.maxEnergy = cost;
  t.budgetCost = cost;
  return t;
}

console.log("1. Расчёт от источников и доли SHARES");
{
  const st = energyPolicy.budgetStatus();
  check("income = 30 000 (10 источников)", st.income === 30000, st.income);

  let sum = 0;
  for (const dir in BUDGET.SHARES) sum += BUDGET.SHARES[dir];
  check("сумма долей ровно 10000", sum === 10000, sum);

  const bad = [];
  for (const dir in BUDGET.SHARES) {
    const want = Math.floor((30000 * BUDGET.SHARES[dir]) / 10000);
    if (st.limits[dir] !== want) bad.push(dir + ":" + st.limits[dir] + "!=" + want);
  }
  check("лимиты = share * 3", bad.length === 0, bad.join(", "));
  check(
    "лимит factory 14 082 (пересчёт 24.11: 12 803 × 1.1)",
    st.limits.factory === 14082,
    st.limits.factory,
  );
  check("лимит spawn 3 039", st.limits.spawn === 3039, st.limits.spawn);
  check("лимит towers 5 523", st.limits.towers === 5523, st.limits.towers);
  check("BUDGET.CRITICAL удалён", BUDGET.CRITICAL === undefined);
}

console.log("\n2. Полная стоимость задачи и общий лимит");
{
  fillBudget();
  const first = makeTask("factory", 600);
  check("первая задача списана", energyPolicy.tryChargeTaskBudget(first) === true);
  check(
    "остаток 13 482",
    energyPolicy.budgetStatus().remaining.factory === 13482,
    energyPolicy.budgetStatus().remaining.factory,
  );

  let charged = 1;
  while (energyPolicy.tryChargeTaskBudget(makeTask("factory", 600))) charged++;
  check("всего 23 задачи по 600", charged === 23, charged);
  check(
    "остаток 282",
    energyPolicy.budgetStatus().remaining.factory === 282,
    energyPolicy.budgetStatus().remaining.factory,
  );
  check(
    "24-я не проходит",
    energyPolicy.budgetAvailable(makeTask("factory", 600)) === false,
  );
}

console.log("\n3. Направления независимы и проверка не списывает");
{
  fillBudget();
  const tower = makeTask("towers", 500);
  check("башни имеют бюджет", energyPolicy.tryChargeTaskBudget(tower) === true);
  check(
    "остаток башен 5 023",
    energyPolicy.budgetStatus().remaining.towers === 5023,
    energyPolicy.budgetStatus().remaining.towers,
  );
  check("budgetAvailable не списывает", energyPolicy.budgetAvailable(tower) === true);
  check(
    "остаток башен всё ещё 5 023",
    energyPolicy.budgetStatus().remaining.towers === 5023,
    energyPolicy.budgetStatus().remaining.towers,
  );
  // factory уже исчерпан предыдущим разделом? нет — fillBudget вернул лимит.
  check(
    "factory при этом работает",
    energyPolicy.tryChargeTaskBudget(makeTask("factory", 600)) === true,
  );
}

console.log("\n4. Резерв хранится на задаче, повторной выдачи нет");
{
  fillBudget();
  const t = makeTask("towers", 500);
  check("списано", energyPolicy.tryChargeTaskBudget(t) === true);
  check("budgetPeriod записан", t.budgetPeriod === 0, t.budgetPeriod);
  check("budgetCharged записан", t.budgetCharged === 500, t.budgetCharged);
  const before = energyPolicy.budgetStatus().remaining.towers;
  const chargedBefore = energyPolicy.budgetStatus().charged.towers;
  check("повторная выдача — true", energyPolicy.tryChargeTaskBudget(t) === true);
  check(
    "повторной траты нет",
    energyPolicy.budgetStatus().remaining.towers === before,
    energyPolicy.budgetStatus().remaining.towers,
  );
  check(
    "charged не удвоился",
    energyPolicy.budgetStatus().charged.towers === chargedBefore,
    energyPolicy.budgetStatus().charged.towers,
  );
}

console.log("\n5. Отмена возвращает неизрасходованное, повторно — ничего");
{
  fillBudget();
  const t = makeTask("repair", 500);
  energyPolicy.tryChargeTaskBudget(t);
  check("после списания 1 501", energyPolicy.budgetStatus().remaining.repair === 1501);
  check("возврат 500", energyPolicy.releaseTaskBudget(t) === 500);
  check("остаток восстановлен", energyPolicy.budgetStatus().remaining.repair === 2001);
  check("charged снят", energyPolicy.budgetStatus().charged.repair === 0);
  check("повторный возврат — 0", energyPolicy.releaseTaskBudget(t) === 0);
  check("остаток не вырос", energyPolicy.budgetStatus().remaining.repair === 2001);
  check("поля сняты", t.budgetPeriod === undefined && t.budgetCharged === undefined);
}

console.log("\n6. Завершение: израсходованное не возвращается");
{
  fillBudget();
  const t = makeTask("build", 500);
  energyPolicy.tryChargeTaskBudget(t);
  t.energyTaken = 300; // крип снял из Storage 300 из 500
  check("возврат остатка 200", energyPolicy.releaseTaskBudget(t) === 200);
  check(
    "остаток 600 (900 - 300)",
    energyPolicy.budgetStatus().remaining.build === 600,
    energyPolicy.budgetStatus().remaining.build,
  );
  check(
    "charged = 300 (только израсходованное)",
    energyPolicy.budgetStatus().charged.build === 300,
    energyPolicy.budgetStatus().charged.build,
  );
}

console.log("\n7. Две задачи не получают один остаток");
{
  fillBudget();
  const st = energyPolicy.budgetStatus();
  st.remaining.factory = 900;
  const a = makeTask("factory", 600);
  const b = makeTask("factory", 600);
  check("первая взяла остаток", energyPolicy.tryChargeTaskBudget(a) === true);
  check("вторая отказана", energyPolicy.tryChargeTaskBudget(b) === false);
  check("остаток 300", st.remaining.factory === 300, st.remaining.factory);
  check("вторая ничего не зарезервировала", b.budgetPeriod === undefined);
}

console.log("\n8. Жизненное направление тоже упирается в лимит (PROTECTED)");
{
  fillBudget();
  const st = energyPolicy.budgetStatus();
  st.remaining.spawn = 800;

  check(
    "обычная задача не трогает защищённые 500",
    energyPolicy.tryChargeTaskBudget(makeTask("spawn", 400)) === false,
  );
  const mandatory = makeTask("spawn", 400, { mandatory: true });
  check(
    "обязательная задача может",
    energyPolicy.tryChargeTaskBudget(mandatory) === true,
  );
  check("остаток 400", st.remaining.spawn === 400, st.remaining.spawn);
  check(
    "обычная после резерва заблокирована",
    energyPolicy.tryChargeTaskBudget(makeTask("spawn", 100)) === false,
  );
  st.remaining.spawn = 300;
  check(
    "и обязательная не выходит за остаток",
    energyPolicy.tryChargeTaskBudget(makeTask("spawn", 400, { mandatory: true })) ===
      false,
  );
}

console.log("\n9. Граница периода: бюджет новый, старый резерв не возвращается");
{
  fillBudget();
  const old = makeTask("factory", 600);
  energyPolicy.tryChargeTaskBudget(old);
  check("в периоде 0 зарезервировано", old.budgetPeriod === 0);

  Game.time = BUDGET.PERIOD_TICKS;
  const s = energyPolicy.budgetStatus();
  check("новый период", s.period === 1, s.period);
  check("лимит фабрик восстановлен", s.limits.factory === 14082, s.limits.factory);
  check("стартовый кредит периода", s.remaining.factory === 3000, s.remaining.factory);
  check(
    "резерв прошлого периода не возвращён",
    energyPolicy.releaseTaskBudget(old) === 0,
  );
  check("остаток не изменился", s.remaining.factory === 3000, s.remaining.factory);
  const fresh = makeTask("factory", 600);
  check("задача нового периода списывает", energyPolicy.tryChargeTaskBudget(fresh) === true);
  check("новый резерв помечен периодом", fresh.budgetPeriod === 1, fresh.budgetPeriod);
}

console.log("\n10. Задача без направления");
{
  const before = energyPolicy.budgetStatus().charged.factory;
  check(
    "без направления — true",
    energyPolicy.tryChargeTaskBudget({ maxEnergy: 600 }) === true,
  );
  check(
    "бюджеты не изменились",
    energyPolicy.budgetStatus().charged.factory === before,
  );
}

console.log("\n11. Overflow фабрик при высоком Storage");
{
  Game.time = 600;
  Game.rooms["W1N1"].storage = { store: { energy: 2500000 } };
  const high = energyPolicy.budgetStatus();
  check("overflow включён", high.overflowFactory === 11000, high.overflowFactory);
  check("factory 25 082", high.limits.factory === 25082, high.limits.factory);
  Game.time = 900;
  Game.rooms["W1N1"].storage.store.energy = 1000000;
  const low = energyPolicy.budgetStatus();
  check("overflow выключен", low.overflowFactory === 0, low.overflowFactory);
  check("factory 14 082", low.limits.factory === 14082, low.limits.factory);
}

console.log("\n12. Резерв Storage не зависит от бюджета");
{
  fillBudget();
  const room = Game.rooms.W1N1;
  room.storage = { store: { energy: 200000 } };
  const task = makeTask("factory", 600);
  room.storage.store.energy = 200000; // free = 200000 - 150000 - 20000 = 30000
  check("canReserve при свободной энергии", energyPolicy.canReserve(room, task) === true);
  room.storage.store.energy = 160000; // free < 0
  check(
    "canReserve при пустом резерве — false",
    energyPolicy.canReserve(room, task) === false,
  );
  delete room.storage;
}

console.log("\n13. task.manager освобождает резерв при release/complete");
{
  Game.time = 1200; // период 4
  Memory.rooms = { W1N1: {} };
  fillBudget();

  const t = makeTask("towers", 500);
  t.reservedBy = "worker_W1N1_1";
  Game.creeps = { worker_W1N1_1: { name: "worker_W1N1_1" } };
  taskManager.addTask("W1N1", "fillTowers", t);
  check("резерв списан", energyPolicy.tryChargeTaskBudget(t) === true);
  const afterCharge = energyPolicy.budgetStatus().remaining.towers;
  check(
    "releaseTask освобождает",
    taskManager.releaseTask("W1N1", "fillTowers", t) === true,
  );
  check(
    "резерв вернулся",
    energyPolicy.budgetStatus().remaining.towers === afterCharge + 500,
    energyPolicy.budgetStatus().remaining.towers,
  );
  check("бронь снята", t.reservedBy === undefined);

  const c = makeTask("towers", 500);
  c.reservedBy = "worker_W1N1_1";
  taskManager.addTask("W1N1", "fillTowers", c);
  energyPolicy.tryChargeTaskBudget(c);
  c.energyTaken = 500; // израсходовано полностью
  const beforeComplete = energyPolicy.budgetStatus().remaining.towers;
  check("completeTask", taskManager.completeTask("W1N1", "fillTowers", c) === true);
  check(
    "completeTask не возвращает израсходованное",
    energyPolicy.budgetStatus().remaining.towers === beforeComplete,
    energyPolicy.budgetStatus().remaining.towers,
  );
  check(
    "задача снята из очереди",
    Memory.rooms.W1N1.tasks.fillTowers[1] === null,
    JSON.stringify(Memory.rooms.W1N1.tasks.fillTowers[1]),
  );
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
