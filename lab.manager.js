/**
 * ===================================================
 * LABMANAGER.JS — Утилита управления лабораториями
 * ===================================================
 * Запускается из roomManager каждый тик.
 * НЕ крип — просто запускает реакцию в реакторах.
 *
 * Поддерживает несколько троек лаб в одной комнате.
 * Конфиги хранятся в памяти комнаты:
 *   Memory.rooms['E35S37'].labs  — первая тройка
 *   Memory.rooms['E35S37'].labs2 — вторая тройка
 *   Memory.rooms['E35S37'].labs3 — третья тройка
 *   и так далее...
 *
 * Настройка через консоль:
 *   Memory.rooms['E35S37'].labs2 = {
 *     lab1: 'ID',
 *     lab2: 'ID',
 *     reactor: 'ID',
 *     reagent1: 'KH',
 *     reagent2: 'O',
 *     product: 'KHO2'
 *   }
 * ===================================================
 */

const labManager = {
  /**
   * Запускает реакцию для одной тройки лаб.
   * @param {Room} room — комната
   * @param {object} config — конфиг тройки
   * @param {string} label — метка для лога (labs, labs2...)
   */
  runReaction: function (room, config, label) {
    if (!config) return;

    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);

    if (!lab1 || !lab2 || !reactor) return;

    // Реактор на кулдауне — ждём
    if (reactor.cooldown > 0) return;

    // Проверяем что в лабах есть реагенты
    if (!lab1.store[config.reagent1] || lab1.store[config.reagent1] === 0)
      return;
    if (!lab2.store[config.reagent2] || lab2.store[config.reagent2] === 0)
      return;

    // Запускаем реакцию
    const result = reactor.runReaction(lab1, lab2);
    if (result !== OK && result !== ERR_TIRED) {
      // console.log(
      //   `[LabManager ${room.name}] [${label}] Ошибка реакции ${config.product}: ${result}`,
      // );
    }
  },

  /**
   * Основной запуск — перебирает все тройки лаб в комнате.
   */
  run: function (room) {
    const mem = room.memory;

    // Перебираем все конфиги: labs, labs2, labs3...
    // labs всегда первый, затем labs2, labs3 и т.д.
    const configs = [];
    if (mem.labs) configs.push({ config: mem.labs, label: "labs" });
    if (mem.labs2) configs.push({ config: mem.labs2, label: "labs2" });
    if (mem.labs3) configs.push({ config: mem.labs3, label: "labs3" });
    if (mem.labs4) configs.push({ config: mem.labs4, label: "labs4" });
    if (mem.labs5) configs.push({ config: mem.labs5, label: "labs5" });

    for (const { config, label } of configs) {
      this.runReaction(room, config, label);
    }
  },
};

module.exports = labManager;
