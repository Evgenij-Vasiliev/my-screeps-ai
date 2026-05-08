/**
 * ===================================================
 * ROLE.LABMANAGER.JS — Утилита управления лабораториями
 * ===================================================
 * Запускается из roomManager каждый тик.
 * НЕ крип — просто запускает реакцию в реакторе.
 *
 * Логика:
 * - Лаб1 и Лаб2 содержат реагенты (загружает labWorker)
 * - Реактор запускает runReaction каждые 10 тиков
 *
 * Настройка через память комнаты (уже сделано):
 *   Memory.rooms['E35S37'].labs = {
 *     lab1: 'ID',
 *     lab2: 'ID',
 *     reactor: 'ID',
 *     reagent1: 'Z',
 *     reagent2: 'K',
 *     product: 'ZK'
 *   }
 * ===================================================
 */

const labManager = {
  run: function (room) {
    const config = room.memory.labs;
    if (!config) return;

    // Получаем объекты лаб из кэша
    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);

    if (!lab1 || !lab2 || !reactor) return;

    // Реактор на кулдауне — ждём
    if (reactor.cooldown > 0) return;

    // Проверяем что в лабах есть реагенты
    if (lab1.store[config.reagent1] === 0) return;
    if (lab2.store[config.reagent2] === 0) return;

    // Запускаем реакцию
    const result = reactor.runReaction(lab1, lab2);
    if (result !== OK && result !== ERR_TIRED) {
      console.log(
        `[LabManager ${room.name}] Ошибка реакции ${config.product}: ${result}`,
      );
    }
  },
};

module.exports = labManager;
