// Минимальный заряд башни для ремонта (0.0 — 1.0)
// Ниже этого порога башня НЕ тратит энергию на ремонт — держит резерв для атаки
// Менять здесь в коде: например 0.5 = ремонт только если заряд > 50%
const REPAIR_MIN_RATIO = 0.8;

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

    // 1. Атака врагов — всегда, без ограничений
    const hostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (hostile) {
      tower.attack(hostile);
      return;
    }

    // 2. Лечение раненых союзников — всегда, без ограничений
    const wounded = room.find(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax,
    })[0];
    if (wounded) {
      tower.heal(wounded);
      return;
    }

    // 3. Ремонт — только если заряд выше минимального порога
    const charge =
      tower.store[RESOURCE_ENERGY] / tower.store.getCapacity(RESOURCE_ENERGY);
    if (charge < REPAIR_MIN_RATIO) return;

    // Ремонт стен/рампартов с постепенным повышением порога прочности
    if (!Memory.rooms[room.name]) Memory.rooms[room.name] = {};
    const wallThreshold = Memory.rooms[room.name].wallThreshold || 1000;

    const weakWall = room
      .find(FIND_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART) &&
          s.hits < wallThreshold,
      })
      .sort((a, b) => a.hits - b.hits)[0];

    if (weakWall) {
      tower.repair(weakWall);
      return;
    } else {
      Memory.rooms[room.name].wallThreshold = wallThreshold + 1000;
    }

    // Ремонт повреждённых зданий (кроме стен)
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
