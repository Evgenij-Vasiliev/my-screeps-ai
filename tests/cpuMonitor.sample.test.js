"use strict";
/**
 * ===================================================
 * CPUMONITOR.SAMPLE.TEST.JS — стоимость инструментации CPU
 * ===================================================
 * История: trackRole вызывал Game.cpu.getUsed() на каждого крипа каждый тик
 * (~81 вызов/тик на живом shard3 = ~0.034 CPU/тик), Memory.cpuStats писалась
 * каждый тик (Memory «пачкалась» → полная сериализация), а тиковый отчёт печатал
 * 8 строк консоли каждые 10 тиков.
 *
 * Правка v1: замер идёт один тик из CPU.SAMPLE_INTERVAL (7), тиковый CPU копится
 * в heap и переносится в Memory раз в CPU.REPORT_INTERVAL тиков, отчёт — одна
 * строка. Профиль не удалён: средние считаются по числу замерных тиков.
 *
 * Правка v2 (аудит п. 9, дорожная карта задача 6): ролевой замер стал opt-in —
 * `Memory.cpuMonitorRoles` (по умолчанию выключено), вывод по ролям — раз в
 * CPU.ROLE_REPORT_INTERVAL (50) тиков отдельной строкой, роли больше не лежат
 * в Memory.cpuStats.profile.blocks (там только подсистемы и комнаты), а в
 * Memory.cpuStats.roles. Подсистемы (roomManager/roomState/towers/…) при этом
 * замеряются всегда: классификация — по имени бакета (isSubsystemBlock).
 *
 * Проверяем:
 *   1) замерный тик: trackRole роли делает 2 × getUsed и копит бакет роли;
 *   2) незамерный тик: trackRole не трогает Game.cpu.getUsed (0 обращений),
 *      возвращает результат callback;
 *   3) Memory.cpuStats (total/count/average) пишется раз в REPORT_INTERVAL,
 *      тиковый отчёт — одна строка;
 *   4) роли ВЫКЛЮЧЕНЫ по умолчанию: ролевой бакет не измеряется (0 getUsed),
 *      callback выполняется, подсистемы продолжают замеряться, в
 *      Memory.cpuStats.profile ролей нет;
 *   5) роли ВКЛЮЧЕНЫ (Memory.cpuMonitorRoles = true): рабочее окно ролей
 *      показывает средний CPU за замерный тик, отчёт печатается не чаще
 *      CPU.ROLE_REPORT_INTERVAL и переносится в Memory.cpuStats.roles;
 *   6) сводка подсистем (reportProfile) не печатает роли;
 *   7) окно профиля считает ТОЛЬКО замерные тики (средние не занижаются);
 *   8) Memory.cpuMonitorEnabled === false — замеров нет вовсе.
 *
 * Запуск: node tests/cpuMonitor.sample.test.js
 */

// ── Заглушка движка: CPU растёт только от явной «работы» ────────────────
let getUsedCalls = 0;
let cpuClock = 0;
const logged = [];

/** «Работа» внутри измеряемого блока. */
function work(amount) {
  cpuClock += amount;
}

global.Game = {
  time: 1000,
  creeps: {},
  cpu: {
    getUsed: () => {
      getUsedCalls++;
      return cpuClock;
    },
    bucket: 9000,
  },
};

global.Memory = {};

const origLog = console.log;
console.log = (...args) => {
  logged.push(args.join(" "));
};

const cpuMonitor = require("../cpuMonitor");
const { CPU } = require("../constants");

const SAMPLE = Math.max(1, CPU.SAMPLE_INTERVAL || 1);
const REPORT = CPU.REPORT_INTERVAL;
const PROFILE_REPORT = CPU.PROFILE_REPORT_INTERVAL;
const ROLE_REPORT = Math.max(1, CPU.ROLE_REPORT_INTERVAL || 50);

let passed = 0;
let failed = 0;
function check(label, cond, extra) {
  if (cond) {
    passed++;
    origLog(`  PASS  ${label}`);
  } else {
    failed++;
    origLog(`  FAIL  ${label}${extra !== undefined ? " :: " + extra : ""}`);
  }
}

