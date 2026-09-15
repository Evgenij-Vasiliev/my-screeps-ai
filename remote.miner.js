module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom;

    if (!targetRoom) {
      return;
    }

    if (creep.room.name !== targetRoom) {
      if (
        creep.memory._lastRoom &&
        creep.memory._lastRoom !== creep.room.name
      ) {
        delete creep.memory._travel;
      }

      creep.memory._lastRoom = creep.room.name;

      creep.travelTo(new RoomPosition(25, 25, targetRoom));

      return;
    }

    creep.memory._lastRoom = creep.room.name;

    const onBorder =
      creep.pos.x === 0 ||
      creep.pos.x === 49 ||
      creep.pos.y === 0 ||
      creep.pos.y === 49;

    if (onBorder) {
      creep.travelTo(new RoomPosition(25, 25, creep.room.name));
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

    let container = null;

    if (creep.memory.containerId) {
      container = Game.getObjectById(creep.memory.containerId);
      if (!container || container.structureType !== STRUCTURE_CONTAINER) {
        container = null;
        delete creep.memory.containerId;
      }
    }

    if (!container) {
      container =
        source.pos.findInRange(FIND_STRUCTURES, 1, {
          filter: s => s.structureType === STRUCTURE_CONTAINER,
        })[0] || null;

      if (container) {
        creep.memory.containerId = container.id;
      }
    }

    if (container) {
      if (!creep.pos.isEqualTo(container.pos)) {
        creep.travelTo(container);
        return;
      }
    } else {
      if (creep.pos.getRangeTo(source) > 1) {
        creep.travelTo(source);
        return;
      }
    }

    if (
      container &&
      container.hits < container.hitsMax * 0.5 &&
      creep.store[RESOURCE_ENERGY] > 0
    ) {
      creep.repair(container);
      return;
    }

    let site = null;

    if (!container) {
      if (creep.memory.containerSiteId) {
        site = Game.getObjectById(creep.memory.containerSiteId);
        if (!site) {
          delete creep.memory.containerSiteId;
        }
      }

      if (!site) {
        site =
          source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;

        if (site) {
          creep.memory.containerSiteId = site.id;
        }
      }
    }

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
