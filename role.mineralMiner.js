module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // === Переключение режима ===
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      this.deliverMinerals(creep);
    } else {
      this.collectMinerals(creep);
    }
  },

  collectMinerals: function (creep) {
    const room = creep.room;
    if (creep.getActiveBodyparts(WORK) === 0) return;

    // Кэш минерала
    if (!creep.memory.mineralId || Game.time % 100 === 0) {
      const mineral = room.find(FIND_MINERALS)[0];
      creep.memory.mineralId = mineral ? mineral.id : null;
    }

    const mineral = Game.getObjectById(creep.memory.mineralId);
    if (!mineral || mineral.amount === 0) return;

    // Кэш экстрактора
    if (!creep.memory.extractorId || Game.time % 200 === 0) {
      const extractor = room.find(FIND_STRUCTURES, {
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
    // Ищем любой ресурс, кроме энергии
    const resourceType = _.find(
      Object.keys(creep.store),
      r => r !== RESOURCE_ENERGY,
    );
    if (!resourceType) {
      creep.memory.working = false; // Если осталась только энергия, идем копать
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

    let target = null;
    if (terminal && terminal.store.getFreeCapacity() > 0) {
      target = terminal;
    } else if (storage && storage.store.getFreeCapacity() > 0) {
      target = storage;
    }

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
