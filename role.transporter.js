/**
 * ЛОГИКА ТРАНСПОРТЁРА (Transporter Role)
 * Задача: забирать энергию из контейнеров и развозить по спавну/расширениям/storage.
 * Если некуда везти — помогает апгрейдеру.
 */
module.exports = {
  run: function (creep) {
    if (creep.memory.working === undefined) creep.memory.working = false;

    // Тумблер
    if (
      creep.memory.working &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = false;
    } else if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      this._deliver(creep);
    } else {
      this._collect(creep);
    }
  },

  _collect: function (creep) {
    // Сначала dropped energy — бесплатные ресурсы
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
      filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
    });
    if (dropped) {
      if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dropped, { reusePath: 5 });
      }
      return;
    }

    // Затем контейнеры
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_CONTAINER &&
        s.store[RESOURCE_ENERGY] > 100,
    });
    if (container) {
      if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, {
          visualizePathStyle: { stroke: "#ffaa00" },
          reusePath: 10,
        });
      }
    }
  },

  _deliver: function (creep) {
    // Extensions → Spawn → Storage → контроллер (запасной)
    let target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: s =>
        (s.structureType === STRUCTURE_EXTENSION ||
          s.structureType === STRUCTURE_SPAWN) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    if (
      !target &&
      creep.room.storage &&
      creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      target = creep.room.storage;
    }

    if (target) {
      const result = creep.transfer(target, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          visualizePathStyle: { stroke: "#ffffff" },
          reusePath: 10,
        });
      }
      return;
    }

    // Некуда везти — апгрейдим контроллер
    const ctrl = creep.room.controller;
    if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
      creep.moveTo(ctrl, { reusePath: 10 });
    }
  },
};
