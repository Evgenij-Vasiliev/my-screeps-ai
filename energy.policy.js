/**
 * ЭНЕРГЕТИЧЕСКАЯ ПОЛИТИКА КОМНАТЫ.
 *
 * Одна общая ступень (номер полосы) на комнату. Ступень растёт, когда энергии
 * в хранилище хватает на следующую полосу, и падает, когда энергии стало
 * меньше «порог полосы − HYSTERESIS». Пересчёт — не чаще EVAL_EVERY тиков и не
 * больше одной ступени за раз: поэтому у порога ничего не мигает.
 *
 * Пороги и зазоры — ТОЛЬКО в constants.js (ENERGY_POLICY). Здесь — имена полос
 * и арифметика ступени. Модуль не знает о game-объектах, кроме room.name /
 * room.storage: проверяется офлайн, как loadShed.
 *
 * Управление из консоли не предусмотрено: выключатели — в systems.js,
 * пороги — в constants.js.
 */
const {
  ENERGY_POLICY,
  TASK_ENERGY_LIMITS,
  STORAGE,
  FACTORY,
} = require("./constants");
const systems = require("./systems");

const BANDS = ENERGY_POLICY.BANDS;
const { HYSTERESIS, OFF_FLOOR, EVAL_EVERY } = ENERGY_POLICY;

const INDEX = {};
for (let i = 0; i < BANDS.length; i++) INDEX[BANDS[i].name] = i + 1;

function state(room) {
  if (!Memory.rooms) Memory.rooms = {};
  const mem = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});
  if (!mem.energyBand || typeof mem.energyBand.band !== "number") {
    mem.energyBand = { band: 0, tick: 0 };
  }
  return mem.energyBand;
}

function energyOf(room) {
  if (!room.storage) return 0;
  return room.storage.store[RESOURCE_ENERGY] || 0;
}

/** Остаток контракта задачи: reserve минус уже снятое этой задачей. */
function remainingReserve(task) {
  if (!task || typeof task.reserve !== "number") return 0;
  const spent =
    typeof task.energyTaken === "number" ? task.energyTaken : 0;
  return Math.max(0, task.reserve - spent);
}

/**
 * Сумма резервов задач, уже назначенных живым крипам.
 *
 * Считается из очередей, а не из инкрементального счётчика: завершённые
 * (`null`-надгробия), освобождённые, просроченные задачи и задачи мёртвых
 * крипов не учитываются автоматически. Никаких записей в Memory.
 *
 * @param {Object} room
 * @returns {number}
 */
function reserved(room) {
  if (!room || !room.name || !Memory.rooms) return 0;
  const mem = Memory.rooms[room.name];
  const tasks = mem && mem.tasks;
  if (!tasks) return 0;

  const creeps = Game.creeps || {};
  let sum = 0;

  // Memory.rooms[].tasks содержит только очереди TASK_CHAIN; обход по ключам
  // не тянет task.manager в energy.policy (иначе офлайн-тесты политики
  // требуют глобального резолва модулей).
  for (const type in tasks) {
    const queue = tasks[type];
    if (!Array.isArray(queue)) continue;

    for (let j = 0; j < queue.length; j++) {
      const task = queue[j];
      if (!task || !task.reservedBy) continue;
      if (task.expiresAt && task.expiresAt <= Game.time) continue;
      if (!creeps[task.reservedBy]) continue;
      const remaining = remainingReserve(task);
      if (remaining <= 0) continue;
      sum += remaining;
    }
  }

  return sum;
}

/** Свободная энергия сверх резерва комнаты и уже назначенных задач. */
function free(room) {
  if (!room || !room.storage) return 0;
  return (
    energyOf(room) -
    STORAGE.ENERGY_MIN -
    STORAGE.DEFENSE_RESERVE -
    reserved(room)
  );
}

/**
 * Может ли задача `task` зарезервировать свою энергию в комнате `room`.
 * При reserve <= 0 — всегда true: старые задачи не меняют поведение.
 *
 * @param {Object} room
 * @param {Object} task
 * @returns {boolean}
 */
function canReserve(room, task) {
  const reserve = remainingReserve(task);
  if (reserve <= 0) return true;
  if (!room || !room.storage) return false;
  return free(room) >= reserve;
}

/** Суммарный запас батареек империи: склады + терминалы своих комнат. */
function batteryStock() {
  const rooms = Game.rooms || {};
  let sum = 0;
  for (const name in rooms) {
    const room = rooms[name];
    if (!room || !room.controller || !room.controller.my) continue;
    if (room.storage) {
      sum += room.storage.store[RESOURCE_BATTERY] || 0;
    }
    if (room.terminal) {
      sum += room.terminal.store[RESOURCE_BATTERY] || 0;
    }
  }
  return sum;
}

