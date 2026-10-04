"use strict";
/**
 * ===================================================
 * CPU.MONITOR.TEST.JS — офлайн-проверка монитора CPU без накладных
 * ===================================================
 * Задание 3 плана docs/CPU-OPTIMIZATION-PLAN.md. Проверяем:
 *   1) Memory.cpuStats НЕ пишется на обычных тиках — только в тик отчёта
 *      (Game.time % CPU.REPORT_INTERVAL === 0);
 *   2) Object.keys(Game.creeps) не вызывается вне тика отчёта;
 *   3) накопители живут в heap и дают верное среднее;
 *   4) отключение через Memory.cpuMonitorEnabled === false работает;
 *   5) подробный режим по крипам выключен по умолчанию;
 *   6) сброс окна происходит на CPU.AVERAGE_WINDOW тиках;
 *   7) ВКЛЮЧЁННЫЙ verbose-режим действительно даёт разбивку ПО РОЛЯМ:
 *      trackRole(creep.memory.role, ...) (room/creeps.js:79-81) суммирует
 *      время крипов одной роли и доводит его до Memory.cpuStats.subsystems.
 *   8) Шаг 7 «профилирование по требованию» (замер shard3 29.09.2026,
 *      scripts/profiling.measure.js): в дорогом тике замер не делается,
 *      колбэк при этом исполняется; знаменатель отчёта — число РЕАЛЬНО
 *      профилированных тиков; при неполном bucket подробных тиков нет
 *      вовсе и отчёт отдаёт прошлый срез, не читая Game.creeps;
 *      автозамер по крипам — раз в CPU.VERBOSE_INTERVAL тиков при полном
 *      bucket, ручной флаг главнее, дорогой тик отменяет и его.
 *
 * Запуск: node tests/cpu.monitor.test.js
 */

global.Memory = {};
global.Game = {
  time: 0,
  cpu: { getUsed: () => 0, bucket: 10000, limit: 20 },
  creeps: { a: {}, b: {}, c: {} },
  rooms: {},
  spawns: {},
};

const { CPU } = require("../constants");
const cpuMonitor = require("../cpuMonitor");

/** Загрузчик не должен трогать Game.creeps вообще вне тика отчёта. */
let creepScans = 0;
const realCreeps = global.Game.creeps;
Object.defineProperty(global.Game, "creeps", {
  get() {
    creepScans++;
    return realCreeps;
  },
});

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

/** Один тик: startTick → условный trackRole → endTick. */
let cpuNow = 0;
global.Game.cpu.getUsed = () => cpuNow;

function runTick(time, cpuUsed, withTrack) {
  global.Game.time = time;
  cpuNow = 0; // startTick читает 0...
  cpuMonitor.startTick();
  cpuNow = cpuUsed; // ...а к концу тика израсходовано cpuUsed
  if (withTrack) {
    cpuMonitor.trackRole("towers", () => {});
    cpuMonitor.trackRole("marketManager", () => {});
  }
  cpuMonitor.endTick();
}

console.log("1. Обычный тик — Memory не трогается");
delete global.Memory.cpuStats;
creepScans = 0;
runTick(1, 1.0, true);
check("Memory.cpuStats не создан", global.Memory.cpuStats === undefined);
check("Game.creeps не читался", creepScans === 0, String(creepScans));

console.log("\n2. Накопители живут в heap и считают среднее");
const snap = cpuMonitor.snapshot();
check("окно содержит 1 тик", snap.windowCount === 1, String(snap.windowCount));
check("average = 1.0", snap.average === 1.0, String(snap.average));
check("подсистемы записаны в heap", snap.roleCPU.towers === 0, String(snap.roleCPU.towers));

