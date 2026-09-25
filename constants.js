// ===================================================
// CONSTANTS.JS — barrel констант проекта
// ===================================================
// Значения разложены по доменам в constants/*.js:
//   logistics  — STORAGE, TERMINAL_SUPPLY, TERMINAL_NETWORK
//   factory    — FACTORY
//   defense    — TOWER
//   tasks      — TASK_CONFIG, TASK_GEN_INTERVAL(_DEFAULT)
//   powerSpawn — POWER_SPAWN
//   spawn      — SPAWN_QUOTA, ROOM_SPAWN_QUOTA_OVERRIDES,
//                MINERAL_MIN_AMOUNT_TO_SPAWN, PRESPAWN_THRESHOLD
//   creeps     — HARVESTER, WORKER, BOOTSTRAP, MINER, REMOTE, CREEP_BODIES
//   labs       — LAB_WORKER, LAB_PLAN, LAB_BINDING, LAB_BOOST
//   system     — CONTROLLER, CACHE, CPU
//   market     — MARKET, X_PURCHASE, LAB_PRIORITY
//   empire     — EMPIRE (обход обсервера, комнаты риска, точка сбора)
//
// Этот файл НЕ хранит значения, а только собирает их в один объект: все
// потребители по-прежнему пишут require("./constants") и получают ТЕ ЖЕ
// объекты конфига, что и доменные модули. Это важно там, где конфиг
// мутируют на месте (например, тесты чистят MARKET.BUY_RESOURCES).
// Ничего, что относится к конкретной роли/менеджеру, не должно жить
// россыпью в других файлах — все настраиваемые значения стягиваются сюда.
// ===================================================

const logistics = require("./constants/logistics");
const factory = require("./constants/factory");
const defense = require("./constants/defense");
const tasks = require("./constants/tasks");
const powerSpawn = require("./constants/powerSpawn");
const spawn = require("./constants/spawn");
const creeps = require("./constants/creeps");
const labs = require("./constants/labs");
const system = require("./constants/system");
const market = require("./constants/market");
const empire = require("./constants/empire");

module.exports = {
  STORAGE: logistics.STORAGE,
  TERMINAL_SUPPLY: logistics.TERMINAL_SUPPLY,
  TERMINAL_NETWORK: logistics.TERMINAL_NETWORK,
  FACTORY: factory.FACTORY,
  PRESPAWN_THRESHOLD: spawn.PRESPAWN_THRESHOLD,
  CREEP_BODIES: creeps.CREEP_BODIES,
  TOWER: defense.TOWER,
  TASK_CONFIG: tasks.TASK_CONFIG,
  TASK_GEN_INTERVAL: tasks.TASK_GEN_INTERVAL,
  TASK_GEN_INTERVAL_DEFAULT: tasks.TASK_GEN_INTERVAL_DEFAULT,
  POWER_SPAWN: powerSpawn.POWER_SPAWN,
  HARVESTER: creeps.HARVESTER,
  WORKER: creeps.WORKER,
  BOOTSTRAP: creeps.BOOTSTRAP,
  MINER: creeps.MINER,
  REMOTE: creeps.REMOTE,
  LAB_WORKER: labs.LAB_WORKER,
  LAB_PLAN: labs.LAB_PLAN,
  LAB_BINDING: labs.LAB_BINDING,
  LAB_BOOST: labs.LAB_BOOST,
  SPAWN_QUOTA: spawn.SPAWN_QUOTA,
  ROOM_SPAWN_QUOTA_OVERRIDES: spawn.ROOM_SPAWN_QUOTA_OVERRIDES,
  MINERAL_MIN_AMOUNT_TO_SPAWN: spawn.MINERAL_MIN_AMOUNT_TO_SPAWN,
  CONTROLLER: system.CONTROLLER,
  CACHE: system.CACHE,
  CPU: system.CPU,
  MARKET: market.MARKET,
  X_PURCHASE: market.X_PURCHASE,
  LAB_PRIORITY: market.LAB_PRIORITY,
  EMPIRE: empire.EMPIRE,
};
