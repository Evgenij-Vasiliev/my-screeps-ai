/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Основная задача: сбор энергии и заправка ключевых зданий комнаты.
 *
 * ТЗ №2: harvester — единственная роль с правом прямой добычи из источника.
 * Основной режим — получение энергии из Storage. Аварийный режим (прямая
 * добыча, как раньше) включается, если Storage отсутствует или пуст, и
 * автоматически отключается, как только в Storage снова появляется энергия
 * (условие проверяется заново каждый тик — отдельного флага не требуется).
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
     * 3. РЕЖИМ СБОРА
     */
    if (!creep.memory.working) {
      const storage = creep.room.storage;
      const emergency = !storage || storage.store[RESOURCE_ENERGY] === 0;

      if (!emergency) {
        // ОСНОВНОЙ РЕЖИМ (ТЗ №2): энергия берётся из Storage
        creep.say("📥storage");
        energySource.withdrawFromStorage(creep);
        return;
      }

      // АВАРИЙНЫЙ РЕЖИМ: Storage отсутствует/пуст — старая модель добычи
      creep.say("⚠️source");
      const sources = creep.room.find(FIND_SOURCES);
      const targetSource =
        creep.memory.sourceIndex !== undefined
          ? sources[creep.memory.sourceIndex]
          : creep.pos.findClosestByRange(FIND_SOURCES);

      if (targetSource) {
        if (creep.harvest(targetSource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(targetSource, {
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
      }
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
      creep.say("📤" + target.structureType.slice(0, 6));
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    } else {
      // creep.say("😴idle");
    }
  },
};