/**
 * Разрешено ли фабрике комнаты производство партии.
 *
 * Условия этапа 3:
 *   - суммарный запас батареек ниже FACTORY.STOCK_TARGET;
 *   - склад не ниже FACTORY.MIN_STORAGE;
 *   - свободный бюджет после резерва/задач не ниже FACTORY.MIN_FREE;
 *   - с прошлой партии прошло не менее FACTORY.INTERVAL тиков.
 * Готовность самой фабрики (600 энергии, кулдаун, место под 50 батарей)
 * проверяет factory.manager: политика не должна блокировать подвоз.
 */
function factoryAllowed(room) {
  if (!room || !room.storage) return false;
  if (batteryStock() >= FACTORY.STOCK_TARGET) return false;
  if (energyOf(room) < FACTORY.MIN_STORAGE) return false;
  if (free(room) < FACTORY.MIN_FREE) return false;

  const mem = Memory.rooms && Memory.rooms[room.name];
  if (mem && mem.factoryNextBatchAt && Game.time < mem.factoryNextBatchAt) {
    return false;
  }
  return true;
}

/** Текущая ступень комнаты (0 — только ядро). Обновляется раз в EVAL_EVERY тиков. */
function band(room) {
  const st = state(room);
  if (Game.time - st.tick < EVAL_EVERY) return st.band;
  st.tick = Game.time;

  const energy = energyOf(room);

  const up = BANDS[st.band];
  if (up && energy >= up.on) {
    st.band += 1;
    return st.band;
  }

  if (st.band > 0) {
    const down = Math.max(BANDS[st.band - 1].on - HYSTERESIS, OFF_FLOOR);
    if (energy < down) st.band -= 1;
  }
  return st.band;
}

// Старые имена подсистем (для policy-флагов systems.js). Лимит — у задачи,
// но выключатель подсистемы по-прежнему один на все её задачи.
const POLICY_KEY = {
  fillTowers: "towers",
  repairStructures: "repair",
  buildStructures: "build",
  upgradeController: "upgrade",
  labManager: "labs",
  boost: "boost",
  fillFactoryEnergy: "factory",
  fillPowerSpawnPower: "powerSpawn",
  fillPowerSpawnEnergy: "powerSpawn",
  powerSpawnManager: "powerSpawn",
  marketSell: "marketSell",
  marketBuy: "marketBuy",
};

function taskState(room) {
  if (!Memory.rooms) Memory.rooms = {};
  const mem = Memory.rooms[room.name] || (Memory.rooms[room.name] = {});
  return mem.taskEnergy || (mem.taskEnergy = {});
}

/**
 * Разрешена ли задача `name` в комнате `room`.
 * Для имён из TASK_ENERGY_LIMITS порог берётся у задачи; для старых имён
 * полос (towers/repair/...) — прежняя лестница (совместимость и диагностика).
 * Неизвестное имя — false (опечатка не должна включать лишнее).
 */
function allows(room, name) {
  const policyKey = POLICY_KEY[name];
  if (systems.policy && systems.policy[policyKey || name] === false) return false;

  if (Object.prototype.hasOwnProperty.call(TASK_ENERGY_LIMITS, name)) {
    const min = TASK_ENERGY_LIMITS[name];
    if (min <= 0) return true;
    const energy = energyOf(room);
    const st = taskState(room);
    let on = st[name];
    if (on === undefined) on = energy >= min;
    else if (energy >= min) on = true;
    else if (energy < Math.max(min - HYSTERESIS, OFF_FLOOR)) on = false;
    if (st[name] !== on) st[name] = on;
    return on;
  }

  const idx = INDEX[name];
  if (!idx) return false;
  return band(room) >= idx;
}

/** Диагностика: Memory.__econ = JSON.stringify(energyPolicy.status(Game.rooms["E36S38"])) */
function status(room) {
  const st = state(room);
  const energy = energyOf(room);
  const enabled = [];
  for (const b of BANDS) if (allows(room, b.name)) enabled.push(b.name);
  return { band: st.band, energy, enabled };
}

module.exports = {
  band,
  allows,
  reserved,
  free,
  canReserve,
  remainingReserve,
  batteryStock,
  factoryAllowed,
  status,
  BANDS,
  TASK_ENERGY_LIMITS,
};