/** Тик, на котором профиль сбрасывается в Memory и печатает сводку. */
function isProfileReportTick(t) {
  return CPU.PROFILE_ENABLED !== false && t % PROFILE_REPORT === 0;
}

/**
 * Есть ли на тике хоть какой-то автоматический вывод/сброс в Memory
 * (замер, тиковый отчёт, профиль или ролевой отчёт). Секции теста, которым
 * нужно «тихое» окно без сброса накопителей, стартуют с quietTick().
 */
function isReportTick(t) {
  return (
    t % REPORT === 0 ||
    isProfileReportTick(t) ||
    t % ROLE_REPORT === 0 ||
    t % SAMPLE === 0
  );
}

/** Тик, на котором нет ни замеров, ни отчётов — окна не сбрасываются. */
function quietTick(start) {
  let t = start;
  while (isReportTick(t)) t++;
  return t;
}

/**
 * Тик, который одновременно замерный (кратен SAMPLE) и «тихий» (не кратен
 * интервалам отчётов): только на нём наполняется окно профиля, которое потом
 * можно сбросить в Memory вручную. Множества не пересекаются, поэтому цикл
 * всегда завершается.
 */
function quietSampleTick(start) {
  let t = start;
  while (
    t % SAMPLE !== 0 ||
    t % REPORT === 0 ||
    t % PROFILE_REPORT === 0 ||
    t % ROLE_REPORT === 0
  ) {
    t++;
  }
  return t;
}

/** Сброс heap-накопителей монитора между секциями. */
function resetMonitor() {
  cpuMonitor.profileWindow = undefined;
  cpuMonitor.roleWindow = undefined;
  cpuMonitor.windowTotal = 0;
  cpuMonitor.windowCount = 0;
  cpuMonitor.roleCPU = {};
}

// ── 1-2. Замерный и незамерный тики (роли включены явно) ────────────────
{
  origLog(`\n1. Замер идёт один тик из ${SAMPLE}`);
  global.Memory = { cpuMonitorRoles: true };
  resetMonitor();

  const sampled = SAMPLE * 3; // тик, кратный SAMPLE
  const plain = sampled + 1;

  Game.time = sampled;
  cpuClock = 10;
  cpuMonitor.startTick();
  getUsedCalls = 0;
  const marker = {};
  const result = cpuMonitor.trackRole("worker", () => {
    work(2);
    return marker;
  });
  check("роли включены флагом Memory.cpuMonitorRoles", cpuMonitor.roles === true);
  check("sampling выставлен на замерном тике", cpuMonitor.sampling === true);
  check("callback-результат возвращается как есть", result === marker);
  check("trackRole сделал 2 × getUsed", getUsedCalls === 2, String(getUsedCalls));
  check(
    "бакет роли измерил работу внутри блока",
    cpuMonitor.roleCPU.worker === 2,
    String(cpuMonitor.roleCPU.worker),
  );

  Game.time = plain;
  cpuMonitor.startTick();
  getUsedCalls = 0;
  const plainMarker = {};
  const plainResult = cpuMonitor.trackRole("worker", () => {
    work(5);
    return plainMarker;
  });
  check("sampling не выставлен на незамерном тике", cpuMonitor.sampling === false);
  check(
    "незамерный тик: trackRole не вызвал getUsed ни разу",
    getUsedCalls === 0,
    String(getUsedCalls),
  );
  check("результат callback тот же", plainResult === plainMarker);
  check(
    "roleCPU пуст (замеров нет)",
    Object.keys(cpuMonitor.roleCPU).length === 0,
    JSON.stringify(cpuMonitor.roleCPU),
  );
}

