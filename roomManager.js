const factory = require("./factory");
const roleTower = require("./role.tower");

const roomManager = {
  run: function (room) {
    // 1. ПЛАН НАСЕЛЕНИЯ
    const rolesConfig = room.memory.rolesConfig || [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 2 },
      { role: "test_builder", count: 2 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 1 },
    ];

    // 2. ОТЧЕТ ПО КРИПАМ КОМНАТЫ
    const roomCreeps = room.find(FIND_MY_CREEPS);
    const creepsByRole = _.groupBy(roomCreeps, c => c.memory.role);

    let sourceUsage = { 0: 0, 1: 0 };
    roomCreeps.forEach(c => {
      if (c.memory.sourceIndex !== undefined)
        sourceUsage[c.memory.sourceIndex]++;
    });

    // 3. УПРАВЛЕНИЕ СПАВНОМ
    const spawn = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning })[0];

    if (spawn) {
      // ИСПРАВЛЕНИЕ: Находим массив минералов и берем первый объект
      const minerals = room.find(FIND_MINERALS);
      const mineral = minerals.length > 0 ? minerals[0] : null;

      // ИСПРАВЛЕНИЕ: Используем корректное свойство mineralAmount
      const mineralAvailable = mineral && mineral.mineralAmount > 0;

      for (let roleData of rolesConfig) {
        let targetCount = roleData.count;

        // Если это сборщик минералов, но их нет — обнуляем план
        if (roleData.role === "test_mineralMiner" && !mineralAvailable) {
          targetCount = 0;
        }

        const currentCount = (creepsByRole[roleData.role] || []).length;

        if (currentCount < targetCount) {
          const bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;
          const result = factory.run(spawn, roleData, bestIndex);

          if (result === OK) {
            sourceUsage[bestIndex]++;
            break;
          }
        }
      }
    }

    // 4. УПРАВЛЕНИЕ БАШНЯМИ
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });
    towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
