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
  BUDGET,
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

/** Номер расчётного периода. */
function budgetPeriod() {
  return Math.floor(Game.time / BUDGET.PERIOD_TICKS);
}

/** Расчётная добыча периода: источники * 3000 * (период/300). */
function periodIncome() {
  const rooms = Game.rooms || {};
  let sources = 0;
  for (const name in rooms) {
    const room = rooms[name];
    if (!room || !room.controller || !room.controller.my) continue;
    if (Array.isArray(room.sources)) {
      sources += room.sources.length;
    } else if (
      typeof room.find === "function" &&
      typeof FIND_SOURCES !== "undefined"
    ) {
      sources += room.find(FIND_SOURCES).length;
    }
  }
  return Math.floor(
    (sources * BUDGET.SOURCE_ENERGY * BUDGET.PERIOD_TICKS) / 300,
  );
}

/** Суммарная энергия Storage всех своих комнат. */
function storageEnergy() {
  const rooms = Game.rooms || {};
  let sum = 0;
  for (const name in rooms) {
    const room = rooms[name];
    if (!room || !room.controller || !room.controller.my) continue;
    if (room.storage && room.storage.store) {
      sum += room.storage.store[RESOURCE_ENERGY] || 0;
    }
  }
  return sum;
}

/** Дополнительный лимит фабрик при переполнении Storage. */
function factoryOverflow() {
  const cfg = BUDGET.OVERFLOW && BUDGET.OVERFLOW.FACTORY;
  if (!cfg) return 0;
  return storageEnergy() >= cfg.STORAGE_THRESHOLD
    ? cfg.EXTRA_PER_PERIOD
    : 0;
}

/**
 * Текущее состояние периодических бюджетов.
 * На границе периода лимиты пересчитываются из расчётной добычи; остаток
 * прошлого периода не переносится. Состояние — только числовые лимиты,
 * реальная энергия Storage не перемещается.
 */
function budgetState() {
  if (!Memory.energyBudget) Memory.energyBudget = null;
  const period = budgetPeriod();
  let state = Memory.energyBudget;

  if (
    !state ||
    state.period !== period ||
    state.version !== BUDGET.VERSION
  ) {
    const income = periodIncome();
    const overflowFactory = factoryOverflow();
    const limits = {};
    const remaining = {};
    const charged = {};
    for (const direction in BUDGET.SHARES) {
      const limit = Math.floor(
        (income * BUDGET.SHARES[direction]) / 10000,
      ) + (direction === "factory" ? overflowFactory : 0);
      limits[direction] = limit;
      // Новый период начинается с нуля: бюджет начисляется постепенно,
      // а не выдаётся залпом в начале 300-тикового окна.
      remaining[direction] = 0;
      charged[direction] = 0;
    }
    state = {
      version: BUDGET.VERSION,
      period,
      income,
      limits,
      remaining,
      charged,
      lastTick: Game.time,
      overflowFactory,
    };
    Memory.energyBudget = state;
  }

  // Token bucket: за каждый прошедший тик направлению начисляется
  // limit / PERIOD_TICKS. Сверху — не больше периодного лимита; между
  // периодами остаток не переносится. Задача по-прежнему списывает полную
  // стоимость, поэтому дробить штатные задачи не нужно.
  const elapsed = Math.max(0, Game.time - (state.lastTick || 0));
  if (elapsed > 0) {
    for (const direction in state.limits) {
      const cap = state.limits[direction];
      const add = (cap * elapsed) / BUDGET.PERIOD_TICKS;
      state.remaining[direction] = Math.min(
        cap,
        (state.remaining[direction] || 0) + add,
      );
    }
    state.lastTick = Game.time;
  }
  return state;
}

/**
 * Совместимость с задачами, созданными до появления budgetCost: для spawn
 * стоимость — реальная потребность цели. Иначе старая задача на extension
 * с maxEnergy=1600 снова съедала бы весь периодный лимит.
 */
function normalizeTaskBudget(task) {
  if (
    !task ||
    task.direction !== "spawn" ||
    typeof task.budgetCost === "number"
  ) {
    return task;
  }
  if (!task.targetId || typeof Game.getObjectById !== "function") {
    return task;
  }
  const target = Game.getObjectById(task.targetId);
  if (!target) return task;

  const capacity = target.energyCapacity;
  const energy = target.energy;
  if (typeof capacity !== "number" || typeof energy !== "number") {
    return task;
  }

  const need = Math.max(0, capacity - energy);
  task.budgetCost = need;
  task.reserve = need;
  task.maxEnergy = need;
  // Все штатные fillSpawnsExtensions — обязательные: им доступен резерв.
  task.mandatory = true;
  return task;
}

/** Стоимость задачи для бюджета: полная стоимость штатной задачи. */
function taskBudgetCost(task) {
  if (!task) return 0;
  normalizeTaskBudget(task);
  // budgetCost — фактическая стоимость конкретной задачи (например, сколько
  // реально нужно данному spawn/extension), а не максимум рюкзака.
  if (typeof task.budgetCost === "number" && task.budgetCost > 0) {
    return task.budgetCost;
  }
  if (typeof task.maxEnergy === "number" && task.maxEnergy > 0) {
    return task.maxEnergy;
  }
  if (typeof task.reserve === "number" && task.reserve > 0) {
    return task.reserve;
  }
  return 0;
}

/** Защищённая часть лимита направления, недоступная обычным задачам. */
function protectedBudget(direction) {
  return (BUDGET.PROTECTED && BUDGET.PROTECTED[direction]) || 0;
}

/** Хватает ли остатка с учётом защищённой части для этой задачи. */
function hasBudget(state, task, cost) {
  const reserve = task.mandatory === true ? 0 : protectedBudget(task.direction);
  return (state.remaining[task.direction] || 0) - reserve >= cost;
}

/** Достаточно ли в бюджете направления на полную стоимость задачи. */
function budgetAvailable(task) {
  if (!task || !task.direction) return true;
  const cost = taskBudgetCost(task);
  if (cost <= 0) return true;
  return hasBudget(budgetState(), task, cost);
}

/**
 * Списывает полную стоимость задачи с бюджета направления при успешном
 * назначении. Никаких бюджетных полей на задаче не хранится: период и
 * остаток — свойство направления, а не задачи.
 */
function tryChargeTaskBudget(task) {
  if (!task || !task.direction) return true;
  const cost = taskBudgetCost(task);
  if (cost <= 0) return true;

  const state = budgetState();
  if (!hasBudget(state, task, cost)) return false;
  const left = state.remaining[task.direction] || 0;

  state.remaining[task.direction] = left - cost;
  state.charged[task.direction] =
    (state.charged[task.direction] || 0) + cost;
  return true;
}

/** Диагностика: Memory.__budget = JSON.stringify(energyPolicy.budgetStatus()) */
function budgetStatus() {
  return budgetState();
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
  budgetPeriod,
  periodIncome,
  budgetState,
  storageEnergy,
  factoryOverflow,
  taskBudgetCost,
  normalizeTaskBudget,
  budgetAvailable,
  tryChargeTaskBudget,
  budgetStatus,
  status,
  BANDS,
  TASK_ENERGY_LIMITS,
};
