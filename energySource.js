/**
 * ОБЩИЙ ИСТОЧНИК ЭНЕРГИИ (Energy Source Helper)
 * Не роль — вспомогательный модуль, вызывается изнутри ролей и executor'ов
 * Task System.
 *
 * Введён по ТЗ №2, чтобы не дублировать одинаковую логику
 * "взять энергию из storage" в нескольких местах (role.harvester,
 * task.executors) — единая точка правды, единое поведение.
 */
const { STORAGE } = require("./constants");

module.exports = {
  /**
   * Берёт энергию из storage, не опуская его ниже STORAGE.ENERGY_MIN
   * (если не ignoreReserve). Когда storage на резерве — забирает
   * из терминала (туда приходит балансировка TerminalNetwork).
   *
   * @param {Creep} creep
   * @param {boolean} [ignoreReserve=false] - true для аварийного режима
   *                     (например, восстановление после нападения),
   *                     когда резерв storage можно игнорировать.
   * @param {function(Creep, Object): void} [move] - необязательный способ
   *                     движения к цели. По умолчанию Traveler
   *                     (creep.travelTo); роль может передать свой, более
   *                     дешёвый на коротких дистанциях.
   * @returns {boolean} true — действие выполнено/начато;
   *                     false — ни storage, ни terminal не дали энергию.
   */
  withdrawFromStorage: function (creep, ignoreReserve = false, move) {
    const storage = creep.room.storage;
    const terminal = creep.room.terminal;
    const storageEnergy = storage ? storage.store[RESOURCE_ENERGY] || 0 : 0;
    const moveFn = move || function (c, target) { return c.travelTo(target); };

    if (
      storage &&
      storageEnergy > 0 &&
      (ignoreReserve || storageEnergy > STORAGE.ENERGY_MIN)
    ) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        moveFn(creep, storage);
      }
      return true;
    }

    // Storage на резерве или пуст — забираем энергию, пришедшую сетью в терминал.
    if (terminal && (terminal.store[RESOURCE_ENERGY] || 0) > 0) {
      if (creep.withdraw(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        moveFn(creep, terminal);
      }
      return true;
    }

    return false;
  },
};
