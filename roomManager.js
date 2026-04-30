const factory = require("./factory");
const roleTower = require("./role.tower");

const REMOTE_ROOMS = ["E35S38", "E36S37"];

const roomManager = {
  run: function (room) {
    {
      const energyTargets = room.find(FIND_MY_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_SPAWN) &&
          s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      });
      room.memory.energyTargets = energyTargets.map(s => s.id);
      room._energyTargets = energyTargets;
    }

    if (!room.memory.towers || Game.time % 50 === 0) {
      const towers = room.find(FIND_MY_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
      });
      room.memory.towers = towers.map(t => t.id);
    }

    room._towers = (room.memory.towers || [])
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    if (!room.memory.sources) {
      const sources = room.find(FIND_SOURCES);
      room.memory.sources = sources.map(s => s.id);
    }

    room._sources = room.memory.sources
      .map(id => Game.getObjectById(id))
      .filter(obj => obj);

    if (!room.memory.sourceContainers) {
      room.memory.sourceContainers = [];
    }

    room._sourceContainers = [];

    room._sources.forEach((source, index) => {
      let container = null;
      const containerId = room.memory.sourceContainers[index];

      if (containerId) {
        container = Game.getObjectById(containerId);
      }

      if (!container) {
        container =
          source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER,
          })[0] || null;

        room.memory.sourceContainers[index] = container ? container.id : null;
      }

      room._sourceContainers[index] = container;
    });

    if (!room.memory.mineralId || Game.time % 100 === 0) {
      const minerals = room.find(FIND_MINERALS);
      room.memory.mineralId = minerals.length > 0 ? minerals[0].id : null;
    }

    const mineral = room.memory.mineralId
      ? Game.getObjectById(room.memory.mineralId)
      : null;

    const mineralAvailable = mineral && mineral.amount > 0;
    const attackerCount = room.name === "E35S37" ? 0 : 1;
    const needsUpgrader =
      room.controller && room.controller.ticksToDowngrade < 100000 ? 1 : 0;
    const hasSites = room.find(FIND_CONSTRUCTION_SITES).length > 0;

    const needsRepair =
      room.find(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax * 0.8 &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      }).length > 0;

    const localRolesConfig = [
      { role: "test_harvester", count: 3 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 1 },
      { role: "test_builder", count: hasSites ? 1 : 0 },
      { role: "test_upgrader", count: needsUpgrader },
      { role: "test_repairer", count: needsRepair ? 1 : 0 },
      { role: "test_mineralMiner", count: mineralAvailable ? 2 : 0 },
    ];

    const globalRolesConfig = [];

    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 });
    }

    const allCreeps = [];
    for (const name in Game.creeps) {
      allCreeps.push(Game.creeps[name]);
    }

    const roomCreeps = room.find(FIND_MY_CREEPS);

    const globalGroups = _.groupBy(allCreeps, c => c.memory.role);
    const localGroups = _.groupBy(roomCreeps, c => c.memory.role);

    const attackersHere = allCreeps.filter(
      c => c.memory.role === "test_attacker" && c.memory.homeRoom === room.name,
    ).length;

    const sourceUsage = {};
    room._sources.forEach((_, index) => {
      sourceUsage[index] = 0;
    });

    // ИСПРАВЛЕНИЕ: добавлен test_harvester в подсчёт sourceUsage.
    // Раньше харвестеры спавнились первыми, но не учитывались в балансировке —
    // sourceUsage всегда был {0:0, 1:0} при их спавне, и все три шли к источнику 0.
    roomCreeps.forEach(c => {
      if (
        (c.memory.role === "test_miner" ||
          c.memory.role === "test_hauler" ||
          c.memory.role === "test_harvester") &&
        c.memory.sourceIndex !== undefined &&
        sourceUsage[c.memory.sourceIndex] !== undefined
      ) {
        sourceUsage[c.memory.sourceIndex]++;
      }
    });

    const spawns = room.find(FIND_MY_SPAWNS, {
      filter: s => !s.spawning,
    });

    const spawn = spawns[0];

    if (spawn) {
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      if (attackerCount > 0 && attackersHere < attackerCount) {
        const result = factory.run(spawn, { role: "test_attacker" }, 0);
        if (result === OK) {
          if (room._towers && room._towers.length > 0) {
            room._towers.forEach(tower => roleTower.run(tower));
          }
          return;
        }
      }

      for (const roleData of fullConfig) {
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);

        const currentCount = isGlobal
          ? (globalGroups[roleData.role] || []).length
          : (localGroups[roleData.role] || []).length;

        if (currentCount < roleData.count) {
          const bestIndex = Number(
            Object.entries(sourceUsage).sort((a, b) => a[1] - b[1])[0][0],
          );

          const remoteRoles = [
            "test_remoteMiner",
            "test_remoteHauler",
            "test_reserver",
          ];
          if (remoteRoles.includes(roleData.role)) {
            const taken = allCreeps
              .filter(
                c =>
                  c.memory.role === roleData.role &&
                  (c.memory.target || c.memory.targetRoom),
              )
              .map(c => c.memory.target || c.memory.targetRoom);

            const freeRoom = REMOTE_ROOMS.find(r => !taken.includes(r));
            roleData.targetRoom = freeRoom || REMOTE_ROOMS[0];
          }

          const result = factory.run(spawn, roleData, bestIndex);

          if (result === OK) break;
        }
      }
    }

    if (room._towers && room._towers.length > 0) {
      room._towers.forEach(tower => roleTower.run(tower));
    }
  },
};

module.exports = roomManager;
