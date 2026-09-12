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
   * Берёт энергию из storage, не опуская его ниже STORAGE.ENERGY_MIN
   * (если не ignoreReserve). Когда storage на резерве — забирает
   * из терминала (туда приходит балансировка TerminalNetwork).
   *
   * @param {Creep} creep
   * @param {boolean} [ignoreReserve=false] — true для аварийного режима
   *                     (например, восстановление после нападения),
   *                     когда резерв storage можно игнорировать.
   * @returns {boolean} true — действие выполнено/начато;
   *                     false — ни storage, ни terminal не дали энергию.
   */
  withdrawFromStorage: function (creep, ignoreReserve = false) {
    const storage = creep.room.storage;
    const terminal = creep.room.terminal;
    const storageEnergy = storage ? storage.store[RESOURCE_ENERGY] || 0 : 0;

    if (
      storage &&
      storageEnergy > 0 &&
      (ignoreReserve || storageEnergy > STORAGE.ENERGY_MIN)
    ) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 50 });
      }
      return true;
    }

    // Storage на резерве или пуст — забираем энергию, пришедшую сетью в терминал.
    if (terminal && (terminal.store[RESOURCE_ENERGY] || 0) > 0) {
      if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, { reusePath: 50 });
      }
      return true;
    }

    return false;
  },
};
