// ===================================================
// ROOM/CREEPS.JS — крипы комнаты: карта ролей и запуск роли
// ===================================================
// Часть разбиения room.manager.js (960 строк, 04.10.2026).
// Публичный API не изменился: наружу его отдаёт фасад room.manager.js
// (empire.js и консольные замеры зовут require("room.manager")).
//
// require("./x") ниже Node разрешает как обычно, а движок Screeps
// относительные пути не умеет: на выгрузке такой вызов переводится в
// "room/x" (scripts/deploy.modules.js, translateModuleSource).
// ===================================================
const roleMiner = require("role.miner");
const roleLinkWorker = require("role.linkWorker");
const roleMineralMiner = require("role.mineralMiner");
const workerRunner = require("worker.runner");
const labWorker = require("lab.worker");
const boostManager = require("boost.manager");
const cpuMonitor = require("cpuMonitor");
const systems = require("systems");

const ROLES = {
  miner: roleMiner,
  linkWorker: roleLinkWorker,
  labWorker: labWorker,
  mineralMiner: roleMineralMiner,
  worker: workerRunner,
};
function runCreep(creep, roomState) {
  const role = creep.memory.role;

  // Тумблер роли (systems.js): miner: false — роль не исполняется; она же
  // не спавнится (spawn.manager.js). Живые крипы доживают свой срок сами.
  if (systems[role] === false) return;

  const roleModule = ROLES[role];
  if (!roleModule) return;

  // ── БУСТ ПОДАВЛЯЕТ РОЛЬ (boost.manager) ────────────────────────────────
  // Пока крип едет к буст-лабе, набирает буст-ресурс или стоит у лабы в
  // процессе creep.boost(), его роль НЕ выполняется: worker.runner иначе увёл
  // бы его в задачу посреди процедуры, а часть буста к этому моменту уже
  // списана (LAB_BOOST_MINERAL 30 и LAB_BOOST_ENERGY 20 на часть тела).
  // true — действие тика сделано бустом; false — крип не бустится (нет строки
  // политики для роли, запас ниже MIN_STOCK, рюкзак уже бустнут), управление
  // уходит роли как обычно.
  let boosting = false;
  if (systems.boostManager !== false) {
    cpuMonitor.trackRole("boostManager", () => {
      boosting = boostManager.run(roomState, creep) === true;
    });
  }
  if (boosting) return;

  try {
    roleModule.run(creep, roomState);
  } catch (e) {
    console.log(`[RoomManager] Ошибка у крипа ${creep.name}: ${e.stack || e}`);
  }
}

function runCreepLogic(roomState) {
  // Обычный режим: без замеров на каждом крипе. Два Game.cpu.getUsed() и
  // замыкание на крипа стоили больше, чем весь остальной оверхед логики
  // (замерено: getUsed() = 0.000244 CPU), а разбивка по ролям нужна редко.
  if (!cpuMonitor.verboseEnabled()) {
    for (const creep of roomState.creeps) {
      if (creep) runCreep(creep, roomState);
    }
    return;
  }

  // Подробный режим (Memory.cpuMonitorVerbose = true) — замер по каждому крипу.
  // ВАЖНО: ключ замера — creep.memory.role, а имена ролей и подсистем лежат
  // в одном пространстве имён Memory.cpuStats.subsystems. Пока verbose включён,
  // CPU крипов роли складывается с замером одноимённой подсистемы, поэтому
  // держать флаг постоянно включённым нельзя — только на 1 тик из 100.
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    cpuMonitor.trackRole(creep.memory.role, () =>
      runCreep(creep, roomState),
    );
  }
}


module.exports = {
  ROLES,
  runCreep,
  runCreepLogic,
};
