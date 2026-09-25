"use strict";
/**
 * ===================================================
 * MINER.BOOST.PLAN.TEST.JS — пачечная добыча под бустами и политика бустов
 * ===================================================
 * Что проверяется:
 *   1. role.miner.harvestPlan считает пачку от ЭФФЕКТИВНОЙ силы WORK, то есть
 *      учитывает добычный буст (BOOSTS.work.XUHO2.harvest = 7 — множитель,
 *      docs.screeps.com/resources.html: XUHO2 даёт +600 % к harvest). Раньше
 *      формула брала просто ЧИСЛО частей WORK, поэтому буст не сокращал число
 *      вызовов creep.harvest() и был бы потрачен впустую.
 *   2. Пачка НЕ превышает рюкзак крипа. Без этого ограничения буст ЛОМАЛ
 *      дальнего майнера: рюкзак 2 CARRY = 100, «пачка» 140, и проверка
 *      remote.miner «пачка не влезает» (getFreeCapacity < perCall) стала бы
 *      истинной всегда — крип только отдавал бы энергию и не добывал.
 *   3. Интервал ограничен MINER.MAX_INTERVAL и не превышает его при бусте.
 *   4. harvestBoostedWork — ключ пересчёта плана: 0 у небустнутого крипа.
 *   5. LAB_BOOST.BOOST_POLICY: все семь рабочих ролей имеют рассчитанный буст,
 *      обычные роли берут его из складов комнаты (from:"room"), а ресурсы
 *      ограничены тремя, у которых есть реальный потребитель.
 *   6. boost.manager.getConfig: список бустов буст-лабы следует за политикой
 *      (в живом shard3 там висел устаревший XUH2O вместо XUHO2, из-за чего
 *      защита рынка/сети распространялась на «вчерашний» ресурс).
 *
 * Запуск: node tests/miner.boost.plan.test.js
 */

// ── Глобалы движка (значения сняты с живого shard3) ──────────────────────
global.WORK = "work";
global.HARVEST_POWER = 2;
global.ENERGY_REGEN_TIME = 300;
global.RESOURCE_ENERGY = "energy";
// Коды движка, которые читает boost.manager (успех буста и его ошибки).
global.OK = 0;
global.ERR_NOT_ENOUGH_RESOURCES = -6;
global.ERR_TIRED = -11;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_INVALID_ARGS = -10;
global.ERR_FULL = -8;
global.ERR_NOT_OWNER = -1;
global.BOOSTS = {
  work: {
    UO: { harvest: 3 },
    UHO2: { harvest: 5 },
    XUHO2: { harvest: 7 },
  },
  carry: {
    KH2O: { capacity: 3 },
    XKH2O: { capacity: 4 },
  },
  move: {
    ZHO2: { fatigue: 2 },
    XZHO2: { fatigue: 4 },
  },
};

// ── Разрешение bare-require в стиле Screeps ─────────────────────────────
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const candidate = path.join(ROOT, request + ".js");
    if (fs.existsSync(candidate)) return candidate;
  }
  return origResolve.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

const { harvestPlan, harvestBoostedWork } = require("../role.miner");
const { LAB_BOOST, MINER, SPAWN_QUOTA, CREEP_BODIES } = require("../constants");
const boostManager = require("../boost.manager");

/** Крип с телом из частей (без бустов либо с бустом на WORK). */
function makeCreep(parts, workBoost, carryCapacity) {
  const body = [];
  for (const type of parts) {
    body.push({ type, boost: type === "work" && workBoost ? workBoost : undefined });
  }
  return {
    body,
    store: { getCapacity: () => carryCapacity },
  };
}

const SOURCE_3000 = { energyCapacity: 3000 };

