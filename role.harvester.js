/**
 * ЛОГИКА ХАРВЕСТЕРА (Harvester Role)
 * Основная задача: сбор энергии и заправка ключевых зданий комнаты.
 *
 * ТЗ №2: harvester получает энергию из Storage.
 * Обновление: если в Storage энергии нет — пробует Terminal.
 * Если и там пусто — добывает энергию напрямую из источника (Source).
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
     * 3. РЕЖИМ СБОРА (Storage → Terminal → Source)
     */
    if (!creep.memory.working) {
      // Приоритет 1: Storage. ignoreReserve = true — harvester сам
      // наполняет резерв, поэтому не должен на него оглядываться.
      const withdrewFromStorage = energySource.withdrawFromStorage(creep, true);

      if (withdrewFromStorage) {
        // creep.say("📥storage");
        return;
      }

      // Приоритет 2: Terminal.
      const terminal = creep.room.terminal;

      if (terminal && terminal.store[RESOURCE_ENERGY] > 0) {
        // creep.say("📥terminal");
        if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, { reusePath: 15 });
        }
        return;
      }

      // Приоритет 3: прямая добыча из источника (Source).
      const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);

      if (source) {
        // creep.say("⛏️source");
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { reusePath: 15 });
        }
      } else {
        // creep.say("😴idle");
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
      // creep.say("📤" + target.structureType.slice(0, 6));
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    } else {
      // creep.say("😴idle");
    }
  },
};
