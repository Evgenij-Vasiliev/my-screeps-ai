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
    // Безопасное чтение конфига: Memory.rooms может быть не инициализирован,
    // а links — отсутствовать или быть не-объектом (ручная правка/битая запись).
    const roomMemory = (Memory.rooms && Memory.rooms[roomState.roomName]) || {};
    const config = roomMemory.links;
    if (!config || typeof config !== "object") return;

    const storageLink =
      typeof config.storage === "string"
        ? Game.getObjectById(config.storage)
        : null;
    if (!storageLink) return;
    if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;

    const senders = Array.isArray(config.senders) ? config.senders : [];
    for (const senderId of senders) {
      const sender = Game.getObjectById(senderId);
      if (!sender) continue; // линк уничтожен
      if (sender.store[RESOURCE_ENERGY] === 0) continue; // пустой
      if (sender.cooldown > 0) continue; // кулдаун

      // Нештатный код возврата (полный приёмник, чужой ресурс, снесённый
      // линк) — штатное состояние тика: следующий тик либо условия изменятся,
      // либо линк исчезнет из конфига. Раньше здесь печаталась строка на
      // каждый такой линк КАЖДЫЙ тик — прямой расход CPU в горячем пути.
      sender.transferEnergy(storageLink);
    }
  },
};