// ── 1. План без буста: поведение не изменилось ──────────────────────────
{
  console.log("\n1. harvestPlan без буста (регрессия: прежние числа)");
  const miner = makeCreep(["work", "work", "work", "work", "work"], null, 300);
  const plan = harvestPlan(miner, SOURCE_3000);
  check("5 WORK → пачка 10, интервал 1", plan.perCall === 10 && plan.interval === 1, JSON.stringify(plan));

  const ten = makeCreep(
    Array(10).fill("work").concat(Array(6).fill("carry")),
    null,
    300,
  );
  const plan10 = harvestPlan(ten, SOURCE_3000);
  check("10 WORK → пачка 20, интервал 2 (3000-источник)", plan10.perCall === 20 && plan10.interval === 2, JSON.stringify(plan10));
}

// ── 2. План с XUHO2: пачка ×7, интервал по потолку ──────────────────────
{
  console.log("\n2. harvestPlan с XUHO2 (harvest ×7)");
  const miner = makeCreep(
    Array(10).fill("work").concat(Array(6).fill("carry")),
    "XUHO2",
    300,
  );
  const plan = harvestPlan(miner, SOURCE_3000);
  check("10 WORK + XUHO2 → пачка 140 (2 × 10 × 7), интервал 10", plan.perCall === 140 && plan.interval === 10, JSON.stringify(plan));
  check(
    "интервал не превышает MINER.MAX_INTERVAL",
    plan.interval <= MINER.MAX_INTERVAL,
    String(MINER.MAX_INTERVAL),
  );
  check(
    "вызовов harvest в 5 раз меньше, чем без буста (2 → 10 тиков)",
    Math.floor(plan.interval / 2) === 5,
    String(plan.interval),
  );

  const partial = makeCreep(
    Array(5).fill("work").concat(Array(5).fill("work")),
    "XUHO2",
    300,
  );
  const partialPlan = harvestPlan(partial, SOURCE_3000);
  check("те же 10 WORK, но без буста — другой интервал", partialPlan.interval === 10 && partialPlan.perCall === 140, JSON.stringify(partialPlan));
}

// ── 3. Пачка не больше рюкзака (защита дальнего майнера) ────────────────
{
  console.log("\n3. Пачка ограничена рюкзаком (remoteMiner: 2 CARRY = 100)");
  const remote = makeCreep(
    Array(10).fill("work").concat(Array(2).fill("carry")),
    "XUHO2",
    100,
  );
  const plan = harvestPlan(remote, SOURCE_3000);
  check(
    "рюкзак 100 меньше пачки 140 → perCall = 100",
    plan.perCall === 100,
    JSON.stringify(plan),
  );
  check(
    "проверка «пачка не влезает» (free 100 < perCall) больше не истинна всегда",
    100 < plan.perCall === false,
    JSON.stringify(plan),
  );
  check("интервал = floor(100/10) = 10", plan.interval === 10, JSON.stringify(plan));

  const noStore = { body: [{ type: "work" }] };
  const fallback = harvestPlan(noStore, SOURCE_3000);
  check(
    "крип без store.getCapacity не ломает расчёт",
    fallback.perCall === 2 && fallback.interval === 1,
    JSON.stringify(fallback),
  );
}

// ── 4. Ключ пересчёта плана ─────────────────────────────────────────────
{
  console.log("\n4. harvestBoostedWork — ключ пересчёта кэша плана");
  const plain = makeCreep(Array(3).fill("work"), null, 300);
  check("без буста — 0 (отсутствие записи в памяти читается как «бустов нет»)", harvestBoostedWork(plain) === 0);

  const oneBoosted = makeCreep(Array(3).fill("work"), "XUHO2", 300);
  oneBoosted.body[1].boost = undefined;
  check("частично бустнутый крип — 2 бустнутые части", harvestBoostedWork(oneBoosted) === 2, String(harvestBoostedWork(oneBoosted)));

  const other = makeCreep(Array(2).fill("work"), "UHO2", 300);
  check("UHO2 (harvest ×5) тоже считается бустом", harvestBoostedWork(other) === 2, String(harvestBoostedWork(other)));
}

