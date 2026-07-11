/**
 * ОБЩИЙ ИСТОЧНИК ЭНЕРГИИ (Energy Source Helper)
 * Не роль — вспомогательный модуль, вызывается изнутри role.*.js.
 *
 * Введён по ТЗ №2, чтобы не дублировать одинаковую логику
 * "взять энергию из storage" в нескольких ролях (builder, upgrader,
 * repairer, towerSupplier) — единая точка правды, единое поведение.
 */
module.exports = {
  /**
   * Пытается получить энергию из storage комнаты крипа.
   * Если storage есть и в нём есть энергия — крип либо уже изымает её,
   * либо идёт к storage (в обоих случаях тик крипа считается занятым).
   *
   * @param {Creep} creep
   * @returns {boolean} true — storage доступен и не пуст (действие выполнено/начато);
   *                     false — storage отсутствует или пуст (роли следует
   *                     перейти в свой аварийный режим).
   */
  withdrawFromStorage: function (creep) {
    const storage = creep.room.storage;
    if (!storage || storage.store[RESOURCE_ENERGY] === 0) return false;

    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 15 });
    }
    return true;
  },
};
