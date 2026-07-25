/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Основная задача: сбор энергии и заправка ключевых зданий комнаты.
 *
 * ТЗ №2: harvester получает энергию из Storage.
 * Аварийный режим (прямая добыча при пустом/отсутствующем Storage)
 * вынесен в отдельный модуль и здесь не обрабатывается.
 *
 * Harvester — единственная роль, которая наполняет Storage, поэтому забор
 * энергии из Storage у неё выполняется с ignoreReserve = true: harvester не
 * должен блокироваться минимальным резервом (STORAGE.ENERGY_MIN), иначе при
 * просадке ниже резерва storage никогда не наполнится обратно.
 */
const energySource = require("energySource");

module.exports = {
  run: function (creep) {
    /**
     * 1. СОСТОЯНИЕ (State Management)
     */
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    /**
     * 2. ТУМБЛЕР (Logic Switch)
     */
    if (creep.memory.working === false && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (
      creep.memory.working === true &&
      creep.store[RESOURCE_ENERGY] === 0
    ) {
      creep.memory.working = false;
    }

    /**
     * 3. РЕЖИМ СБОРА (Storage-only)
     */
    if (!creep.memory.working) {
      // ignoreReserve = true — harvester сам наполняет резерв, поэтому
      // не должен на него оглядываться.
      // creep.say("📥storage");
      energySource.withdrawFromStorage(creep, true);
      return;
    }

    /**
     * 4. РЕЖИМ ПЕРЕДАЧИ (без изменений)
     */
    let target = null;

    if (!target) {
      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_EXTENSION &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
    }

    if (!target) {
      target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: structure =>
          structure.structureType === STRUCTURE_SPAWN &&
          structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
    }

    // Terminal и Storage больше не используются как цели доставки: терминал
    // предназначен для рыночных операций, а не для сброса лишней энергии от
    // харвестера. Если extension/spawn заполнены, харвестеру просто нечего
    // делать — ждёт следующего тика.

    if (target) {
      // creep.say("📤" + target.structureType.slice(0, 6));
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    } else {
      // creep.say("😴idle");
    }
  },
};
