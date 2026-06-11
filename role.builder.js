/**
 * ЛОГИКА СТРОИТЕЛЯ (Builder Role)
 * Задача: строить construction sites. Если строек нет — апгрейд контроллера.
 */
const roleUpgrader = require("role.upgrader");

module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    // Тумблер
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    } else if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
    }

    if (!creep.memory.working) {
      this._collectEnergy(creep);
    } else {
      this._build(creep);
    }
  },

  _collectEnergy: function (creep) {
    // Dropped energy первым делом
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped, { reusePath: 5 });
      }
      return;
    }

    // Контейнер или источник
    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, { reusePath: 10 });
      }
      return;
    }

    const sources = creep.room.find(FIND_SOURCES);
    const source =
      creep.memory.sourceIndex !== undefined
        ? sources[creep.memory.sourceIndex]
        : creep.pos.findClosestByRange(FIND_SOURCES);

    if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, {
        visualizePathStyle: { stroke: "#ffaa00" },
        reusePath: 10,
      });
    }
  },

  _build: function (creep) {
    const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
    if (site) {
      if (creep.build(site) === ERR_NOT_IN_RANGE) {
        creep.moveTo(site, {
          visualizePathStyle: { stroke: "#ffff00" },
          reusePath: 10,
        });
      }
    } else {
      // Строек нет — помогаем апгрейдеру
      roleUpgrader.run(creep);
    }
  },
};
