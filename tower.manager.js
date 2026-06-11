module.exports = {
  run: function (room) {
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });

    for (const tower of towers) {
      this._runTower(tower, room);
    }
  },

  _runTower: function (tower, room) {
    if (!tower || tower.store[RESOURCE_ENERGY] === 0) return;

    // 1. Атака врагов
    const hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (hostile) {
      tower.attack(hostile);
      return;
    }

    // 2. Лечение раненых союзников
    const wounded = room.find(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax,
    })[0];
    if (wounded) {
      tower.heal(wounded);
      return;
    }

    // 3. Ремонт стен/рампартов с постепенным повышением порога
    if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {};
    const threshold = Memory.rooms[room.name].wallThreshold || 1000;

    const weakWall = room
      .find(FIND_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART) &&
          s.hits < threshold,
      })
      .sort((a, b) => a.hits - b.hits)[0];

    if (weakWall) {
      tower.repair(weakWall);
      return;
    } else {
      // Все стены достигли порога — повышаем
      Memory.rooms[room.name].wallThreshold = threshold + 1000;
    }

    // 4. Ремонт повреждённых зданий (кроме стен)
    const damaged = room
      .find(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      })
      .sort((a, b) => a.hits - b.hits)[0];

    if (damaged) {
      tower.repair(damaged);
    }
  },
};