console.log("\n3. Тик отчёта — единственная запись в Memory");
creepScans = 0;
runTick(CPU.REPORT_INTERVAL, 2.0, true);
check("Memory.cpuStats записан", !!global.Memory.cpuStats);
check("creeps посчитаны", global.Memory.cpuStats.creeps === 3, String(global.Memory.cpuStats.creeps));
check("bucket записан", global.Memory.cpuStats.bucket === 10000);
check("average = (1.0 + 2.0) / 2", global.Memory.cpuStats.average === 1.5, String(global.Memory.cpuStats.average));
check("subsystems — среднее за интервал", global.Memory.cpuStats.subsystems.towers === 0);
check(
  "Game.creeps прочитан только в тик отчёта",
  creepScans === 1,
  String(creepScans),
);

console.log("\n4. Ещё один обычный тик — снова без записи");
const before = JSON.stringify(global.Memory.cpuStats);
runTick(CPU.REPORT_INTERVAL + 1, 3.0, false);
check(
  "Memory.cpuStats не изменился",
  JSON.stringify(global.Memory.cpuStats) === before,
);

console.log("\n5. Отключение мониторинга");
global.Memory.cpuMonitorEnabled = false;
global.Memory.cpuStats = "sentinel";
creepScans = 0;
runTick(CPU.REPORT_INTERVAL * 2, 5.0, false);
check("Memory.cpuStats не перезаписан", global.Memory.cpuStats === "sentinel");
check("Game.creeps не читался", creepScans === 0, String(creepScans));
global.Memory.cpuMonitorEnabled = true;

console.log("\n6. Подробный режим по крипам — по умолчанию ручного флага нет");
// Шаг 7: кроме ручного флага есть автозамер при полном bucket, поэтому
// состояние читается ПОСЛЕ startTick того тика, в котором спрашиваем.
global.Game.time = 0;
cpuNow = 0;
cpuMonitor.startTick();
check("verboseEnabled() === false без флага и без автозамера", cpuMonitor.verboseEnabled() === false);
global.Memory.cpuMonitorVerbose = true;
check("verboseEnabled() === true после флага", cpuMonitor.verboseEnabled() === true);
delete global.Memory.cpuMonitorVerbose;
cpuMonitor.endTick();

console.log("\n7. Сброс окна на AVERAGE_WINDOW тиках");
cpuMonitor.startTick();
cpuMonitor.endTick();
const s = cpuMonitor.snapshot();
check("окно сброшено или растёт корректно", s.windowCount >= 0 && s.windowCount < CPU.AVERAGE_WINDOW, String(s.windowCount));

console.log("\n8. Verbose-режим: разбивка по РОЛЯМ (не по крипам)");
// Ручной флаг проверяем в чистом виде: false запрещает и автозамер (Шаг 7),
// поэтому расписание автозамера на этот раздел не влияет.
// Часы должны идти ВНУТРИ trackRole: при неподвижном cpuNow замер всегда
// равен 0 (см. раздел 2), поэтому прежняя проверка «флаг переключился» ничего
// не говорила о самом замере.
global.Memory.cpuStats = undefined;
delete global.Memory.cpuStats;
global.Memory.cpuMonitorVerbose = false; // сначала запрет автозамера...
check("ручной false выключает verbose", cpuMonitor.verboseEnabled() === false);
global.Memory.cpuMonitorVerbose = true; // ...потом ручное включение
check("verbose включён", cpuMonitor.verboseEnabled() === true);

global.Game.time = CPU.REPORT_INTERVAL; // тик отчёта → subsystems = сумма / профилированные тики
cpuNow = 0;
cpuMonitor.startTick();
// Три крипа двух ролей ровно как в runCreepLogic: trackRole(role, ...).
cpuNow = 0.1; cpuMonitor.trackRole("harvester", () => { cpuNow = 0.2; });
cpuMonitor.trackRole("harvester", () => { cpuNow = 0.4; });
cpuMonitor.trackRole("upgrader", () => { cpuNow = 0.55; });
cpuMonitor.endTick();

