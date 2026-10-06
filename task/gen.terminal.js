// ===================================================
// TASK/gen.terminal.js — генераторы терминала: энергия и отправка ресурсов
// ===================================================
// Часть разбиения task.generators.js (686 строк, 04.10.2026): 11 генераторов
// разложены по семействам целей. Наружу их по-прежнему отдаёт фасад
// task.generators.js (его зовёт room/run.js:103-176) — имена экспортов и их
// порядок не изменились, тела функций перенесены строка-в-строку.
//
// Две категории TASK_CHAIN на одну структуру: запас энергии и вывоз ресурсов.
//
// require("../constants") — баррель констант из корня: при выгрузке deploy
// переводит путь в "constants" (scripts/deploy.modules.js, translateModuleSource),
// потому что движок Screeps относительных путей не умеет.
// ===================================================
const taskManager = require("task.manager");
const econ = require("econ");
const systems = require("systems");

const FIELDS_FILLTERMINALENERGY = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillTerminalEnergyTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTerminalEnergy", candidate, FIELDS_FILLTERMINALENERGY);
}

function generateFillTerminalEnergy(roomState) {
  const { storage, terminal, roomName } = roomState;

  // Условие одно на генератор и исполнителя — econ.canFillTerminal
  // (econ.js). Раньше здесь стоял гейт «склад выше
  // STORAGE.ENERGY_MIN x STORAGE_RESERVE_MULTIPLIER = 195 000», а терминал
  // считался полным на ENERGY_TARGET = 150 000. Живой замер показал, что это
  // сочетание НЕ ДОСТИЖИМО и терминалы стоят на 98-113k:
  //   node /tmp/probe.econ.js shard3, tick 83449927 —
  //   склады 189 637/196 153/193 286/194 243/192 526,
  //   терминалы 99 893/98 648/112 993/98 279/98 141.
  // Склад живёт ровно у 195 000 (тот же множитель 1.3 задаёт и его резерв),
  // поэтому условие `> 195 000` выполнялось лишь мгновениями, и за 156 тиков
  // тренда (tick 83450172 -> 83450328) в очереди не было НИ ОДНОЙ задачи
  // fillTerminalEnergy. Теперь перенос разрешён из свободных средств склада
  // (выше растущего пола), а цель терминала — его доля в общем запасе
  // (ECON.TERMINAL_SHARE), то есть терминал растёт вместе со складом.
  if (!econ.canFillTerminal(storage, terminal, roomName)) {
    return;
  }

  const candidate = {
    type: "transfer",
    sourceId: storage.id,
    targetId: terminal.id,
    resourceType: RESOURCE_ENERGY,
  };

  if (isDuplicateFillTerminalEnergyTask(roomName, candidate)) {
    return;
  }

  taskManager.addTask(roomName, "fillTerminalEnergy", candidate);
}

// Поля, по которым задача считается дублем (задание 9 плана).
const FIELDS_FILLTERMINALRESOURCE = ["type", "sourceId", "targetId", "resourceType"];

function isDuplicateFillTerminalResourceTask(roomName, candidate) {
  return taskManager.hasDuplicate(roomName, "fillTerminalResources", candidate, FIELDS_FILLTERMINALRESOURCE);
}

function generateFillTerminalResources(roomState) {
  const { storage, terminal, roomName } = roomState;

  if (!storage || !terminal) {
    return;
  }

  // ── ЗАЯВКИ ТЕРМИНАЛЬНОЙ СЕТИ (Memory.rooms[room].terminalExports) ────────
  // Terminal.send списывает объём из terminal.store, поэтому ресурс, которого
  // в терминале нет, сеть отправить НЕ МОЖЕТ — заявка без воркера остаётся
  // в Memory и висит вечно. Порядок такой: terminalNetwork.addExport пишет
  // «ресурс → объём» на комнату-донора, а этот генератор превращает заявку в
  // задачу «привези resourceType из storage в terminal».
  //
  // ЕДИНЫЙ ТУМБЛЕР (правка 05.10.2026). До неё режим читался из
  // TASK_CONFIG.fillTerminalResources, а выключение системы — ещё и из
  // systems.js: два места правды на одну систему, причём решало более
  // строгое (TASK_CONFIG = false), из-за чего пять генераторов (фабрика,
  // powerSpawn x2, вывоз батарей) считались включёнными в systems.js, но не
  // вызывались. Теперь источник один — systems.js, значение читается ОДИН раз
  // на комнату (одна переменная, а не три чтения в горячем пути).
  //
  // false (значение по умолчанию) — грузятся ТОЛЬКО заявки сети.
  // true — прежнее поведение: лить в терминал всё, чего меньше
  // RESOURCE_TERMINAL_MAX. Живой замер tick ~83451500: терминалы заняты на
  // ~250 000 из 300 000 (энергия ~100k + ресурсы ~145k), поэтому включение
  // этого режима залило бы остаток места под завязку — оставлено false.
  const flood = systems.fillTerminalResources !== false;

  const exports =
    (Memory.rooms &&
      Memory.rooms[roomName] &&
      Memory.rooms[roomName].terminalExports) ||
    {};
  const exportTypes = Object.keys(exports);

  if (!flood && exportTypes.length === 0) {
    return;
  }

  const RESOURCE_TERMINAL_MAX = 10000;

  // Цель терминала — максимум из базового лимита (при включённом режиме) и
  // заявки сети. Заявка НЕ должна опускать цель ниже базовой: иначе излишек,
  // который ждёт рынок, не доехал бы ни до сети, ни до продажи.
  const baseCap = flood ? RESOURCE_TERMINAL_MAX : 0;
  const resourceTypes = flood ? Object.keys(storage.store) : exportTypes;

  for (let i = 0; i < resourceTypes.length; i++) {
    const resourceType = resourceTypes[i];
    if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) {
      continue;
    }

    if ((storage.store[resourceType] || 0) === 0) {
      continue;
    }

    // cap === 0 бывает только в режиме заявок: ресурс есть в storage, но сеть
    // его не просила — в терминал он не едет (этим и управляет флаг).
    const cap = Math.max(baseCap, exports[resourceType] || 0);
    if (cap === 0) {
      continue;
    }

    const currentInTerminal = terminal.store[resourceType] || 0;
    if (currentInTerminal >= cap) {
      continue;
    }

    const candidate = {
      type: "transfer",
      sourceId: storage.id,
      targetId: terminal.id,
      resourceType,
    };

    if (isDuplicateFillTerminalResourceTask(roomName, candidate)) {
      continue;
    }

    taskManager.addTask(roomName, "fillTerminalResources", candidate);
  }
}

// Поля, по которым задача считается дублем (задание 9 плана).

module.exports = {
  generateFillTerminalEnergy,
  generateFillTerminalResources,
};