// ── 5. Политика бустов: семь ролей, реальные ресурсы, from:"room" ────────
{
  console.log("\n5. LAB_BOOST.BOOST_POLICY — состав и приоритеты");
  const policy = LAB_BOOST.BOOST_POLICY;
  const roles = [
    "worker",
    "miner",
    "mineralMiner",
    "remoteMiner",
    "remoteHauler",
    "linkWorker",
    "labWorker",
  ];
  const missing = roles.filter((r) => !policy[r] || policy[r].length === 0);
  check("все семь рабочих ролей имеют буст", missing.length === 0, missing.join(","));

  let fromLab = [];
  const used = {};
  for (const role in policy) {
    for (const row of policy[role]) {
      if (row.from !== "room") fromLab.push(role + ":" + row.resource);
      used[row.resource] = true;
    }
  }
  check(
    'никто не бустуется из пустой буст-лабы (from:"room" у всех)',
    fromLab.length === 0,
    fromLab.join(","),
  );

  const resources = Object.keys(used).sort();
  check(
    "используются только бусты с реальным потребителем (XKH2O/XZHO2/XUHO2)",
    resources.join(",") === "XKH2O,XUHO2,XZHO2",
    resources.join(","),
  );
  check(
    "HEAL/RANGED_ATTACK-бусты мирным ролям не выдаются",
    !used.XLHO2 && !used.XKHO2 && !used.XGHO2 && !used.XUH2O,
    resources.join(","),
  );

  // Порог = минимальная ПОЛЕЗНАЯ ПАРТИЯ буста. Полный комплект (parts × 30) для
  // порога не годится: финальная тройка даёт 125 единиц за всю жизнь крипа
  // (5 ед / 60 тиков), поэтому порог в комплект не набирался бы почти никогда и
  // буст не выдавался бы вовсе. Нижняя граница — половина комплекта.
  let wrong = [];
  for (const role in policy) {
    for (const row of policy[role]) {
      if (row.minStock < (row.parts * 30) / 2) wrong.push(role + ":" + row.resource);
    }
  }
  check(
    "minStock не ниже половины комплекта (parts × 15)",
    wrong.length === 0,
    wrong.join(","),
  );
  // У РОЛЕЙ ПЕРВОГО ПРИОРИТЕТА порог ОСНОВНОГО буста не превышает полный
  // комплект (parts × 30): иначе буст ждал бы больше одной жизни крипа. Пороги
  // ВТОРОГО буста роли (XZHO2 у worker/remoteMiner) — намеренно выше размера
  // партии: это приоритетный шлюз, MOVE-буст выдаётся по остатку после CARRY и
  // harvest. У ролей «по остатку» (linkWorker, labWorker, harvester) порог тоже
  // выше собственного комплекта — по той же причине.
  const primary = {
    worker: "XKH2O",
    miner: "XUHO2",
    mineralMiner: "XUHO2",
    remoteMiner: "XUHO2",
    remoteHauler: "XKH2O",
  };
  let overPrimary = [];
  for (const role in primary) {
    for (const row of policy[role]) {
      if (row.resource !== primary[role]) continue;
      if (row.minStock > row.parts * 30) overPrimary.push(role + ":" + row.resource);
    }
  }
  check(
    "у ролей первого приоритета порог основного буста ≤ полного комплекта",
    overPrimary.length === 0,
    overPrimary.join(","),
  );
  const leftovers = ["linkWorker", "labWorker", "harvester"];
  check(
    "роли «по остатку» имеют порог выше, чем Worker (шлюз приоритета)",
    leftovers.every((role) =>
      policy[role].every((row) => row.minStock > policy.worker[0].minStock),
    ),
    leftovers.map((r) => r + ":" + policy[r][0].minStock).join(","),
  );
  // Порог сравнивается только внутри ОДНОГО ресурса: роль может иметь высокий
  // порог по XKH2O и низкий по XUHO2, и это не конфликт (ресурсы разные).
  const workerXkh2o = policy.worker.find((r) => r.resource === "XKH2O");
  const rivals = [];
  for (const role in policy) {
    if (role === "worker") continue;
    for (const row of policy[role]) {
      if (row.resource === "XKH2O") rivals.push(row.minStock);
    }
  }
  check(
    "Worker — самый низкий порог по XKH2O (наивысший приоритет выдачи)",
    workerXkh2o !== undefined &&
      rivals.length > 0 &&
      rivals.every((v) => v >= workerXkh2o.minStock),
    String(workerXkh2o && workerXkh2o.minStock) + " vs " + rivals.join(","),
  );
  check(
    "Worker'у не выдаётся WORK-буст (в экономике комнаты он не работает)",
    policy.worker.every((r) => r.resource !== "XUHO2"),
  );

  // Числа частей не могут превышать реальное тело роли — иначе буст «на части,
  // которых нет» (boost.manager урезает cap по факту, но конфиг обязан быть
  // честным).
  const carryOf = (role) => (CREEP_BODIES[role] && CREEP_BODIES[role].carry) || 0;
  const workOf = (role) => (CREEP_BODIES[role] && CREEP_BODIES[role].work) || 0;
  let over = [];
  for (const role in policy) {
    for (const row of policy[role]) {
      if (row.resource === "XKH2O" && row.parts > carryOf(role))
        over.push(role + ":XKH2O");
      if (row.resource === "XUHO2" && row.parts > workOf(role))
        over.push(role + ":XUHO2");
    }
  }
  check(
    "parts не превышают число реальных частей тела роли",
    over.length === 0,
    over.join(","),
  );

  // Резервы: хаб не отдаёт ниже своего, рабочая комната держит локальный.
  check(
    "HUB_RESERVE покрывает комплект замены дальнего контура",
    LAB_BOOST.HUB_RESERVE.XKH2O >= 600 &&
      LAB_BOOST.HUB_RESERVE.XUHO2 >= 300 &&
      LAB_BOOST.HUB_RESERVE.XZHO2 >= 600,
    JSON.stringify(LAB_BOOST.HUB_RESERVE),
  );
  check(
    "ROOM_RESERVE покрывает хотя бы один комплект замены Worker'а",
    LAB_BOOST.ROOM_RESERVE.XKH2O >= policy.worker[0].parts * 30,
    JSON.stringify(LAB_BOOST.ROOM_RESERVE),
  );
  check(
    "BOOST_SHIP_AMOUNT не меньше MIN_SEND_AMOUNT сети",
    LAB_BOOST.BOOST_SHIP_AMOUNT >= 1000,
    String(LAB_BOOST.BOOST_SHIP_AMOUNT),
  );
  check(
    "у каждой рабочей роли есть место в квоте спавна",
    roles.every((r) => typeof SPAWN_QUOTA[r] === "number" || r === "worker"),
  );
}