const verboseSnap = cpuMonitor.snapshot();
check(
  "два крипа-харвестера сложились в одну роль",
  Math.abs(verboseSnap.roleCPU.harvester - 0.3) < 1e-9,
  String(verboseSnap.roleCPU.harvester),
);
check(
  "роль крипа — отдельный ключ от другой роли",
  Math.abs(verboseSnap.roleCPU.upgrader - 0.15) < 1e-9,
  String(verboseSnap.roleCPU.upgrader),
);
check(
  "разбивка по ролям дошла до Memory.cpuStats.subsystems",
  // Шаг 7: знаменатель — число ПРОФИЛИРОВАННЫХ тиков окна, а не всё окно
  // (иначе при профилировании по требованию цифры занижались бы в разы).
  // Тик профилирован один → 0.3 / 1 и 0.15 / 1.
  Math.abs(global.Memory.cpuStats.subsystems.harvester - 0.3) < 1e-9 &&
    Math.abs(global.Memory.cpuStats.subsystems.upgrader - 0.15) < 1e-9,
  JSON.stringify(global.Memory.cpuStats.subsystems),
);
delete global.Memory.cpuMonitorVerbose;
// Состояние читается ПОСЛЕ startTick: verboseEnabled() отвечает про текущий
// тик, а не про «флаг в Memory прямо сейчас» (Шаг 7).
global.Game.time = CPU.REPORT_INTERVAL + 1;
cpuNow = 0;
cpuMonitor.startTick();
check("verbose выключен", cpuMonitor.verboseEnabled() === false);
cpuMonitor.endTick();

console.log("\n9. Гейт verbose в runCreepLogic: замер только под флагом");
// room.manager нельзя дёргать целиком (нужен Game с комнатами), поэтому
// проверяем сам гейт по исходнику: обычная ветка не должна звать trackRole.
const fs = require("fs");
const path = require("path");
// Читается ВЕСЬ слой комнаты (фасад + room/*.js, разбиение 04.10.2026):
// runCreepLogic живёт в room/creeps.js, и по одному фасаду маркеров не найти —
// проверка упала бы не по делу.
const roomDir = path.join(__dirname, "..", "room");
const roomManagerSrc = [path.join(__dirname, "..", "room.manager.js")]
  .concat(
    fs.existsSync(roomDir)
      ? fs
          .readdirSync(roomDir)
          .filter(f => f.endsWith(".js"))
          .sort()
          .map(f => path.join(roomDir, f))
      : [],
  )
  .map(p => fs.readFileSync(p, "utf8"))
  .join("\n");
const gateAt = roomManagerSrc.indexOf("verboseEnabled()");
check("runCreepLogic читает флаг verbose один раз", gateAt > 0);
const trackAt = roomManagerSrc.indexOf("trackRole(creep.memory.role");
check("замер идёт по creep.memory.role", trackAt > 0);
check("замер стоит ПОСЛЕ гейта (только verbose)", trackAt > gateAt);
check(
  "вернулись до замера в обычной ветке",
  /return;\s*\}\s*\n\s*\/\/ Подробный режим/.test(roomManagerSrc),
);

console.log("\n10. Профилирование по требованию: цена trackRole под гейтом");
// Замер shard3 29.09.2026 (scripts/profiling.measure.js, два прогона):
// один trackRole стоит 0.0007-0.0017 CPU, из них 30-65 % — два
// Game.cpu.getUsed() (0.000256-0.000310 за вызов). Поэтому при загрузке выше
// CPU.DETAIL_GATE_PCT (0.8 лимита) замер не делается ВООБЩЕ.
//
// Сигнал гейта — средний расход ПРОШЛОГО тика (g.average), а НЕ счётчик
// начала тика: startTick вызван первой строкой loop (empire.js:14), где
// getUsed() почти нулевой (docs/PROFILING-ON-DEMAND.md, раздел 4a).
delete global.Memory.cpuStats;
delete global.Memory.cpuMonitorVerbose;

