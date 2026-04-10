/**
 * ПОДКЛЮЧЕНИЕ МОДУЛЕЙ
 */
const roleHarvester = require("./role.harvester");
const roleUpgrader = require("./role.upgrader");
const roleBuilder = require("./role.builder");
const roleRepairer = require("./role.repairer");

module.exports.loop = function () {
  /**
   * ОЧИСТКА ПАМЯТИ (Garbage Collection)
   */
  for (let name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  /**
   * ПРОВЕРКА ЗАНЯТОСТИ ИСТОЧНИКОВ (Slot Booking)
   * Мы создаем отчет: сколько крипов уже закреплено за каждым источником.
   */
  let sourceUsage = { 0: 0, 1: 0 };

  for (let name in Game.creeps) {
    let creep = Game.creeps[name];
    // Если у крипа в памяти уже есть номер источника, учитываем его в отчете
    if (creep.memory.sourceIndex !== undefined) {
      sourceUsage[creep.memory.sourceIndex]++;
    }
  }

  /**
   * ПЛАН НАСЕЛЕНИЯ (Roles Config)
   */
  const rolesConfig = [
    { role: "test_harvester", count: 8 },
    { role: "test_upgrader", count: 0 },
    { role: "test_builder", count: 0 },
    { role: "test_repairer", count: 0 },
  ];

  /**
   * ОСНОВНОЙ ЦИКЛ УПРАВЛЕНИЯ
   */
  _.forEach(rolesConfig, roleData => {
    // 1. Считаем, сколько живых крипов этой роли сейчас в игре
    const creepsWithRole = _.filter(
      Game.creeps,
      creep => creep.memory.role === roleData.role,
    );

    // 2. АВТОСПАВН: Если крипов меньше, чем нужно по плану
    if (creepsWithRole.length < roleData.count) {
      // ВЫБОР ЛУЧШЕГО ИСТОЧНИКА:
      // Если на нулевом меньше или столько же людей, чем на первом — выбираем 0, иначе 1.
      let bestIndex = sourceUsage[0] <= sourceUsage[1] ? 0 : 1;

      // ЗАКАЗ КРИПА:
      Game.spawns["Spawn5"].spawnCreep(
        [WORK, CARRY, MOVE],
        `${roleData.role}_${Game.time}`,
        {
          memory: {
            role: roleData.role,
            working: false,
            // Передаем выбранный индекс в память новорожденному
            sourceIndex: bestIndex,
          },
        },
      );

      // Важно: сразу обновляем наш отчет, чтобы следующий крип в этом же тике
      // (если он будет) увидел актуальную нагрузку.
      sourceUsage[bestIndex]++;
    }

    /**
     * 3. ЗАПУСК ЛОГИКИ (Brain Execution)
     */
    _.forEach(creepsWithRole, creep => {
      if (creep.memory.role === "test_harvester") {
        roleHarvester.run(creep);
      } else if (creep.memory.role === "test_upgrader") {
        roleUpgrader.run(creep);
      } else if (creep.memory.role === "test_builder") {
        roleBuilder.run(creep);
      } else if (creep.memory.role === "test_repairer") {
        roleRepairer.run(creep);
      }
    });
  });
};
