/**
 * ЛОГИКА ДОБЫТЧИКА МИНЕРАЛОВ (Mineral Miner)
 * Задача: Только добыча минерала и доставка в терминал/хранилище.
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // 1. ПРОВЕРКА И КЭШ МИНЕРАЛА
    if (!creep.memory.mineralId || Game.time % 1000 === 0) {
      const minerals = creep.room.find(FIND_MINERALS);
      if (minerals.length > 0) creep.memory.mineralId = minerals[0].id;
    }

    const mineral = Game.getObjectById(creep.memory.mineralId);

    // Если минерала нет или он пуст — крип просто ждет (пока не внедрим Шаг 2)
    if (!mineral || mineral.amount === 0) {
      creep.say("💤 Wait");
      return;
    }

    // 2. УПРАВЛЕНИЕ СОСТОЯНИЕМ
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      creep.say("⛏️ добыча");
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 доставка");
    }

    // 3. ВЫБОР ДЕЙСТВИЯ
    if (creep.memory.working) {
      this.deliverMinerals(creep);
    } else {
      this.collectMinerals(creep, mineral);
    }
  },

  collectMinerals: function (creep, mineral) {
    if (!mineral || mineral.amount === 0) return;
    if (creep.getActiveBodyparts(WORK) === 0) return;

    // Кэш экстрактора
    if (!creep.memory.extractorId || Game.time % 200 === 0) {
      const extractor = creep.room.find(FIND_STRUCTURES, {
        filter: s =>
          s.structureType === STRUCTURE_EXTRACTOR && s.pos.isNearTo(mineral),
      })[0];
      creep.memory.extractorId = extractor ? extractor.id : null;
    }

    const extractor = Game.getObjectById(creep.memory.extractorId);
    if (!extractor) return;

    // Добыча
    if (creep.harvest(mineral) === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, {
        reusePath: 30,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
    }
  },

  deliverMinerals: function (creep) {
    const room = creep.room;

    // Ищем в рюкзаке любой ресурс, кроме энергии
    const resourceType = _.find(
      Object.keys(creep.store),
      r => r !== RESOURCE_ENERGY,
    );

    if (!resourceType) {
      creep.memory.working = false;
      return;
    }

    // Кэш терминала и хранилища
    if (!creep.memory.terminalId || Game.time % 200 === 0) {
      creep.memory.terminalId = room.terminal ? room.terminal.id : null;
    }
    if (!creep.memory.storageId || Game.time % 500 === 0) {
      creep.memory.storageId = room.storage ? room.storage.id : null;
    }

    const terminal = Game.getObjectById(creep.memory.terminalId);
    const storage = Game.getObjectById(creep.memory.storageId);

    let target =
      terminal && terminal.store.getFreeCapacity() > 0 ? terminal : storage;

    if (target) {
      if (creep.transfer(target, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          reusePath: 25,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    }
  },
};
