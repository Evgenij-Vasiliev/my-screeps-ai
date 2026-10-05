/**
 * ОБЩИЙ ИСТОЧНИК ЭНЕРГИИ (Energy Source Helper)
 * Не роль — вспомогательный модуль, вызывается изнутри исполнителей задач
 * (task/exec.spawns.js:34, exec.factory.js:52, exec.towers.js:47,
 * exec.terminal.js:43, exec.repair.js:85, exec.build.js:47, exec.upgrade.js:51 —
 * по одному вызову withdrawFromStorage на семейство задач).
 *
 * Введён по ТЗ №2, чтобы не дублировать одинаковую логику
 * "взять энергию из storage" в нескольких ролях (тогда — builder, upgrader,
 * repairer, towerSupplier; сами роли удалены 03.10.2026, модуль остался
 * единой точкой правды для их преемников-исполнителей).
 */
const { STORAGE } = require("./constants");

module.exports = {
  /**
   * Пытается получить энергию из storage комнаты крипа.
   * Не позволяет опустить storage ниже STORAGE.ENERGY_MIN,
   * если явно не указан аварийный режим (ignoreReserve).
   *
   * @param {Creep} creep
   * @param {boolean} [ignoreReserve=false] — true для аварийного режима
   *                     (например, восстановление после нападения),
   *                     когда резерв storage можно игнорировать.
   * @returns {boolean} true — storage доступен и не пуст (действие выполнено/начато);
   *                     false — storage отсутствует, пуст, либо резерв
   *                     не позволяет забрать энергию (роли следует
   *                     перейти в свой аварийный режим).
   */
  withdrawFromStorage: function (creep, ignoreReserve = false) {
    const storage = creep.room.storage;
    if (!storage) return false;

    // ОДНО чтение store вместо двух. Каждое обращение к `.store` движок
    // собирает заново: Object.entries по всем ресурсам объекта (у storage их
    // ~25), четыре defineProperty с замыканиями и new Proxy
    // (engine src/game/store.js, конструктор Store). Проверки при этом те же:
    // `energy === 0` и резерв — как в прежней версии с двумя чтениями.
    const energy = storage.store[RESOURCE_ENERGY];

    if (energy === 0) return false;

    if (!ignoreReserve && energy <= STORAGE.ENERGY_MIN) {
      return false;
    }

    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.travelTo(storage);
    }
    return true;
  },
};
