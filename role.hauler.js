const roleHauler = {
  run: function (creep) {
    // --- Переключение режима ---
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 сбор");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 везу");
    }

    // === РЕЖИМ СБОРА: берём из контейнера у источника ===
    if (!creep.memory.working) {
      const sources = creep.room._sources || creep.room.find(FIND_SOURCES);
      const containers = creep.room._sourceContainers || [];

      const myContainer = containers[creep.memory.sourceIndex] || null;
      const mySource = sources[creep.memory.sourceIndex] || sources[0];

      // Сначала проверяем выпавшую энергию рядом с источником
      if (mySource) {
        const dropped = mySource.pos.findInRange(FIND_DROPPED_RESOURCES, 2, {
          filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50,
        })[0];

        if (dropped) {
          if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, {
              reusePath: 5,
              visualizePathStyle: { stroke: "#ffff00" },
            });
          }
          return;
        }
      }

      // Берём из контейнера
      if (myContainer && myContainer.store[RESOURCE_ENERGY] > 50) {
        if (creep.withdraw(myContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(myContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      creep.say("⏳ жду");
      return;
    }

    // === РЕЖИМ ДОСТАВКИ: только Storage ===
    // Хаулер отвечает за наполнение Storage.
    // Spawn/Extensions — задача harvester'а.
    // Storage → башни/экстеншены — задача towerSupplier'а.

    const storage = creep.room.storage;

    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      const result = creep.transfer(storage, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
      return;
    }

    // Storage полон — отдаём в Spawn/Extensions чтобы не простаивать
    const spawnTargets = creep.room._energyTargets;
    if (spawnTargets && spawnTargets.length > 0) {
      const target = creep.pos.findClosestByRange(spawnTargets);
      if (target) {
        const result = creep.transfer(target, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
        return;
      }
    }

    creep.say("😴 всё полно");
  },
};

module.exports = roleHauler;
