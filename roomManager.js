const factory = require("./factory");
const roleTower = require("./role.tower");

const roomManager = {
  run: function (room) {
    /**
     * =========================================
     * 0. ENERGY TARGETS
     * =========================================
     */
    if (!room.memory.energyTargets || Game.time % 10 === 0) {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });

      room.memory.energyTargets = energyTargets.map(s => s.id);
    }

    room._energyTargets = (room.memory.energyTargets || [])
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 1. БАШНИ
     * =========================================
     */
    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });

      room.memory.towers = towers.map(t => t.id);
    }

    room._towers = (room.memory.towers || [])
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 2. ИСТОЧНИКИ
     * =========================================
     */
    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }

    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    /**
     * =========================================
     * 3. КОНТЕЙНЕРЫ У ИСТОЧНИКОВ (С ВОССТАНОВЛЕНИЕМ)
     * =========================================
     */
    if (!room.memory.sourceContainers) {
      room.memory.sourceContainers = [];
    }

    room._sourceContainers = [];

    room._sources.forEach((source, index) => {
      let container = null;
      const containerId = room.memory.sourceContainers[index];

      // 1. Пытаемся взять из памяти
      if (containerId) {
        container = Game.getObjectById(containerId);
      }

      // 2. Если контейнера нет → пересканируем
      if (!container) {
        container =
          source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;

        // Обновляем память
        room.memory.sourceContainers[index] = container ? container.id : null;
      }

      room._sourceContainers[index] = container;
    });

    /**
     * =========================================
     * 4. ЛОКАЛЬНЫЙ ПЛАН
     * =========================================
     */
    let localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 4 },
      { role: "test_towerSupplier", count: 1 },
      { role: "test_builder", count: 1 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 1 },
    ];

    let globalRolesConfig = [];

    globalRolesConfig.push({ role: "test_attacker", count: 5 });

    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

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
     * 5. СПАВН
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
     * 6. БАШНИ
     * =========================================
     */
    const towers = room._towers;

    if (towers && towers.length) {
      towers.forEach(tower => roleTower.run(tower));
    }
  },
};

module.exports = roomManager;