// ── 3. Memory и консоль: реже и одной строкой ───────────────────────────
{
  origLog("\n3. Memory.cpuStats пишется раз в REPORT_INTERVAL, отчёт — одна строка");
  global.Memory = {};
  resetMonitor();

  // Окно отчёта, в котором нет тика профиля (кратного PROFILE_REPORT_INTERVAL).
  let start = 1401;
  while (isProfileReportTick(start + REPORT - 1)) start++;

  let reportLines = 0;
  let statsCreatedEarly = 0;
  for (let i = 0; i < REPORT; i++) {
    const t = start + i;
    Game.time = t;
    logged.length = 0;
    cpuMonitor.startTick();
    cpuMonitor.trackRole("towers", () => work(1));
    cpuMonitor.endTick();
    reportLines += logged.length;
    if (i < REPORT - 1 && Memory.cpuStats !== undefined) statsCreatedEarly++;
  }

  check(
    "Memory.cpuStats не создан ни на одном тике вне REPORT_INTERVAL",
    statsCreatedEarly === 0,
    String(statsCreatedEarly),
  );
  check(
    "Memory.cpuStats появился только на REPORT_INTERVAL",
    !!Memory.cpuStats && Memory.cpuStats.count === REPORT,
    JSON.stringify(Memory.cpuStats),
  );
  check(
    "average = сумма/число тиков",
    !!Memory.cpuStats &&
      Math.abs(Memory.cpuStats.average - Memory.cpuStats.total / REPORT) < 1e-9,
    JSON.stringify(Memory.cpuStats),
  );
  check(
    "тиковый отчёт — одна строка console.log",
    reportLines === 1,
    String(reportLines),
  );
  check(
    "роли выключены: Memory.cpuStats.roles не создан, даже когда подсистемы замерены",
    Memory.cpuStats.roles === undefined && Memory.cpuStats.profile === undefined,
    JSON.stringify(Memory.cpuStats),
  );
}

// ── 4. Роли выключены (значение по умолчанию) ───────────────────────────
{
  origLog("\n4. Роли выключены: 0 × getUsed на ролевой бакет, подсистемы живы");
  global.Memory = {};
  resetMonitor();

  // Тик заведомо замерный (кратен SAMPLE) и «тихий» (не кратен 10/50/100),
  // иначе окно профиля не создаётся/сбрасывается прямо в этом тике.
  const t = SAMPLE * 1000;
  Game.time = t;
  cpuClock = 10;
  cpuMonitor.startTick();
  check(
    "по умолчанию роли выключены (CPU.ROLE_ENABLED === false)",
    cpuMonitor.roles === false,
    String(cpuMonitor.roles),
  );
  check("тик замерный — профиль подсистем копится", cpuMonitor.sampling === true);

  getUsedCalls = 0;
  const marker = {};
  const result = cpuMonitor.trackRole(
    "miner",
    () => {
      work(3);
      return marker;
    },
    true,
  );
  check("ролевой callback всё равно выполнен", result === marker);
  check(
    "ролевой бакет не измерил работу: 0 × getUsed",
    getUsedCalls === 0,
    String(getUsedCalls),
  );
  check(
    "роль не попала в roleCPU",
    cpuMonitor.roleCPU.miner === undefined,
    JSON.stringify(cpuMonitor.roleCPU),
  );

  // Подсистемы при выключенных ролях продолжают замеряться (классификация
  // по имени бакета), и в профиль идут и блоки, и комнаты.
  const measured = cpuMonitor.trackRole("towers", () => work(4));
  check("подсистема замеряется и при выключенных ролях", measured === undefined);
  check(
    "бакет towers попал в roleCPU",
    cpuMonitor.roleCPU.towers === 4,
    JSON.stringify(cpuMonitor.roleCPU),
  );
  cpuMonitor.trackRole(`room:E35S37`, () => work(1));
  cpuMonitor.trackRole("miner", () => work(9), true);

  const roleNames = cpuMonitor.accumulateProfile();
  check(
    "в окно профиля роли не попадают",
    roleNames.indexOf("miner") === -1,
    JSON.stringify(roleNames),
  );
  check(
    "в blocks только подсистема, в rooms — комната",
    cpuMonitor.profileWindow.blocks.towers !== undefined &&
      cpuMonitor.profileWindow.blocks.miner === undefined &&
      cpuMonitor.profileWindow.rooms.E35S37 !== undefined,
    JSON.stringify(cpuMonitor.profileWindow),
  );

  cpuMonitor.accumulateRoles(roleNames);
  check(
    "при выключенных ролях ролевое окно не создаётся",
    cpuMonitor.roleWindow === undefined,
    JSON.stringify(cpuMonitor.roleWindow),
  );
  cpuMonitor.endTick();
}

