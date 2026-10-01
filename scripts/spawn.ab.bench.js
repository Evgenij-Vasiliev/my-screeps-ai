"use strict";
/**
 * ===================================================
 * SCRIPTS/SPAWN.AB.BENCH.JS — микробенчмарк правок spawnManager
 * ===================================================
 * Локальный A/B (Node), а НЕ замер шарда: он нужен только чтобы отличить
 * «стало дешевле» от «стало дороже» там, где разница лежит ниже разрешения
 * отчёта бота (Memory.cpuStats.subsystems пишет 4 знака после запятой, а весь
 * spawnManager на 5 комнатах стоит ~0.07 CPU/тик).
 *
 * Состояние — как на живом shard3 30.09.2026: свободный спавн есть, 5 крипов,
 * все ненулевые квоты набраны, единственный недобор (mineralMiner) заблокирован
 * проверкой минерала (amount 130 < порога 1500). Иначе говоря, комната каждый
 * тик делала проверку, которая ничего не находила.
 *
 * Что сравнивается (1 вызов = 1 комната):
 *   A — прежний run: find + countRoles + обход квот КАЖДЫЙ тик;
 *   E — новый run в цикле тиков: шлюз пропускает комнату, скан раз в
 *       SPAWN.SCAN_INTERVAL тиков (то, что уезжает на шард);
 *   F — новый run, но шлюз снимается перед каждым вызовом (худший случай:
 *       недобор есть каждый тик — комната проверяется каждый тик, как раньше).
 *
 * Единицы: 1 µCPU = 1000 нс, 1 CPU = 1000 µCPU.
 *
 * Запуск:
 *   node scripts/spawn.ab.bench.js [число итераций на вариант]
 * ===================================================
 */

const Module = require("module");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (!request.startsWith(".") && !path.isAbsolute(request)) {
    const local = path.join(ROOT, request + ".js");
    if (fs.existsSync(local)) return local;
  }
  return origResolve.call(this, request, ...rest);
};

/* ── Игровые глобалы, как в тестах ────────────────────────────────────── */
global.OK = 0;
global.TOUGH = "tough";
global.WORK = "work";
global.CARRY = "carry";
global.MOVE = "move";
global.Memory = { rooms: {} };
global.Game = { time: 1000, creeps: {}, rooms: {}, cpu: { getUsed: () => 0 } };

const C = require(path.join(ROOT, "constants"));
const spawnManager = require(path.join(ROOT, "spawn.manager"));
const { countRoles } = spawnManager;
const Q = C.SPAWN_QUOTA;
const MIN = C.MINERAL_MIN_AMOUNT_TO_SPAWN;

function creep(role, ticksToLive) {
  return { memory: { role }, ticksToLive };
}

const roomState = {
  roomName: "W1N1",
  room: { controller: { ticksToDowngrade: 50000 } },
  // spawnCreep бросает: если вариант вдруг дойдёт до спавна, это будет видно.
  spawns: [
    {
      room: { name: "W1N1" },
      spawning: null,
      spawnCreep() {
        throw new Error("бенчмарк дошёл до spawnCreep");
      },
    },
  ],
  creeps: [
    creep("miner", 1400),
    creep("miner", 1200),
    creep("worker", 1300),
    creep("worker", 1100),
    creep("linkWorker", 900),
  ],
  mineral: { id: "m1", extractorId: "e1", amount: 130 },
};

/** Прежний run: ровно то, что было до правки 30.09.2026. */
function oldRun(rs) {
  const spawn = rs.spawns.find(s => !s.spawning);
  if (!spawn) return;
  const counts = countRoles(rs.creeps);
  for (const role in Q) {
    const quota = Q[role];
    if (!quota) continue;
    if ((counts[role] || 0) >= quota) continue;
    if (role === "upgrader" && rs.room.controller.ticksToDowngrade > 100000)
      continue;
    if (role === "mineralMiner") {
      if (!rs.mineral || !rs.mineral.extractorId) continue;
      if (rs.mineral.amount < MIN) continue;
    }
    return;
  }
}

const N = +(process.argv[2] || 500000);
const NANO = 1000; // нс в 1 µCPU

function bench(label, fn) {
  global.Game.time = 1000;
  delete global.__spawnGate;
  for (let i = 0; i < 100000; i++) {
    global.Game.time++; // каждый вызов — новый тик, как в loop
    fn(roomState);
  }
  global.Game.time = 2000000;
  delete global.__spawnGate;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    global.Game.time++;
    fn(roomState);
  }
  const ns = Number(process.hrtime.bigint() - t0) / N;
  console.log(`  ${label.padEnd(46)} ${ns.toFixed(1)} нс/тик`);
  return ns;
}

console.log(`Версия Node: ${process.version}; тиков на вариант: ${N}`);
console.log("1 вызов = 1 комната за 1 тик; 1 µCPU = 1000 нс\n");
const a = bench("A прежний run (скан каждый тик)", oldRun);
const e = bench("E новый run (шлюз: скан раз в интервал)", spawnManager.run);
const f = bench("F новый run, шлюз снят (недобор каждый тик)", rs => {
  // Не `delete`: удаление свойства переводит объект в словарный режим и меряет
  // не код, а сам приём замера. Пишем срок «уже наступил».
  const gate = global.__spawnGate || (global.__spawnGate = {});
  gate[rs.roomName] = 0;
  spawnManager.run(rs);
});

console.log(`\nE - A = ${(e - a).toFixed(1)} нс/тик  (эффект шлюза + ленивого find)`);
console.log(`F - A = ${(f - a).toFixed(1)} нс/тик  (худший случай: скан каждый тик)`);
console.log(
  `в переводе на 1 комнату и 1 тик: E ${(e / NANO).toFixed(4)} µCPU против A ${(a / NANO).toFixed(4)} µCPU`,
);
console.log(
  "\nЭто Node, а не изолят Screeps: цифры годятся только на знак и порядок разницы.",
);