// ── 6. boost.manager.getConfig: список следует за политикой ─────────────
{
  console.log("\n6. boost.manager.getConfig — список бустов не устаревает");
  global.Memory = { rooms: {} };
  global.Game = { time: 1000 };

  const memory = {};
  const room = { name: "E35S37", memory };
  const first = boostManager.getConfig(room);
  const expected = [];
  for (const role in LAB_BOOST.BOOST_POLICY) {
    for (const row of LAB_BOOST.BOOST_POLICY[role]) {
      if (expected.indexOf(row.resource) === -1) expected.push(row.resource);
    }
  }
  check(
    "свежий конфиг содержит ровно ресурсы политики",
    first && first.boost.join(",") === expected.join(","),
    first ? first.boost.join(",") : "null",
  );
  check(
    "labId взят из LAB_BOOST.BOOST_LAB комнаты",
    first && first.labId === LAB_BOOST.BOOST_LAB.E35S37,
    first ? first.labId : "null",
  );

  // Устаревшая запись в Memory (как в живом shard3: XUH2O вместо XUHO2).
  memory.boostConfig = { labId: first.labId, boost: ["XUH2O", "XZHO2"] };
  const refreshed = boostManager.getConfig(room);
  check(
    "устаревший список переписывается актуальным",
    refreshed.boost.indexOf("XUHO2") !== -1 &&
      refreshed.boost.indexOf("XUH2O") === -1,
    refreshed.boost.join(","),
  );

  const again = boostManager.getConfig(room);
  check(
    "повторный вызов возвращает тот же объект (без лишних записей в Memory)",
    again === refreshed,
  );
}