function fresh() {
  delete global.__cpuMonitor;
}
let callbacks = 0;
function probeTick() {
  // Часы идут ВНУТРИ колбэка: замер — это разница, при неподвижных часах
  // он всегда 0, и проверка «запись появилась» ничего не говорила бы о нём.
  cpuMonitor.trackRole("probe", () => {
    callbacks++;
    cpuNow += 0.4;
  });
}

/** Тик, задающий сигнал: endTick кладёт его в g.average. */
function signalTick(time, used) {
  global.Game.time = time;
  cpuNow = 0;
  cpuMonitor.startTick();
  cpuNow = used;
  cpuMonitor.endTick();
}

console.log("\n10.1 Загрузка ниже порога — разбивка собирается");
fresh();
signalTick(1, 1.0); // средний расход прошлого тика = 1.0 из 20
// Сигнальный тик тоже профилируется (гейт видит average = 0), поэтому
// считаем ПРИРАЩЕНИЕ счётчика, а не абсолют.
const profiledBefore = cpuMonitor.snapshot().profiledTicks;
global.Game.time = 2;
cpuNow = 0;
cpuMonitor.startTick();
check("subsystemsEnabled() === true", cpuMonitor.subsystemsEnabled() === true);
cpuNow = 0.4;
probeTick();
check("колбэк исполнен", callbacks === 1, String(callbacks));
check(
  "замер равен израсходованному внутри колбэка",
  Math.abs(cpuMonitor.snapshot().roleCPU.probe - 0.4) < 1e-9,
  String(cpuMonitor.snapshot().roleCPU.probe),
);
cpuMonitor.endTick();
check(
  "профилированный тик прибавился",
  cpuMonitor.snapshot().profiledTicks === profiledBefore + 1,
  `${profiledBefore} -> ${cpuMonitor.snapshot().profiledTicks}`,
);

console.log("\n10.2 Загрузка выше порога — только грубый таймер тика");
fresh();
signalTick(1, global.Game.cpu.limit * CPU.DETAIL_GATE_PCT + 0.001);
const profiledBusy = cpuMonitor.snapshot().profiledTicks;
global.Game.time = 2;
cpuNow = 0; // счётчик ТЕКУЩЕГО тика специально нулевой: сигнал — прошлый тик
cpuMonitor.startTick();
check("subsystemsEnabled() === false", cpuMonitor.subsystemsEnabled() === false);
const probeBefore = callbacks;
cpuNow += 0.4; // колбэк обязан исполниться, но НЕ помериться
probeTick();
check("колбэк всё равно исполнен", callbacks === probeBefore + 1, String(callbacks));
check("записи роли нет", cpuMonitor.snapshot().roleCPU.probe === undefined);
cpuMonitor.endTick();
check(
  "профилированных тиков не прибавилось",
  cpuMonitor.snapshot().profiledTicks === profiledBusy,
  `${profiledBusy} -> ${cpuMonitor.snapshot().profiledTicks}`,
);

console.log("\n10.3 Неполный bucket выключает замер при низкой загрузке");
fresh();
signalTick(1, 1.0);
global.Game.cpu.bucket = 9999;
global.Game.time = 2;
cpuNow = 0;
cpuMonitor.startTick();
check("bucket 9999 — замера нет", cpuMonitor.subsystemsEnabled() === false);
cpuMonitor.endTick();
global.Game.cpu.bucket = 10000;

console.log("\n10.4 Отчёт: прошлый срез вместо заниженного, крипы не читаются");
// Ситуация: в окне не было НИ ОДНОГО подробного тика (профилирование по
// требованию выключено), но в Memory лежит срез прошлого окна. Делить сумму
// не на что, поэтому отчёт обязан отдать прошлый срез и не считать крипов.
// Срез кладём вручную: боевой бот пишет его тем же кодом в тик отчёта.
fresh();
global.Game.time = CPU.REPORT_INTERVAL;
delete global.Memory.cpuStats;
cpuNow = 0;
cpuMonitor.startTick();
cpuNow = global.Game.cpu.limit * CPU.DETAIL_GATE_PCT + 0.001;
cpuMonitor.endTick(); // среднее стало 16.001 (лимит 20)

