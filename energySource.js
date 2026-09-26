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
   * (если не ignoreReserve). Терминал источником не является — см. ниже.
   *
   * ЖЁСТКИЙ ПОЛ (правка под лимит владельца «в хранилище не меньше 150 000»).
   * Раньше проверялся только ФАКТ «резерв ещё цел» (`storageEnergy >
   * STORAGE.ENERGY_MIN`), а забор шёл полным `withdraw()` — до всего рюкзака
   * крипа. Один воркер при складе 150 001 и свободных 300 забирал 300 и оставлял
   * 149 701, то есть склад уходил НИЖЕ резерва. Теперь amount считается как
   * остаток СВЕРХ резерва (`storageEnergy − STORAGE.ENERGY_MIN`), поэтому склад
   * не опускается ниже пола ни на единицу — сколько бы воркеров ни забирало в
   * одном тике (каждый читает живой store).
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

    // Разрешённый к забору объём: при обычном режиме — только излишек над
    // резервом; в аварийном — весь остаток склада.
    const allowance = ignoreReserve
      ? storageEnergy
      : storageEnergy - STORAGE.ENERGY_MIN;

    if (storage && allowance > 0) {
      const free = creep.store.getFreeCapacity();
      const amount = Math.min(free, allowance);
      if (amount <= 0) return false; // рюкзак полон — взять нечего
      if (creep.withdraw(storage, RESOURCE_ENERGY, amount) === ERR_NOT_IN_RANGE) {
        moveFn(creep, storage);
      }
      return true;
    }

    // ТЕРМИНАЛ КАК ИСТОЧНИК ЭНЕРГИИ НЕ ИСПОЛЬЗУЕТСЯ.
    // Правило владельца: единый источник энергии для всех крипов — ХРАНИЛИЩЕ.
    // Здесь стояла ветка `withdraw(terminal, ENERGY)` «когда storage на резерве»,
    // и она была единственным стоком, который опустошал терминал в ноль: брали из
    // него все — спавны, расширения, башни, ремонт, стройка, апгрейд, — а
    // энергия терминала предназначена комиссиям отправок (terminalNetwork) и
    // сделок (market). Аварийные потребители берут из склада с ignoreReserve=true
    // (вызов fillSpawnsExtensions при room.energyAvailable < 400, BOOTSTRAP).
    return false;
  },
};