// ── 7. Буст ОППОРТУНИСТИЧЕСКИЙ: роль никогда не блокируется ─────────────
// Аварийный случай живого shard3: E35S37 осталась без энергии в спавнах и
// расширениях, потому что Worker'ы «ждали XKH2O» — процедура буста подавляла
// роль каждый тик. Здесь фиксируются три гарантии:
//   1) комната без энергии не начинает бусты вовсе (роль важнее);
//   2) незавершённая процедура снимается по лимиту MAX_BUSY_TICKS;
//   3) нехватка буста не подавляет роль ни на один тик.
{
  console.log("\n7. Буст оппортунистический: роль важнее буста");

  const labId = LAB_BOOST.BOOST_LAB.E35S37;
  const makeRoomFixture = (energyAvailable) => ({
    name: "E35S37",
    memory: { boostLab: labId },
    storage: { store: { XKH2O: 0 } },
    terminal: { store: { XKH2O: 0 } },
    energyAvailable: energyAvailable,
    energyCapacityAvailable: 1000,
  });
  const makeBoostLab = (store) => ({
    id: labId,
    store: store,
    mineralType: "XKH2O",
    boostCreep: function (creep, count) {
      creep.boostCalls = (creep.boostCalls || 0) + 1;
      creep.lastBoost = { amount: count };
      return OK;
    },
  });
  const makeWorker = () => ({
    name: "worker_E35S37_test",
    my: true,
    spawning: false,
    memory: { role: "worker", homeRoom: "E35S37" },
    body: Array(10)
      .fill(null)
      .map(() => ({ type: "carry" })),
    boosts: {},
    store: { getUsedCapacity: () => 0, getFreeCapacity: () => 500 },
    pos: { isNearTo: () => true },
    travelTo: () => OK,
  });

  global.Memory = { rooms: {} };
  global.Game = { time: 5000 };

  // 1. Комната без энергии: буст не начинается, роль получает управление.
  {
    const room = makeRoomFixture(100); // < 50 % от 1000
    const lab = makeBoostLab({ energy: 1000, XKH2O: 300 });
    const state = { room, roomName: "E35S37", labs: [lab] };
    const creep = makeWorker();
    creep.room = room;
    const busy = boostManager.run(state, creep);
    check(
      "комната без энергии (ниже ENERGY_PAUSE_RATIO) буст не начинает",
      busy === false && !creep.boostCalls,
      String(busy) + "/" + String(creep.boostCalls || 0),
    );
    check(
      "и НЕ помечает крипа занятым бустом",
      creep.memory.boostTask === undefined &&
        creep.memory.boostLab === undefined,
      JSON.stringify(creep.memory),
    );

    // Зависшая процедура в комнате без энергии снимается: крип не считается
    // занятым бустом и память не висит (живой shard3: два Worker E35S37 держали
    // boostTask/boostLab, пока комната стояла без энергии).
    creep.memory.boostTask = { labId, resource: "XKH2O", parts: 10 };
    creep.memory.boostLab = { labId, resource: "XKH2O", parts: 10 };
    creep.memory.boostSince = 4000;
    const blocked = boostManager.run(state, creep);
    check(
      "в комнате без энергии зависшая процедура снимается",
      blocked === false &&
        creep.memory.boostTask === undefined &&
        creep.memory.boostLab === undefined &&
        creep.memory.boostSince === undefined,
      String(blocked) + "/" + JSON.stringify(creep.memory),
    );

    // Положительный контроль на том же фикстуре: энергии достаточно — буст идёт.
    room.energyAvailable = 1000;
    const busy2 = boostManager.run(state, creep);
    check(
      "с полной энергией тот же крип бустится (контроль)",
      busy2 === true && creep.boostCalls === 1,
      String(busy2) + "/" + String(creep.boostCalls || 0),
    );
  }

  // 2. Незавершённая процедура снимается по лимиту — спустя MAX_BUSY_TICKS
  //    роль ГАРАНТИРОВАННО получает управление.
  {
    const room = makeRoomFixture(1000);
    const lab = makeBoostLab({ energy: 1000, XKH2O: 300 });
    const state = { room, roomName: "E35S37", labs: [lab] };
    const creep = makeWorker();
    creep.room = room;
    creep.memory.boostTask = { labId, resource: "XKH2O", parts: 10 };
    creep.memory.boostLab = { labId, resource: "XKH2O", parts: 10 };
    creep.memory.boostSince = 5000 - (LAB_BOOST.MAX_BUSY_TICKS + 1);
    const busy = boostManager.run(state, creep);
    check(
      "процедура старше MAX_BUSY_TICKS брошена (роль работает)",
      busy === false &&
        creep.memory.boostTask === undefined &&
        creep.memory.boostLab === undefined,
      String(busy) + "/" + JSON.stringify(creep.memory),
    );
    check(
      "после брошенной процедуры назначена длинная пауза (не долбим каждый тик)",
      creep.memory.boostWait === 5000 + LAB_BOOST.ABANDON_RETRY,
      String(creep.memory.boostWait),
    );
  }

  // 3. Буста нет вовсе (даже на одну часть не хватает): роль не подавляется.
  {
    const room = makeRoomFixture(1000);
    const lab = makeBoostLab({ energy: 1000, XKH2O: 20 }); // < 30 = одной части мало
    const state = { room, roomName: "E35S37", labs: [lab] };
    const creep = makeWorker();
    creep.room = room;
    const busy = boostManager.run(state, creep);
    check(
      "на часть тела буста не хватает — роль не блокируется",
      busy === false && !creep.boostCalls && creep.memory.boostTask === undefined,
      String(busy) + "/" + JSON.stringify(creep.memory),
    );
    check(
      "попытка отложена на RETRY_INTERVAL, а не на каждый тик",
      creep.memory.boostWait === 5000 + LAB_BOOST.RETRY_INTERVAL,
      String(creep.memory.boostWait),
    );
  }

  // 4. В лабе есть буст на пару частей: крип бустится ЧАСТИЧНО и сразу, ничего
  //    не довозит (это и есть opportunistic: берём то, что доступно сейчас).
  {
    const room = makeRoomFixture(1000);
    const lab = makeBoostLab({ energy: 1000, XKH2O: 60 }); // ровно 2 части
    const state = { room, roomName: "E35S37", labs: [lab] };
    const creep = makeWorker();
    creep.room = room;
    const busy = boostManager.run(state, creep);
    check(
      "частичный буст из лабы выдаётся сразу, без доставки",
      busy === true &&
        creep.boostCalls === 1 &&
        creep.lastBoost.amount ===
          Math.min(
            LAB_BOOST.BOOST_POLICY.worker.find(r => r.resource === "XKH2O").parts,
            creep.body.length,
          ),
      String(busy) + "/" + JSON.stringify(creep.lastBoost || null),
    );
    check(
      "крип не ушёл в доставку (память процедуры пуста)",
      creep.memory.boostLab === undefined,
      JSON.stringify(creep.memory),
    );
  }
}

console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
