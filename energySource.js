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

    // ТЕРМИНАЛ КАК ИСТОЧНИК ЭНЕРГИИ НЕ ИСПОЛЬЗУЕТСЯ.
    // Правило владельца: единый источник энергии для всех крипов — ХРАНИЛИЩЕ.
    // Здесь стояла ветка `withdraw(terminal, ENERGY)` «когда storage на резерве»,
    // и она была единственным стоком, который опустошал терминал в ноль: подвоза
    // у терминала нет, пока склад ниже 195000 (гейт TERMINAL_SUPPLY.
    // STORAGE_RESERVE_MULTIPLIER в task.generators.js), а брали из него все —
    // спавны, расширения, башни, ремонт, стройка, апгрейд. Энергия терминала
    // предназначена комиссиям отправок (terminalNetwork) и сделок (market).
    // Аварийные потребители берут из склада с ignoreReserve=true (вызов
    // fillSpawnsExtensions при room.energyAvailable < 400, constants.js BOOTSTRAP).
    return false;
  },
};
