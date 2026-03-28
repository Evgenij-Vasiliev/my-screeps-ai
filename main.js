/**
 * ПОДКЛЮЧЕНИЕ МОДУЛЕЙ
 * Каждая роль вынесена в отдельный файл для удобства редактирования
 */
const roleHarvester = require("./role.harvester");
const roleUpgrader = require("./role.upgrader");
const roleBuilder = require("./role.builder");
const roleRepairer = require("./role.repairer");

module.exports.loop = function () {
  /**
   * ОЧИСТКА ПАМЯТИ (Garbage Collection)
   * Удаляем данные умерших крипов, чтобы не раздувать Memory.creeps
   */
  for (let name in Memory.creeps) {
    if (!Game.creeps[name]) {
      delete Memory.creeps[name];
    }
  }

  /**
   * ПЛАН НАСЕЛЕНИЯ (Roles Config)
   * Здесь мы задаем "Госплан": какую роль и в каком количестве нам нужно держать в комнате
   */
  const rolesConfig = [
    { role: "test_harvester", count: 1 },
    { role: "test_upgrader", count: 1 },
    { role: "test_builder", count: 1 },
    { role: "test_repairer", count: 1 },
  ];

  /**
   * ОСНОВНОЙ ЦИКЛ УПРАВЛЕНИЯ
   * Проходим по каждой роли из нашего плана
   */
  _.forEach(rolesConfig, roleData => {
    // 1. Считаем, сколько живых крипов этой роли сейчас в игре
    const creepsWithRole = _.filter(
      Game.creeps,
      creep => creep.memory.role === roleData.role,
    );

    // 2. АВТОСПАВН: Если план не выполнен — заказываем нового крипа
    if (creepsWithRole.length < roleData.count) {
      Game.spawns["Spawn5"].spawnCreep(
        [WORK, CARRY, MOVE], // Тело крипа
        `${roleData.role}_${Game.time}`, // Уникальное имя (Роль + Время)
        {
          memory: {
            role: roleData.role,
            working: false, // Начальное состояние — "готов к работе"
          },
        },
      );
    }

    /**
     * 3. ЗАПУСК ЛОГИКИ (Brain Execution)
     * Для каждого найденного крипа вызываем соответствующий модуль поведения
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
