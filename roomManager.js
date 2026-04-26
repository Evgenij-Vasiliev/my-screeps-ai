const factory = require("./factory");
const roleTower = require("./role.tower");

const roomManager = {
  run: function (room) {
    /**
     * =========================================
     * 0. КЭШ ENERGY TARGETS (БЕЗ БАШЕН)
     * =========================================
     */

    // Обновляем редко (TTL)
    if (!room.memory.energyTargets || Game.time % 10 === 0) {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          // ОСТАВЛЯЕМ ТОЛЬКО:
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      // Сохраняем только ID
      room.memory.energyTargets = energyTargets.map(s => s.id);
    }

    // Runtime-кэш (каждый тик!)
    room._energyTargets = (room.memory.energyTargets || [])
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 1. ЛОКАЛЬНЫЙ ПЛАН
     * =========================================
     */
    let localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 2 },
      { role: "test_builder", count: 1 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 0 },
    ];

    /**
     * =========================================
     * 2. ГЛОБАЛЬНЫЙ ПЛАН
     * =========================================
     */
    let globalRolesConfig = [];

    globalRolesConfig.push({ role: "test_attacker", count: 0 });

    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 0 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 0 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 0 });
    }

    /**
     * =========================================
     * 3. ПОДСЧЕТ КРИПОВ
     * =========================================
     */
    const allCreeps = Object.values(Game.creeps);
    const roomCreeps = room.find(FIND_MY_CREEPS);

    const globalGroups = _.groupBy(allCreeps, c => c.memory.role);
    const localGroups = _.groupBy(roomCreeps, c => c.memory.role);

    let sourceUsage = { 0: 0, 1: 0 };

    roomCreeps.forEach(c => {
      if (c.memory.sourceIndex !== undefined) {
        sourceUsage[c.memory.sourceIndex]++;
      }
    });

    /**
     * =========================================
     * 4. СПАВН
     * =========================================
     */
    const spawns = room.find(FIND_MY_SPAWNS, {
      filter: s => !s.spawning,
    });

    const spawn = spawns[0];

    if (spawn) {
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (let roleData of fullConfig) {
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);

        const currentCount = isGlobal
          ? (globalGroups[roleData.role] || []).length
          : (localGroups[roleData.role] || []).length;

        if (currentCount < roleData.count) {
          const bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;

          const result = factory.run(spawn, roleData, bestIndex);

          if (result === OK) break;
        }
      }
    }

    /**
     * =========================================
     * 5. БАШНИ (работают отдельно!)
     * =========================================
     */
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });

    towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
