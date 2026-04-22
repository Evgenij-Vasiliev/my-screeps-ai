module.exports = {
  run: function (tower) {
    if (!tower || !tower.room) return;

    const room = tower.room;
    const energy = tower.store[RESOURCE_ENERGY] || 0;
    const capacity = tower.store.getCapacity(RESOURCE_ENERGY) || 0;
    const energyThreshold = capacity * 0.7;

    // === 0. Проверка принудительной цели ===
    if (room.memory.towerTargetId) {
      const target = Game.getObjectById(room.memory.towerTargetId);
      if (target) {
        // Если это враг
        if (target instanceof Creep && !target.my) {
          tower.attack(target);
          return;
        }
        // Если союзный крип — лечим
        if (target instanceof Creep && target.my) {
          tower.heal(target);
          return;
        }
        // Если структура — чиним
        if (target instanceof Structure && target.hits < target.hitsMax) {
          tower.repair(target);
          return;
        }
      } else {
        // Если цель исчезла — очищаем память
        delete room.memory.towerTargetId;
      }
    }

    // === 1. Атака вражеских крипов ===
    const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (closestHostile) {
      tower.attack(closestHostile);
      return;
    }

    // === 2. Лечение союзных крипов ===
    const woundedAlly = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax,
    });
    if (woundedAlly) {
      tower.heal(woundedAlly);
      return;
    }

    // === 3. Ремонт обычных построек ===
    if (energy > energyThreshold) {
      const targets = room.find(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      });

      if (targets.length > 0) {
        targets.sort((a, b) => a.hits - b.hits);
        tower.repair(targets[0]);
        return;
      }
    }

    // === 4. Ремонт стен и валов ===
    if (energy > energyThreshold) {
      const wallThreshold = room.memory.wallThreshold || 1000;

      const weakWalls = room.find(FIND_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART) &&
          s.hits < wallThreshold,
      });

      if (weakWalls.length > 0) {
        weakWalls.sort((a, b) => a.hits - b.hits);
        tower.repair(weakWalls[0]);
      } else {
        room.memory.wallThreshold = wallThreshold + 1000;
      }
    }
  },
};
