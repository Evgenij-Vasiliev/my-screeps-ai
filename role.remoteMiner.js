module.exports = {
  run: function (creep) {
    if (!creep.memory.target) {
      const config = Memory.remoteMinerConfig || {};
      const rooms = config.targetRooms || ["E35S38", "E36S37"];

      let hash = 0;
      for (let i = 0; i < creep.name.length; i++) {
        hash += creep.name.charCodeAt(i);
      }
      creep.memory.target = rooms[hash % rooms.length];
    }

    const targetRoom = creep.memory.target;

    if (creep.room.name !== targetRoom) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._move;
      }
      creep.memory._lastRoom = creep.room.name;

      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 0,
        visualizePathStyle: { stroke: "#ffaa00" },
        maxRooms: 3,
      });

      return;
    }

    creep.memory._lastRoom = creep.room.name;

    const onBorder =
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49;

    if (onBorder) {
      creep.moveTo(new RoomPosition(25, 25, creep.room.name), {
        reusePath: 0,
        visualizePathStyle: { stroke: "#ffffff" },
      });
      return;
    }

    if (creep.memory.sourceId) {
      const cachedSource = Game.getObjectById(creep.memory.sourceId);
      if (!cachedSource || cachedSource.room.name !== targetRoom) {
        delete creep.memory.sourceId;
      }
    }

    if (!creep.memory.sourceId) {
      const sourceIds = creep.room.memory.sources;
      const sources = sourceIds
        ? sourceIds.map(id => Game.getObjectById(id)).filter(Boolean)
        : creep.room.find(FIND_SOURCES);

      const source = creep.pos.findClosestByRange(sources);
      if (source) {
        creep.memory.sourceId = source.id;
      }
    }

    const source = Game.getObjectById(creep.memory.sourceId);

    if (!source) {
      delete creep.memory.sourceId;
      return;
    }

    // Ищем контейнер рядом с источником
    const container =
      source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
      })[0] || null;

    // Если есть контейнер — идём на его клетку (дистанция 0)
    // Если нет — идём вплотную к источнику (дистанция 1)
    if (container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container, {
          reusePath: 15,
          visualizePathStyle: { stroke: "#ffaa00" },
          maxRooms: 1,
        });
        return;
      }
    } else {
      if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source, {
          reusePath: 15,
          visualizePathStyle: { stroke: "#ffaa00" },
          maxRooms: 1,
        });
        return;
      }
    }

    // Чиним контейнер если сильно повреждён
    if (
      container &&
      container.hits < container.hitsMax * 0.5 &&
      creep.store[RESOURCE_ENERGY] > 0
    ) {
      creep.repair(container);
      return;
    }

    // Строим контейнер если есть стройплощадка
    const site =
      source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
        filter: s => s.structureType === STRUCTURE_CONTAINER,
      })[0] || null;

    if (site && creep.store[RESOURCE_ENERGY] > 0) {
      creep.build(site);
      return;
    }

    if (!container && !site) {
      creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
    }

    creep.harvest(source);
  },
};
