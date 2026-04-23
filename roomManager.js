const factory = require("./factory");
const roleTower = require("./role.tower");

const roomManager = {
  run: function (room) {
    // 1. ЛОКАЛЬНЫЙ ПЛАН (Крипы, которые работают ТОЛЬКО внутри этой комнаты)
    let localRolesConfig = [
      { role: "test_harvester", count: 1 },
      { role: "test_miner", count: 2 },
      { role: "test_hauler", count: 2 },
      { role: "test_towerSupplier", count: 2 },
      { role: "test_builder", count: 2 },
      { role: "test_upgrader", count: 1 },
      { role: "test_repairer", count: 1 },
      { role: "test_mineralMiner", count: 1 },
    ];

    // 2. ГЛОБАЛЬНЫЙ ПЛАН (Крипы, которые уходят из комнат и считаются по всей империи)
    let globalRolesConfig = [];

    // Аттакеры — всего 5 штук на все 5 комнат
    globalRolesConfig.push({ role: "test_attacker", count: 5 });

    // Триада экспансии — заказывается только в E35S37, но считается ГЛОБАЛЬНО
    if (room.name === "E35S37") {
      globalRolesConfig.push({ role: "test_reserver", count: 2 });
      globalRolesConfig.push({ role: "test_remoteMiner", count: 2 });
      globalRolesConfig.push({ role: "test_remoteHauler", count: 2 }); // Те самые самосвалы
    }

    // 3. ПОДСЧЕТ (Локальный vs Глобальный)
    const allCreeps = Object.values(Game.creeps);
    const roomCreeps = room.find(FIND_MY_CREEPS);

    const globalGroups = _.groupBy(allCreeps, c => c.memory.role);
    const localGroups = _.groupBy(roomCreeps, c => c.memory.role);

    // Баланс источников внутри комнаты
    let sourceUsage = { 0: 0, 1: 0 };
    roomCreeps.forEach(c => {
      if (c.memory.sourceIndex !== undefined)
        sourceUsage[c.memory.sourceIndex]++;
    });

    // 4. УПРАВЛЕНИЕ СПАВНОМ
    const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
    const spawn = spawns[0];

    if (spawn) {
      // Объединяем оба списка для проверки
      const fullConfig = [...localRolesConfig, ...globalRolesConfig];

      for (let roleData of fullConfig) {
        // Определяем, считать ли крипа по всему миру или только в комнате
        const isGlobal = globalRolesConfig.some(r => r.role === roleData.role);

        const currentCount = isGlobal
          ? (globalGroups[roleData.role] || []).length
          : (localGroups[roleData.role] || []).length;

        if (currentCount < roleData.count) {
          // Выбираем менее загруженный источник
          const bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;
          const result = factory.run(spawn, roleData, bestIndex);
          if (result === OK) break; // За тик спавним только одного
        }
      }
    }

    // 5. БАШНИ
    const towers = room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_TOWER,
    });
    towers.forEach(tower => roleTower.run(tower));
  },
};

module.exports = roomManager;
