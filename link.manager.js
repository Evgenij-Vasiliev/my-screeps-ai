/**
 * МЕНЕДЖЕР ЛИНКОВ (Link Manager)
 * Не крип — утилита, запускается из room.manager каждый тик.
 *
 * Схема для всех комнат:
 *   Отправители (линки у источников) → Получатель (линк у storage)
 *
 * Для E35S37 дополнительно:
 *   Пограничные линки (от дальней добычи) → тоже в линк у storage
 *   Они перечислены в том же массиве senders — никакой разницы в логике.
 *
 * Настройка через консоль (один раз на каждую комнату):
 *   Memory.rooms['W1N1'].links = {
 *     storage: 'ID линка у storage',
 *     senders: ['ID линка у источника 1', 'ID линка у источника 2', ...]
 *   }
 *
 * Для E35S37 просто добавляем пограничные линки в тот же senders:
 *   Memory.rooms['E35S37'].links = {
 *     storage: 'ID',
 *     senders: ['ID источник 1', 'ID источник 2', 'ID граница 1', 'ID граница 2', 'ID граница 3']
 *   }
 */

module.exports = {
  run: function (room) {
    const config = (Memory.rooms[room.name] || {}).links;
    if (!config) return;

    const storageLink = config.storage
      ? Game.getObjectById(config.storage)
      : null;
    if (!storageLink) return;
    if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;

    // Все отправители передают в storage-линк независимо друг от друга
    for (const senderId of config.senders || []) {
      const sender = Game.getObjectById(senderId);
      if (!sender) continue; // линк уничтожен
      if (sender.store[RESOURCE_ENERGY] === 0) continue; // пустой
      if (sender.cooldown > 0) continue; // кулдаун

      sender.transferEnergy(storageLink);
    }
  },
};
