/**
 * ЛОГИКА АПГРЕЙДЕРА (Upgrader Role)
 * Задача: качать контроллер комнаты.
 * Источник энергии: Link у контроллера → Container → Source напрямую.
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    // Тумблер
    if (creep.store[RESOURCE_ENERGY] === 0) creep.memory.working = false;
    if (creep.store.getFreeCapacity() === 0) creep.memory.working = true;
    if (creep.memory.working === undefined) creep.memory.working = false;

    if (!creep.memory.working) {
      this._collectEnergy(creep);
    } else {
      if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(creep.room.controller, { reusePath: 10 });
      }
    }
  },

  _collectEnergy: function (creep) {
    // 1. Link рядом с контроллером
    const link = creep.room.find(FIND_MY_STRUCTURES, {
      filter: s =>
        s.structureType === STRUCTURE_LINK &&
        s.pos.inRangeTo(creep.room.controller, 3) &&
        s.store[RESOURCE_ENERGY] > 0,
    })[0];
    if (link) {
      if (creep.withdraw(link, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(link, { reusePath: 10 });
      }
      return;
    }

    // 2. Ближайший контейнер
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

    // 3. Добыча напрямую
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (source) {
      if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 10 });
      }
    } else {
      creep.say("⚡ нет");
    }
  },
};
