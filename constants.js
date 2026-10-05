// ===================================================
// CONSTANTS.JS — barrel констант проекта
// ===================================================
// Значения разложены по доменам в constants/*.js:
//   logistics  — STORAGE, TERMINAL_SUPPLY, TERMINAL_NETWORK
//   factory    — FACTORY
//   defense    — TOWER, REPAIR
//   tasks      — TASK_CONFIG
//   powerSpawn — POWER_SPAWN
//   spawn      — PRESPAWN_THRESHOLD, SPAWN_QUOTA, MINERAL_MIN_AMOUNT_TO_SPAWN, SPAWN
//   creeps     — BOOST_BODIES, boostReadyForSpawn, MINER, CREEP_BODIES
//   system     — CONTROLLER, CACHE, MOVE, CPU
//   market     — MARKET, LAB_PRIORITY, MARKET_BUY
//   labs       — LAB_WORKER, LAB_PLAN, LAB_BINDING, LAB_BOOST
//
// Этот файл НЕ хранит значения, а только собирает их в один объект: все
// потребители по-прежнему пишут require("./constants") и получают ТЕ ЖЕ
// объекты конфига. Это важно там, где конфиг мутируют на месте (тесты
// чистят MARKET.BUY_RESOURCES): баррель отдаёт ссылки, а не копии.
//
// Порядок экспортов сохранён как в моно-файле: до/после разбиения
// JSON.stringify(require("./constants")) совпадает байт-в-байт.
// ===================================================

const logistics = require("./constants/logistics");
const factory = require("./constants/factory");
const defense = require("./constants/defense");
const tasks = require("./constants/tasks");
const powerSpawn = require("./constants/powerSpawn");
const spawn = require("./constants/spawn");
const creeps = require("./constants/creeps");
const system = require("./constants/system");
const market = require("./constants/market");
const labs = require("./constants/labs");

module.exports = {
  STORAGE: logistics.STORAGE,
  MARKET: market.MARKET,
  TERMINAL_SUPPLY: logistics.TERMINAL_SUPPLY,
  FACTORY: factory.FACTORY,
  PRESPAWN_THRESHOLD: spawn.PRESPAWN_THRESHOLD,
  CREEP_BODIES: creeps.CREEP_BODIES,
  MINER: creeps.MINER,
  TOWER: defense.TOWER,
  REPAIR: defense.REPAIR,
  TASK_CONFIG: tasks.TASK_CONFIG,
  POWER_SPAWN: powerSpawn.POWER_SPAWN,
  SPAWN_QUOTA: spawn.SPAWN_QUOTA,
  MINERAL_MIN_AMOUNT_TO_SPAWN: spawn.MINERAL_MIN_AMOUNT_TO_SPAWN,
  BOOST_BODIES: creeps.BOOST_BODIES,
  boostReadyForSpawn: creeps.boostReadyForSpawn,
  SPAWN: spawn.SPAWN,
  CONTROLLER: system.CONTROLLER,
  CACHE: system.CACHE,
  MOVE: system.MOVE,
  CPU: system.CPU,
  LAB_WORKER: labs.LAB_WORKER,
  LAB_PLAN: labs.LAB_PLAN,
  LAB_BINDING: labs.LAB_BINDING,
  LAB_BOOST: labs.LAB_BOOST,
  LAB_PRIORITY: market.LAB_PRIORITY,
  MARKET_BUY: market.MARKET_BUY,
  TERMINAL_NETWORK: logistics.TERMINAL_NETWORK,
};
