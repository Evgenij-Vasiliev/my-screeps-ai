/**
 * ОБЩИЙ ИСТОЧНИК ЭНЕРГИИ (Energy Source Helper)
 * Не роль — вспомогательный модуль, вызывается изнутри role.*.js.
 *
 * Введён по ТЗ №2, чтобы не дублировать одинаковую логику
 * "взять энергию из storage" в нескольких ролях (builder, upgrader,
 * repairer, towerSupplier) — единая точка правды, единое поведение.
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
    if (!storage || storage.store[RESOURCE_ENERGY] === 0) return false;

    if (
      !ignoreReserve &&
      storage.store[RESOURCE_ENERGY] <= STORAGE.ENERGY_MIN
    ) {
      return false;
    }

    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 50 });
    }
    return true;
  },
};
