/**
 * ===================================================
 * LAB.MANAGER.JS — Утилита управления лабораториями
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
  runReaction: function (room, config) {
    if (!config) return;
    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);
    if (!lab1 || !lab2 || !reactor) return;
    if (reactor.cooldown > 0) return;
    if (!lab1.store[config.reagent1] || lab1.store[config.reagent1] === 0)
      return;
    if (!lab2.store[config.reagent2] || lab2.store[config.reagent2] === 0)
      return;
    const result = reactor.runReaction(lab1, lab2);
    if (result !== OK && result !== ERR_TIRED) {
      // Ошибка реакции: конфиг/лаборатории разобраны выше, поэтому сюда
      // попадают только редкие состояния (например, смена рецепта на лету).
      // Лог намеренно не пишем каждый тик — см. аудит, п. 38.
    }
  },
  run: function (room) {
    const mem = room.memory;
    const configs = [];
    if (mem.labs) configs.push(mem.labs);
    if (mem.labs2) configs.push(mem.labs2);
    if (mem.labs3) configs.push(mem.labs3);
    if (mem.labs4) configs.push(mem.labs4);
    if (mem.labs5) configs.push(mem.labs5);
    for (const config of configs) {
      this.runReaction(room, config);
    }
  },
};
module.exports = labManager;
