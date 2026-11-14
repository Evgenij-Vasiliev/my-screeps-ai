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
const { ENERGY_POLICY, TASK_ENERGY_LIMITS } = require("./constants");
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

/** Текущая ступень комнаты (0 — только ядро). Обновляет состояние раз в EVAL_EVERY тиков. */
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

module.exports = { band, allows, status, BANDS, TASK_ENERGY_LIMITS };
