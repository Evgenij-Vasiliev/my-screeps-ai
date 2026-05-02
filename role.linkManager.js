/**
 * ===================================================
 * ROLE.LINKMANAGER.JS — Менеджер линков
 * ===================================================
 * Запускается из roomManager каждый тик.
 * Не крип — это утилита которая управляет линками комнаты.
 *
 * Логика:
 * - Линк у Storage (получатель) — принимает энергию от отправителей
 * - Линки у границ (отправители) — передают энергию в Storage-линк
 *
 * Передача происходит когда:
 * - Отправитель имеет энергию > 0
 * - Получатель не на кулдауне
 * - Получатель не полный
 *
 * Настройка через память комнаты (один раз вручную):
 *   Memory.rooms['E35S37'].links = {
 *     storage: 'ID линка у Storage',
 *     senders: ['ID линка у границы 1', 'ID линка у границы 2']
 *   }
 * ===================================================
 */

const linkManager = {
  run: function (room) {
    // Берём конфиг линков из памяти комнаты
    const linksConfig = room.memory.links;
    if (!linksConfig) return;

    // Получаем линк-получатель (у Storage)
    const storageLink = Game.getObjectById(linksConfig.storage);
    if (!storageLink) return;

    // Получатель полный — передавать некуда
    if (storageLink.store.getFreeCapacity(RESOURCE_ENERGY) === 0) return;

    // Перебираем все линки-отправители (у границ)
    const senders = linksConfig.senders || [];
    for (const senderId of senders) {
      const sender = Game.getObjectById(senderId);

      if (!sender) continue;
      if (sender.store[RESOURCE_ENERGY] === 0) continue; // нечего передавать
      if (sender.cooldown > 0) continue; // на кулдауне

      // Передаём всю энергию из отправителя в получатель
      const result = sender.transferEnergy(storageLink);
      if (result === OK) {
        // Один линк передаёт за тик — выходим
        // (можно убрать break если хотим передавать из нескольких сразу)
        break;
      }
    }
  },
};

module.exports = linkManager;
