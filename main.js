/**
 * ПОДКЛЮЧЕНИЕ МОДУЛЕЙ
 */
const roleHarvester = require("./role.harvester");
const roleUpgrader = require("./role.upgrader");
const roleBuilder = require("./role.builder");
const roleRepairer = require("./role.repairer");
const roleMiner = require("./role.miner"); // 1. ПОДКЛЮЧАЕМ НОВЫЙ МОДУЛЬ

module.exports.loop = function () {
  /**
   * 1. ОЧИСТКА ПАМЯТИ
   */
  for (let name in Memory.creeps) {
    if (!Game.creeps) {
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
    // 2. ДОБАВЛЯЕМ МАЙНЕРОВ В ПЛАН (пока 2, по одному на источник)
    { role: "test_miner", count: 2 },
    { role: "test_harvester", count: 4 },
    { role: "test_builder", count: 4 },
    { role: "test_upgrader", count: 1 },
    { role: "test_repairer", count: 1 },
  ];

  /**
   * 4. ЦИКЛ СПАВНА (Автоматизация)
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

        // 3. ОПРЕДЕЛЯЕМ ТЕЛО И ПАМЯТЬ ДЛЯ МАЙНЕРА
        // Если роль - майнер, даем ему 5 WORK (как мы обсуждали). Иначе - стандартное тело.
        let body = [WORK, CARRY, MOVE];
        let memory = {
          role: roleData.role,
          sourceIndex: bestIndex,
          working: false,
        };

        if (roleData.role === "test_miner") {
          body = [WORK, WORK, WORK, WORK, WORK, MOVE];
          // Для майнера важно найти ID источника прямо сейчас
          const sources = spawn.room.find(FIND_SOURCES);
          memory.sourceId = sources[bestIndex].id;
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
   * 5. ЦИКЛ ЛОГИКИ
   */
  for (let name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role === "test_harvester") roleHarvester.run(creep);
    if (creep.memory.role === "test_upgrader") roleUpgrader.run(creep);
    if (creep.memory.role === "test_builder") roleBuilder.run(creep);
    if (creep.memory.role === "test_repairer") roleRepairer.run(creep);
    if (creep.memory.role === "test_miner") roleMiner.run(creep); // 4. ЗАПУСКАЕМ МОЗГ МАЙНЕРА
  }
};
