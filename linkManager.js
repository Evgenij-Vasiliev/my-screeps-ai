/**
 * МЕНЕДЖЕР ЛИНКОВ (Link Manager)
 * Не крип — утилита, запускается из main.js каждый тик для каждой комнаты.
 *
 * Схема (одинаковая для всех комнат, включая E35S37 с дальней добычей):
 *   Отправители (senders: линки у источников + пограничные линки дальней добычи)
 *   → Получатель (storage-линк)
 *
 * Формат Memory (уже настроен вручную, не менять):
 *   Memory.rooms['XXX'].links = {
 *     storage: 'ID линка у storage',
 *     senders: ['ID', 'ID', ...]
 *   }
 */
module.exports = {
  run: function (roomState) {
    const config = (Memory.rooms[roomState.roomName] || {}).links;
    if (!config) return;

    const storageLink = config.storage
      ? Game.getObjectById(config.storage)
      : null;
    if (!storageLink) return;
    if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;

    for (const senderId of config.senders || []) {
      const sender = Game.getObjectById(senderId);
      if (!sender) continue; // линк уничтожен
      if (sender.store[RESOURCE_ENERGY] === 0) continue; // пустой
      if (sender.cooldown > 0) continue; // кулдаун
      sender.transferEnergy(storageLink);
    }
  },
};
