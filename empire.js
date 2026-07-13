/**
 * EMPIRE KERNEL (ТЗ №3, Этап 1)
 * Прокси-версия: временно содержит всю старую логику main.js без изменений.
 * На следующих этапах отсюда будет вынесена работа в room.manager.js,
 * task.manager.js, spawn.manager.js, creep.factory.js, worker.runner.js.
 */
const roomManager = require("room.manager");
const roleHarvester = require("role.harvester");
const roleUpgrader = require("role.upgrader");
const roleBuilder = require("role.builder");
const roleRepairer = require("role.repairer");
const roleMiner = require("role.miner");
const roleTower = require("role.tower");
const roleTowerSupplier = require("role.towerSupplier");
const roleLinkWorker = require("role.linkWorker");
const roleMineralMiner = require("role.mineralMiner");
const linkManager = require("linkManager");
const factoryManager = require("factory.manager");
const marketManager = require("market.manager");
const spawnManager = require("spawn.manager");
const taskManager = require("task.manager");
const workerRunner = require("worker.runner");

const ROLES = {
  harvester: roleHarvester,
  upgrader: roleUpgrader,
  builder: roleBuilder,
  repairer: roleRepairer,
  miner: roleMiner,
  towerSupplier: roleTowerSupplier,
  linkWorker: roleLinkWorker,
  mineralMiner: roleMineralMiner,
};

function runCreepLogic(roomState) {
  for (const creep of roomState.creeps) {
    if (!creep) continue;
    const roleModule = ROLES[creep.memory.role];
    if (!roleModule) continue;
    try {
      roleModule.run(creep);
    } catch (e) {
      // Ошибка одного крипа не должна останавливать обработку остальных.
    }
  }
}

function runTowerLogic(roomState) {
  for (const tower of roomState.towers) {
    roleTower.run(tower);
  }
}

function runLinkLogic(roomState) {
  try {
    linkManager.run(roomState);
  } catch (e) {
    // Ошибка linkManager не должна останавливать цикл.
  }
}

// ─── ЯДРО ИМПЕРИИ ─────────────────────────────────────────────────────────────
module.exports.run = function () {
  for (const name in Memory.creeps) {
    if (!Game.creeps[name]) delete Memory.creeps[name];
  }

  const allRooms = roomManager.buildAllRoomStates();

  for (const roomState of allRooms) {
    spawnManager.run(roomState);
    taskManager.run(roomState);
    workerRunner.run(roomState);
    runCreepLogic(roomState);
    runTowerLogic(roomState);
    runLinkLogic(roomState);
    factoryManager.run(roomState);
  }
  marketManager.run();
};