// ── 5. Роли включены: окно, перенос в Memory, отчёт раз в ROLE_REPORT ───
{
  origLog(
    `\n5. Роли включены: окно ролей и отчёт раз в ${ROLE_REPORT} тиков`,
  );
  global.Memory = { cpuMonitorRoles: true };
  resetMonitor();

  const start = quietTick(3000);
  let sampledTicks = 0;
  let reportLines = 0;

  for (let i = 0; i < ROLE_REPORT; i++) {
    const t = start + i;
    Game.time = t;
    cpuClock = 0;
    logged.length = 0;
    if (t % SAMPLE === 0) sampledTicks++;
    cpuMonitor.startTick();
    cpuMonitor.trackRole(
      "miner",
      () => {
        work(2);
      },
      true,
    );
    cpuMonitor.trackRole(
      "labWorker",
      () => {
        work(1);
      },
      true,
    );
    cpuMonitor.trackRole("towers", () => work(3));
    cpuMonitor.endTick();
    reportLines += logged.filter(l => l.indexOf("=== CPU ROLES") === 0).length;
  }

  // Окно сбрасывается на последнем тике периода; чтобы увидеть накопленное,
  // считаем ожидания от того же окна в Memory.
  const roles = Memory.cpuStats.roles;
  check(
    "окно ролей перенесено в Memory.cpuStats.roles",
    !!roles && roles.samples === sampledTicks,
    JSON.stringify(roles && roles.samples),
  );
  check(
    "средний CPU роли не занижен (2 на замерный тик)",
    !!roles && roles.roles.miner && roles.roles.miner.sum / roles.samples === 2,
    JSON.stringify(roles && roles.roles.miner),
  );
  check(
    "вторая роль тоже в окне",
    !!roles && !!roles.roles.labWorker && roles.roles.labWorker.sum > 0,
    JSON.stringify(roles && roles.roles),
  );
  check(
    "подсистемы в ролевое окно не попали",
    !!roles && roles.roles.towers === undefined,
    JSON.stringify(roles && roles.roles),
  );
  check(
    `ролевой отчёт напечатан один раз за ${ROLE_REPORT} тиков`,
    reportLines === 1,
    String(reportLines),
  );
  check(
    "profile.blocks ролей не содержит — они в отдельном окне",
    !Memory.cpuStats.profile ||
      (Memory.cpuStats.profile.blocks.miner === undefined &&
        Memory.cpuStats.profile.blocks.labWorker === undefined),
    JSON.stringify(Memory.cpuStats.profile && Memory.cpuStats.profile.blocks),
  );

  // Ручной вызов отчёта (как из консоли игры) печатает ровно одну строку
  // и перечисляет роли + НЕ перечисляет подсистемы.
  logged.length = 0;
  cpuMonitor.reportRoles();
  check(
    "reportRoles печатает одну строку",
    logged.length === 1,
    String(logged.length),
  );
  check(
    "в строке ролей есть miner/labWorker и нет towers",
    logged.length === 1 &&
      logged[0].indexOf("miner") !== -1 &&
      logged[0].indexOf("labWorker") !== -1 &&
      logged[0].indexOf("towers") === -1,
    logged.join(" | "),
  );

  // Своё окно: ролевой отчёт не сбрасывает профильное.
  check(
    "сброс ролей не тронул окно профиля подсистем",
    !!cpuMonitor.profileWindow && cpuMonitor.profileWindow.samples > 0,
    JSON.stringify(cpuMonitor.profileWindow && cpuMonitor.profileWindow.samples),
  );
}

