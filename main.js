/**
 * ПОДКЛЮЧЕНИЕ МОДУЛЕЙ
 */
const roles = {
  test_harvester: require("./role.harvester"),
  test_upgrader: require("./role.upgrader"),
  test_builder: require("./role.builder"),
  test_repairer: require("./role.repairer"),
  test_miner: require("./role.miner"),
  test_hauler: require("./role.hauler"),
  test_towerSupplier: require("./role.towerSupplier"),
};

const roleTower = require("./role.tower"); // Модуль для башен

module.exports.loop = function () {
  /**
   * 1. ОЧИСТКА ПАМЯТИ
   */
  for (let name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  /**
   * 2. ОТЧЕТ ПО ИСТОЧНИКАМ (Slot Booking)
   */
  let sourceUsage = { 0: 0, 1: 0 };
  for (let name in Game.creeps) {
    let creep = Game.creeps[name];
    if (creep.memory.sourceIndex !== undefined) {
      sourceUsage[creep.memory.sourceIndex]++;
    }
  }

  /**
   * 3. ПЛАН НАСЕЛЕНИЯ
   */
  const rolesConfig = [
    { role: "test_harvester", count: 1 },
    { role: "test_miner", count: 2 },
    { role: "test_hauler", count: 4 },
    { role: "test_towerSupplier", count: 2 },
    { role: "test_builder", count: 0 },
    { role: "test_upgrader", count: 1 },
    { role: "test_repairer", count: 1 },
  ];

  /**
   * 4. ЦИКЛ СПАВНА
   */
  for (let roleData of rolesConfig) {
    const creepsWithRole = _.filter(
      Game.creeps,
      c => c.memory.role === roleData.role,
    );

    if (creepsWithRole.length < roleData.count) {
      const spawn = Game.spawns["Spawn5"];
      if (spawn && !spawn.spawning) {
        const bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;

        let body = [WORK, CARRY, MOVE];
        let memory = {
          role: roleData.role,
          sourceIndex: bestIndex,
          working: false,
        };

        if (roleData.role === "test_miner") {
          body = [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE];
          const sources = spawn.room.find(FIND_SOURCES);
          if (sources[bestIndex]) {
            memory.sourceId = sources[bestIndex].id;
          }
        }

        if (
          roleData.role === "test_hauler" ||
          roleData.role === "test_towerSupplier"
        ) {
          body = [CARRY, CARRY, MOVE, MOVE];
        }

        spawn.spawnCreep(body, `${roleData.role}_${Game.time}`, {
          memory: memory,
        });

        sourceUsage[bestIndex]++;
        break;
      }
    }
  }

  /**
   * 5. ЦИКЛ ЛОГИКИ КРИПОВ (Рефакторинг: используем объект roles)
   */
  for (let name in Game.creeps) {
    const creep = Game.creeps[name];
    const roleName = creep.memory.role;
    if (roles[roleName]) {
      roles[roleName].run(creep);
    }
  }

  /**
   * 6. ЛОГИКА БАШЕН
   */
  const towers = _.filter(
    Game.structures,
    s => s.structureType === STRUCTURE_TOWER,
  );
  for (const tower of towers) {
    roleTower.run(tower);
  }
};
