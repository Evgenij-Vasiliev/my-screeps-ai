/**
 * ПОДКЛЮЧЕНИЕ МОДУЛЕЙ
 */
const roleHarvester = require("./role.harvester");
const roleUpgrader = require("./role.upgrader");
const roleBuilder = require("./role.builder");
const roleRepairer = require("./role.repairer");

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
    { role: "test_harvester", count: 4 },
    { role: "test_builder", count: 4 }, // Поставил 4 для теста стройки контейнеров
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
        spawn.spawnCreep([WORK, CARRY, MOVE], `${roleData.role}_${Game.time}`, {
          memory: {
            role: roleData.role,
            sourceIndex: bestIndex,
            working: false,
          },
        });
        sourceUsage[bestIndex]++;
        break; // Один тик — один крип, чтобы не перегружать спавн
      }
    }
  }

  /**
   * 5. ЦИКЛ ЛОГИКИ (Brain Execution)
   * Теперь этот цикл перебирает ВСЕХ живых крипов, независимо от конфига выше.
   */
  for (let name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role === "test_harvester") roleHarvester.run(creep);
    if (creep.memory.role === "test_upgrader") roleUpgrader.run(creep);
    if (creep.memory.role === "test_builder") roleBuilder.run(creep);
    if (creep.memory.role === "test_repairer") roleRepairer.run(creep);
  }
};
