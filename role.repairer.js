/**
 * ЛОГИКА РЕМОНТНИКА (Repairer Role)
 * Задача: чинить дороги и контейнеры. Стены/рампарты — задача башни.
 * Если всё исправно — помогает строителю.
 *
 * Примечание: в оригинале этот файл не использовался (не подключён в main.js).
 * Теперь подключён через creep.runner.js.
 */
const roleBuilder = require("role.builder");

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
      // Dropped energy → контейнер → источник
      const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
      });
      if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) creep.moveTo(dropped);
        return;
      }

      const source = creep.pos.findClosestByRange(FIND_SOURCES);
      if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    } else {
      const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      });

      if (target) {
        if (creep.repair(target) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { visualizePathStyle: { stroke: "#00ff00" } });
        }
      } else {
        roleBuilder.run(creep);
      }
    }
  },
};
