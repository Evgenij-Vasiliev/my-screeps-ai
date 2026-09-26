const roleMineralMiner = {
  run: function (creep, roomState) {
    if (creep.memory.working === undefined) {
      creep.memory.working = false;
    }

    if (creep.memory.working && _.sum(creep.store) === 0) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      const storage = creep.room.storage;
      if (!storage) return;

      const resourceType = Object.keys(creep.store)[0];
      if (!resourceType) return;

      // Ошибка transfer (склад полон, чужой ресурс) — штатное состояние:
      // роль просто подождёт следующего тика. Лог в горячем пути не нужен.
      if (creep.transfer(storage, resourceType) === ERR_NOT_IN_RANGE) {
        creep.travelTo(storage);
      }
      return;
    }

    if (!roomState.mineral || !roomState.mineral.id) return;

    // Объект минерала уже разрешён для roomState на этот тик (mineral.manager
    // кеширует его в heap) — повторный Game.getObjectById на каждого крипа не
    // нужен. Фолбэк оставлен для состояния, собранного в обход кеша.
    const mineral =
      roomState.mineral.mineral || Game.getObjectById(roomState.mineral.id);
    if (!mineral || !roomState.mineral.extractorId) return;

    // Ошибки harvest (нет экстрактора, минерал пуст) — штатные состояния:
    // роль ждёт следующего тика, лог в горячем пути не нужен.
    if (creep.harvest(mineral) === ERR_NOT_IN_RANGE) {
      creep.travelTo(mineral);
    }
  },
};

module.exports = roleMineralMiner;
