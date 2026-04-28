/**
 * ===================================================
 * ROLEREGISTRY.JS — Реестр ролей крипов
 * ===================================================
 * Этот файл — простой словарь: имя роли → модуль с логикой.
 *
 * Как используется:
 * В main.js: const roleModule = roles[creep.memory.role]
 * Затем:     roleModule.run(creep)
 *
 * Чтобы добавить новую роль:
 * 1. Создай файл role.НоваяРоль.js с методом run(creep)
 * 2. Добавь строку: test_НоваяРоль: require("./role.НоваяРоль")
 * 3. Добавь роль в blueprints в factory.js
 * 4. Добавь роль в localRolesConfig или globalRolesConfig в roomManager.js
 * ===================================================
 */

module.exports = {
  // --- Базовые роли ---
  test_harvester: require("./role.harvester"), // Копает и несёт энергию сам
  test_miner: require("./role.miner"), // Сидит у источника, только копает
  test_hauler: require("./role.hauler"), // Возит энергию из контейнеров
  test_upgrader: require("./role.upgrader"), // Улучшает контроллер
  test_builder: require("./role.builder"), // Строит конструкции
  test_repairer: require("./role.repairer"), // Чинит дороги и контейнеры
  test_towerSupplier: require("./role.towerSupplier"), // Заряжает башни энергией
  test_mineralMiner: require("./role.mineralMiner"), // Добывает минералы

  // --- Удалённые операции ---
  test_remoteMiner: require("./role.remoteMiner"), // Майнер в соседней комнате
  test_remoteHauler: require("./role.remoteHauler"), // Перевозчик из соседней комнаты
  test_reserver: require("./role.reserver"), // Резервирует контроллер соседней комнаты

  // --- Военные ---
  test_attacker: require("./role.attacker"), // Боевой крип
};
