// taskExecutors.js

const energySource = require("energySource");
const { TERMINAL_SUPPLY, TOWER, CONTROLLER, CACHE } = require("./constants");

/**
 * Тип А: используется там, где успешное действие (OK) означает
 * "задача выполнена" — крип освобождается (return false).
 * Двигаться нужно только если цель вне досягаемости.
 */
function moveIfNotInRange(creep, target, result, moveOpts) {
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, moveOpts);
    return true;
  }
  return false;
}

/**
 * Тип Б: используется там, где успешное действие (OK) означает
 * "крип продолжает делать то же самое" (стройка) — тик считается
 * занятым (return true). Условия завершения задачи: цель не найдена
 * (стройка закончена/строек нет) или энергия в рюкзаке кончилась —
 * оба случая проверяются ДО вызова build() и возвращают false раньше.
 */
function moveOrContinue(creep, target, result, moveOpts) {
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, moveOpts);
    return true;
  }
  return result === OK;
}

const taskExecutors = {
  updateCache: function (room) {
    if (!global.roomCache) global.roomCache = {};
    if (!global.roomCache[room.name]) global.roomCache[room.name] = {};

    const cache = global.roomCache[room.name];

    if (!cache.spawnsAndExtensions) {
      cache.spawnsAndExtensions = room
        .find(FIND_MY_STRUCTURES, {
          filter: s =>
            s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION,
        })
        .map(s => s.id);

      cache.towers = room
        .find(FIND_MY_STRUCTURES, {
          filter: s => s.structureType === STRUCTURE_TOWER,
        })
        .map(s => s.id);

      cache.terminalId = room.terminal ? room.terminal.id : null;

      const factory = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_FACTORY,
      })[0];
      cache.factoryId = factory ? factory.id : null;
    }

    if (!cache.repairIds || Game.time % CACHE.REFRESH_INTERVAL === 0) {
      cache.repairIds = room
        .find(FIND_STRUCTURES, {
          filter: s =>
            s.hits < s.hitsMax &&
            s.structureType !== STRUCTURE_WALL &&
            s.structureType !== STRUCTURE_RAMPART,
        })
        .map(s => s.id);
      cache.buildIds = room.find(FIND_MY_CONSTRUCTION_SITES).map(c => c.id);
    }
  },

  fillSpawnsExtensions: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];
    if (!cache || !cache.spawnsAndExtensions) return false;

    const targets = cache.spawnsAndExtensions
      .map(id => Game.getObjectById(id))
      .filter(s => s && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);

    const target = creep.pos.findClosestByRange(targets);
    if (!target) return false;

    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.transfer(target, RESOURCE_ENERGY);
    return moveIfNotInRange(creep, target, result, {
      reusePath: 15,
      visualizePathStyle: { stroke: "#ffffff" },
    });
  },

  fillTowers: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];
    if (!cache || !cache.towers) return false;

    const towers = cache.towers
      .map(id => Game.getObjectById(id))
      .filter(t => t && t.store[RESOURCE_ENERGY] < TOWER.SUPPLY_THRESHOLD);

    const target = creep.pos.findClosestByRange(towers);
    if (!target) return false;

    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.transfer(target, RESOURCE_ENERGY);
    return moveIfNotInRange(creep, target, result, {
      visualizePathStyle: { stroke: "#ffaa00" },
    });
  },

  fillTerminals: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];
    if (!cache || !cache.terminalId) return false;

    const terminal = Game.getObjectById(cache.terminalId);

    if (
      !terminal ||
      terminal.store[RESOURCE_ENERGY] >= TERMINAL_SUPPLY.ENERGY_TARGET
    )
      return false;

    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.transfer(terminal, RESOURCE_ENERGY);
    return moveIfNotInRange(creep, terminal, result, {
      reusePath: 15,
      visualizePathStyle: { stroke: "#00ffff" },
    });
  },

  operateFactory: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];
    if (!cache || !cache.factoryId) return false;

    const factory = Game.getObjectById(cache.factoryId);
    if (!factory) return false;

    // Шаг 6-7: в рюкзаке батарейка — везём в storage, выгружаем, задача завершена
    if (creep.store[RESOURCE_BATTERY] > 0) {
      if (!creep.room.storage) return false;
      if (
        creep.transfer(creep.room.storage, RESOURCE_BATTERY) ===
        ERR_NOT_IN_RANGE
      ) {
        creep.moveTo(creep.room.storage, {
          visualizePathStyle: { stroke: "#ffaa00" },
        });
        return true;
      }
      return false;
    }

    // Шаг 2-3-4: в рюкзаке энергия — везём на фабрику, выгружаем, проверяем батарейку
    if (creep.store[RESOURCE_ENERGY] > 0) {
      const result = creep.transfer(factory, RESOURCE_ENERGY);

      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory, { visualizePathStyle: { stroke: "#ffffff" } });
        return true;
      }

      if (result === OK) {
        if (factory.store[RESOURCE_BATTERY] > 0) return true; // остаёмся — заберём батарейку (шаг 5)
        return false; // батарейки нет — задача завершена (шаг 4)
      }

      return false;
    }

    // Рюкзак пуст. Шаг 5: проверяем батарейку на фабрике
    if (factory.store[RESOURCE_BATTERY] > 0) {
      if (creep.withdraw(factory, RESOURCE_BATTERY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
      return true;
    }

    // Шаг 1: батарейки нет — идём заправляться энергией
    return energySource.withdrawFromStorage(creep);
  },

  repairStructures: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];

    if (!cache || !cache.repairIds || cache.repairIds.length === 0) {
      creep.memory.task = null;
      return false; // условие 2: невозможно
    }

    // Назначаем цель один раз — дальше держимся именно за неё
    if (!creep.memory.task || creep.memory.task.name !== "repairStructures") {
      const target = cache.repairIds
        .map(id => Game.getObjectById(id))
        .find(structure => structure && structure.hits < structure.hitsMax);

      if (!target) return false; // условие 2: целей нет

      creep.memory.task = { name: "repairStructures", target: target.id };
    }

    const target = Game.getObjectById(creep.memory.task.target);

    // Условие 1: именно ЭТА цель отремонтирована или исчезла — задача выполнена
    if (!target || target.hits >= target.hitsMax) {
      creep.memory.task = null;
      return false;
    }

    // Условие 3: рюкзак пуст
    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.repair(target);
    return moveOrContinue(creep, target, result, {
      reusePath: 15,
      visualizePathStyle: { stroke: "#ffaa00" },
    });
  },

  buildStructures: function (creep) {
    this.updateCache(creep.room);
    const cache = global.roomCache[creep.room.name];

    if (!cache || !cache.buildIds || cache.buildIds.length === 0) {
      creep.memory.task = null;
      return false; // условие 2: невозможно
    }

    // Назначаем цель один раз — дальше держимся именно за неё
    if (!creep.memory.task || creep.memory.task.name !== "buildStructures") {
      const target = cache.buildIds
        .map(id => Game.getObjectById(id))
        .find(site => site !== null);

      if (!target) return false; // условие 2: целей нет

      creep.memory.task = { name: "buildStructures", target: target.id };
    }

    const target = Game.getObjectById(creep.memory.task.target);

    // Условие 1: именно ЭТА стройка завершена (сайт исчез — стал структурой)
    if (!target) {
      creep.memory.task = null;
      return false;
    }

    // Условие 3: рюкзак пуст
    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.build(target);
    return moveOrContinue(creep, target, result, {
      reusePath: 15,
      visualizePathStyle: { stroke: "#ffffff" },
    });
  },

  upgradeController: function (creep) {
    const controller = creep.room.controller;

    if (
      !controller ||
      !controller.my ||
      controller.ticksToDowngrade > CONTROLLER.DOWNGRADE_THRESHOLD
    ) {
      return false;
    }

    if (creep.store[RESOURCE_ENERGY] === 0) return false;

    const result = creep.upgradeController(controller);
    return moveOrContinue(creep, controller, result, {
      reusePath: 15,
      visualizePathStyle: { stroke: "#33ff33" },
    });
  },
};

module.exports = taskExecutors;
