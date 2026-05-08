/**
 * ===================================================
 * ROLE.MINERALMINER.JS — Добытчик минералов
 * ===================================================
 * ИСПРАВЛЕНИЕ: проверка "минерал пуст" перенесена ПОСЛЕ доставки груза.
 * Раньше крип застывал когда минерал кончался — даже если нёс груз.
 * Теперь: сначала сдаём груз, потом проверяем минерал.
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const mineralId = creep.memory.mineralId || creep.room.memory.mineralId;
    if (!mineralId) {
      const minerals = creep.room.find(FIND_MINERALS);
      if (minerals.length === 0) {
        creep.say("❌ нет минерала");
        return;
      }
      creep.memory.mineralId = minerals[0].id;
      creep.room.memory.mineralId = minerals[0].id;
    }

    const mineral = Game.getObjectById(mineralId);
    if (!mineral) {
      creep.say("❌ ошибка");
      return;
    }

    // ИСПРАВЛЕНИЕ: переключаем состояние ДО проверки минерала
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      creep.say("⛏️ добыча");
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 везу");
    }

    // Если везём груз — сначала сдаём, проверки минерала не нужны
    if (creep.memory.working) {
      this.deliverMinerals(creep);
      return;
    }

    // Только теперь проверяем есть ли минерал
    if (!mineral.mineralAmount || mineral.mineralAmount === 0) {
      const ticks = mineral.ticksToRegeneration || "?";
      creep.say(`💤 ${ticks}т`);
      return;
    }

    this.collectMinerals(creep, mineral);
  },

  collectMinerals: function (creep, mineral) {
    if (!mineral || !mineral.mineralAmount || mineral.mineralAmount === 0)
      return;
    if (creep.getActiveBodyparts(WORK) === 0) {
      creep.say("❌ нет WORK");
      return;
    }

    if (!creep.memory.extractorId) {
      const extractor = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_EXTRACTOR,
      })[0];
      if (!extractor) {
        creep.say("⏳ нет экстрактора");
        return;
      }
      creep.memory.extractorId = extractor.id;
    }

    const extractor = Game.getObjectById(creep.memory.extractorId);
    if (!extractor) {
      delete creep.memory.extractorId;
      return;
    }

    const result = creep.harvest(mineral);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, {
        reusePath: 30,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
    }
  },

  deliverMinerals: function (creep) {
    const room = creep.room;
    const resourceType = Object.keys(creep.store).find(
      r => r !== RESOURCE_ENERGY && creep.store[r] > 0,
    );
    if (!resourceType) {
      creep.memory.working = false;
      return;
    }

    let target = null;
    if (room.terminal && room.terminal.store.getFreeCapacity() > 0) {
      target = room.terminal;
    } else if (room.storage && room.storage.store.getFreeCapacity() > 0) {
      target = room.storage;
    }

    if (target) {
      if (creep.transfer(target, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          reusePath: 25,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      creep.say("😴 всё полно");
    }
  },
};
