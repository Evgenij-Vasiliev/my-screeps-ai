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
   * @param {number} [maxAmount=Infinity] — потолок одного снятия (контракт
   *                     задачи). Реальное количество дополнительно
   *                     ограничивается свободной вместимостью carry.
   * @returns {boolean} true — storage доступен и не пуст (действие выполнено/начато);
   *                     false — storage отсутствует, пуст, либо резерв
   *                     не позволяет забрать энергию (роли следует
   *                     перейти в свой аварийный режим).
   */
  withdrawFromStorage: function (creep, ignoreReserve = false, maxAmount = Infinity) {
    const storage = creep.room.storage;
    if (!storage || storage.store[RESOURCE_ENERGY] === 0) return false;

    // memory.ignoreReserves ставит фабрика крипов группам systems.extraCreeps
    // с флагом ignoreReserves: такой крип берёт энергию в обход резерва склада.
    if (
      !ignoreReserve &&
      creep.memory.ignoreReserves !== true &&
      storage.store[RESOURCE_ENERGY] <= STORAGE.ENERGY_MIN
    ) {
      return false;
    }

    // Сколько реально можно снять: остаток сверх резерва (если он включён)
    // и не больше свободной вместимости carry и контракта задачи.
    const reserve =
      !ignoreReserve && creep.memory.ignoreReserves !== true
        ? STORAGE.ENERGY_MIN
        : 0;
    const available = storage.store[RESOURCE_ENERGY] - reserve;
    if (available <= 0) return false;

    let amount = Math.min(maxAmount, available);
    if (
      creep.store &&
      typeof creep.store.getFreeCapacity === "function"
    ) {
      amount = Math.min(amount, creep.store.getFreeCapacity(RESOURCE_ENERGY));
    }
    if (amount <= 0) return false;

    const result = Number.isFinite(amount)
      ? creep.withdraw(storage, RESOURCE_ENERGY, amount)
      : creep.withdraw(storage, RESOURCE_ENERGY);

    // ERR_NOT_IN_RANGE — действие начато (крип едет); остальные ошибки —
    // энергия не снята, и executor должен получить false, а не CONTINUE.
    if (result === ERR_NOT_IN_RANGE) {
      creep.travelTo(storage);
      return true;
    }
    return result === OK;
  },
};
