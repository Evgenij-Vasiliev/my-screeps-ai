module.exports = {
  run: function (creep) {
    // 1. УСТАНОВКА ЦЕЛЕВОЙ КОМНАТЫ
    if (!creep.memory.target) {
      const rooms = ["E35S38", "E36S37"];
      let sum = 0;
      for (let i = 0; i < creep.name.length; i++)
        sum += creep.name.charCodeAt(i);
      creep.memory.target = rooms[sum % 2];
    }

    const targetRoom = creep.memory.target;

    // 2. ПРОВЕРКА ВИДИМОСТИ
    if (!creep.room) return;

    // 3. ПЕРЕХОД МЕЖДУ КОМНАТАМИ
    if (creep.room.name !== targetRoom) {
      const exit = creep.room.findExitTo(targetRoom);
      if (exit !== ERR_NO_PATH) {
        creep.moveTo(creep.pos.findClosestByRange(exit), { reusePath: 15 });
      }
      return;
    }

    // 4. ШАГ ОТ ГРАНИЦЫ
    if (
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49
    ) {
      creep.move(creep.pos.getDirectionTo(25, 25));
      return;
    }

    // 5. РАБОТА У ИСТОЧНИКА
    const source = creep.pos.findClosestByRange(FIND_SOURCES);
    if (source) {
      if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source, {
          reusePath: 15,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
      } else {
        const structures = creep.pos.lookFor(LOOK_STRUCTURES);
        const container = structures.find(
          s => s.structureType === STRUCTURE_CONTAINER,
        );

        if (container) {
          if (
            container.hits < container.hitsMax &&
            creep.store[RESOURCE_ENERGY] > 0
          ) {
            creep.repair(container);
          } else {
            creep.harvest(source);
          }
        } else {
          const site = creep.pos
            .lookFor(LOOK_CONSTRUCTION_SITES)
            .find(s => s.structureType === STRUCTURE_CONTAINER);
          if (site) {
            if (creep.store[RESOURCE_ENERGY] > 0) {
              creep.build(site);
            } else {
              creep.harvest(source);
            }
          } else {
            if (Game.time % 10 === 0) {
              creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
            }
            creep.harvest(source);
          }
        }
      }
    }
  },
};
