/**
 * SPAWN MANAGER (ТЗ №3)
 * Отвечает на вопрос: "Кого создать?"
 * Хранит очередь/приоритеты ролей, считает текущее количество крипов,
 * вызывает creep.factory для реального спавна.
 */
const creepFactory = require("creep.factory");

const QUOTA = {
  harvester: 1,
  linkWorker: 1,
  miner: 2,
  towerSupplier: 1,
  repairer: 1,
  builder: 0,
  upgrader: 0,
  worker: 0,
  mineralMiner: 1,
};

const MINERAL_MIN_AMOUNT_TO_SPAWN = 1500;

const PRESPAWN_THRESHOLD = { miner: 50, linkWorker: 30 };

function countRole(creeps, role) {
  return creeps.filter(c => {
    if (c.memory.role !== role) return false;
    const threshold = PRESPAWN_THRESHOLD[role];
    if (
      threshold !== undefined &&
      c.ticksToLive !== undefined &&
      c.ticksToLive < threshold
    ) {
      return false;
    }
    return true;
  }).length;
}

/**
 * @param {Object} roomState
 */
function run(roomState) {
  const spawn = roomState.spawn;
  if (!spawn || spawn.spawning) return;

  const creeps = roomState.creeps;

  if (countRole(creeps, "harvester") === 0) {
    creepFactory.run(spawn, "harvester", roomState.roomName);
    return;
  }

  for (const role in QUOTA) {
    if (
      role === "upgrader" &&
      roomState.room.controller.ticksToDowngrade > 100000
    )
      continue;

    if (
      role === "mineralMiner" &&
      (!roomState.mineral ||
        !roomState.mineral.extractor ||
        roomState.mineral.amount < MINERAL_MIN_AMOUNT_TO_SPAWN)
    )
      continue;

    if (countRole(creeps, role) < QUOTA[role]) {
      const result = creepFactory.run(
        spawn,
        role,
        roomState.roomName,
        PRESPAWN_THRESHOLD[role],
      );
      if (result === OK) return;
    }
  }
}

module.exports.run = run;