// Следующий (отчётный) тик видит это среднее → гейт закрыт.
global.Memory.cpuStats = { subsystems: { towers: 0.5 }, creeps: 26 };
creepScans = 0;
global.Game.time = CPU.REPORT_INTERVAL * 2;
cpuNow = 0;
cpuMonitor.startTick();
check("гейт закрыт по среднему прошлого тика", cpuMonitor.subsystemsEnabled() === false);
cpuMonitor.endTick();
check(
  "subsystems — прошлый срез, а не пересчёт",
  global.Memory.cpuStats.subsystems.towers === 0.5,
  JSON.stringify(global.Memory.cpuStats.subsystems),
);
check("creeps = 0 (перепись не делалась)", global.Memory.cpuStats.creeps === 0, String(global.Memory.cpuStats.creeps));
check("Game.creeps не читался", creepScans === 0, String(creepScans));
check("bucket записан", global.Memory.cpuStats.bucket === 10000, String(global.Memory.cpuStats.bucket));

console.log("\n10.5 Отчёт: знаменатель — число профилированных тиков, не окно");
// Тик 9 профилирован, тик 10 профилирован (гейт открыт: среднее 1.0 из 20),
// поэтому знаменатель 2, а не REPORT_INTERVAL = 10.
fresh();
signalTick(CPU.REPORT_INTERVAL - 1, 1.0);
global.Game.time = CPU.REPORT_INTERVAL;
delete global.Memory.cpuStats;
cpuNow = 0;
cpuMonitor.startTick();
cpuNow = 0.5;
probeTick(); // внутри колбэка часы уходят на 0.9
cpuMonitor.endTick();
check(
  "subsystems = сумма / профилированные тики окна (2), а не / 10",
  Math.abs(global.Memory.cpuStats.subsystems.probe - 0.2) < 1e-9,
  JSON.stringify(global.Memory.cpuStats.subsystems),
);

console.log("\n10.6 Автозамер крипов при полном bucket");
fresh();
// первый startTick убавляет счётчик (97 -> 96), поэтому срабатывание на 96-м
global.Game.time = 0;
cpuNow = 0;
cpuMonitor.startTick();
check(
  "счётчик убыл на первом же тике (период отсчитывается от него)",
  cpuMonitor.snapshot().verboseIn === CPU.VERBOSE_INTERVAL - 1,
  String(cpuMonitor.snapshot().verboseIn),
);
check("на первом тике автозамера нет", cpuMonitor.verboseEnabled() === false);
cpuMonitor.endTick();

let verboseTicks = [];
for (let t = 1; t <= CPU.VERBOSE_INTERVAL + 5; t++) {
  global.Game.time = t;
  cpuNow = 0;
  cpuMonitor.startTick();
  if (cpuMonitor.verboseEnabled()) verboseTicks.push(t);
  cpuMonitor.endTick();
}
check(
  "за VERBOSE_INTERVAL тиков автозамер сработал ровно один раз",
  verboseTicks.length === 1,
  JSON.stringify(verboseTicks),
);
check(
  "и сработал он примерно через период, а не на первом тике",
  verboseTicks.length === 1 && verboseTicks[0] >= CPU.VERBOSE_INTERVAL - 2,
  JSON.stringify(verboseTicks),
);