// ── 6. Сводка подсистем ролей не печатает ───────────────────────────────
{
  origLog("\n6. reportProfile печатает подсистемы и комнаты, но не роли");
  global.Memory = { cpuMonitorRoles: true };
  resetMonitor();

  const t = quietSampleTick(4000);
  Game.time = t;
  cpuClock = 0;
  cpuMonitor.startTick();
  check(
    "тик замерный и тихий (окно профиля не сброшено endTick'ом)",
    cpuMonitor.sampling === true && !!Memory.cpuStats === false,
    `sampling=${cpuMonitor.sampling} cpuStats=${JSON.stringify(Memory.cpuStats)}`,
  );
  cpuMonitor.trackRole("roomState", () => work(2));
  cpuMonitor.trackRole("room:E35S37", () => work(1));
  cpuMonitor.trackRole(
    "miner",
    () => {
      work(4);
    },
    true,
  );
  const roleNames = cpuMonitor.accumulateProfile();
  cpuMonitor.accumulateRoles(roleNames);
  cpuMonitor.trackRole("towers", () => work(1));
  cpuMonitor.endTick();

  cpuMonitor.flushProfile();
  logged.length = 0;
  cpuMonitor.reportProfile();
  check(
    "сводка профиля печатается одной строкой",
    logged.length === 1,
    String(logged.length),
  );
  check(
    "в сводке есть roomState и комнаты",
    logged.length === 1 &&
      logged[0].indexOf("roomState") !== -1 &&
      logged[0].indexOf("E35S37") !== -1,
    logged.join(" | "),
  );
  check(
    "ролей в сводке профиля нет",
    logged.length === 1 && logged[0].indexOf("miner") === -1,
    logged.join(" | "),
  );
}

// ── 7. Профиль считает только замерные тики ─────────────────────────────
{
  origLog("\n7. Окно профиля: samples = число ЗАМЕРНЫХ тиков");
  global.Memory = {};
  resetMonitor();

  const ticks = 3 * SAMPLE;
  let sampledTicks = 0;
  const start = quietTick(SAMPLE * 10);
  for (let i = 0; i < ticks; i++) {
    const t = start + i;
    Game.time = t;
    cpuClock = 0;
    if (t % SAMPLE === 0) sampledTicks++;
    cpuMonitor.startTick();
    cpuMonitor.trackRole("roomState", () => work(2));
    cpuMonitor.trackRole("room:E35S37", () => work(1));
    cpuMonitor.endTick();
  }

  cpuMonitor.flushProfile();
  const profile = Memory.cpuStats.profile;
  check(
    `замерных тиков ${sampledTicks} из ${ticks} — столько же samples`,
    !!profile && profile.samples === sampledTicks,
    JSON.stringify(profile && profile.samples),
  );
  check(
    "средние по блокам считаются от замерных тиков (не занижены)",
    !!profile && profile.blocks.roomState.sum / profile.samples === 2,
    JSON.stringify(profile && profile.blocks.roomState),
  );
  check(
    "комнаты по-прежнему разложены отдельно",
    !!profile && !!profile.rooms.E35S37 && profile.rooms.E35S37.sum > 0,
    JSON.stringify(profile && profile.rooms),
  );
}

// ── 8. Полное отключение мониторинга ────────────────────────────────────
{
  origLog("\n8. Memory.cpuMonitorEnabled = false — замеров нет вовсе");
  global.Memory = { cpuMonitorEnabled: false, cpuMonitorRoles: true };
  resetMonitor();

  Game.time = SAMPLE * 20;
  getUsedCalls = 0;
  cpuMonitor.startTick();
  const marker = {};
  const result = cpuMonitor.trackRole("worker", () => {
    work(9);
    return marker;
  });
  cpuMonitor.endTick();
  check("trackRole не мерил", getUsedCalls === 0, String(getUsedCalls));
  check("результат callback тот же", result === marker);
  check(
    "Memory.cpuStats не создан",
    Memory.cpuStats === undefined,
    JSON.stringify(Memory.cpuStats),
  );
}

console.log = origLog;

// ── Итог ─────────────────────────────────────────────────────────────────
console.log(`\nПРОЙДЕНО: ${passed}, ПРОВАЛЕНО: ${failed}`);
if (failed > 0) {
  console.log("ЕСТЬ ПРОВАЛЫ");
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ");