// Второй период подряд: счётчик обязан взвестись заново, а не сработать снова.
fresh();
let secondTick = -1;
for (let t = 0; t <= CPU.VERBOSE_INTERVAL + 2; t++) {
  global.Game.time = t;
  cpuNow = 0;
  cpuMonitor.startTick();
  if (cpuMonitor.verboseEnabled()) {
    secondTick = t;
    cpuMonitor.endTick();
    break;
  }
  cpuMonitor.endTick();
}
check(
  "период повторяется: следующий автозамер через VERBOSE_INTERVAL тиков",
  secondTick === CPU.VERBOSE_INTERVAL - 1,
  String(secondTick),
);

console.log("\n10.7 Автозамер запрещён: неполный bucket или ручной false");
fresh();
global.Game.time = CPU.VERBOSE_INTERVAL - 1; // ровно тик, когда автозамер был бы должен
global.Game.cpu.bucket = 9999;
cpuNow = 0;
cpuMonitor.startTick();
check("bucket 9999 — автозамера нет", cpuMonitor.verboseEnabled() === false);
cpuMonitor.endTick();

fresh();
global.Game.cpu.bucket = 10000;
global.Game.time = CPU.VERBOSE_INTERVAL - 1;
global.Memory.cpuMonitorVerbose = false;
cpuNow = 0;
cpuMonitor.startTick();
check("ручной false запрещает автозамер", cpuMonitor.verboseEnabled() === false);
cpuMonitor.endTick();

console.log("\n10.8 Ручной флаг и гейт: подчиняется, когда гейт закрыт");
fresh();
signalTick(1, global.Game.cpu.limit * CPU.DETAIL_GATE_PCT + 0.001);
global.Memory.cpuMonitorVerbose = true;
global.Game.time = 2;
cpuNow = 0;
cpuMonitor.startTick();
// Правило: поролевой замер крипов идёт в том же проходе, что и разбивка по
// подсистемам (runCreepLogic вызывает обе ветки в одной функции), поэтому
// закрытый гейт выключает и ручной verbose — иначе roleCPU смешал бы замеры
// крипов с незамеренными подсистемами.
check("подсистемы не мерятся", cpuMonitor.subsystemsEnabled() === false);
check("и ручной verbose тоже выключен", cpuMonitor.verboseEnabled() === false);
cpuNow = 0.7;
cpuMonitor.endTick();

console.log("\n10.9 Ручной флаг работает, когда гейт открыт");
fresh();
signalTick(1, 1.0);
global.Game.time = 2;
cpuNow = 0;
cpuMonitor.startTick();
check("гейт открыт", cpuMonitor.subsystemsEnabled() === true);
check("ручной verbose включён вне расписания автозамера", cpuMonitor.verboseEnabled() === true);
cpuMonitor.endTick();
delete global.Memory.cpuMonitorVerbose;

console.log("\n11. Гейт виден в срезе и в исходнике");
const finalSrc = fs.readFileSync(path.join(__dirname, "..", "cpuMonitor.js"), "utf8");
check(
  "решение принимается в startTick по среднему прошлого тика",
  /avg <= Game\.cpu\.limit \* CPU\.DETAIL_GATE_PCT && bucket === CPU\.FULL_BUCKET/.test(finalSrc),
);
check(
  "без замера колбэк исполняется напрямую",
  /if \(!g\.enabled \|\| !g\.detail\) \{\s*\n\s*callback\(\);/.test(finalSrc),
);
check(
  "знаменатель отчёта — profiledTicks",
  /g\.roleStats\[role\]\.sum \/ profiled/.test(finalSrc),
);
check(
  "порог 0.8 лимита (= 16 CPU при лимите 20) и период 97 живут в constants.js",
  CPU.DETAIL_GATE_PCT === 0.8 && CPU.VERBOSE_INTERVAL === 97,
  `DETAIL_GATE_PCT=${CPU.DETAIL_GATE_PCT}, VERBOSE_INTERVAL=${CPU.VERBOSE_INTERVAL}`,
);

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL, ${passed + failed} всего`);
process.exit(failed === 0 ? 0 : 1);
