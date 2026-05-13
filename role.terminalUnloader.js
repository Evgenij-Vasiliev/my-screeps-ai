/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Разгрузчик терминала
 * ===================================================
 * Постоянная роль. Спавнится автоматически через roomManager
 * когда в терминале накапливается более 5000 не-энергетических
 * ресурсов суммарно.
 *
 * Логика:
 * 1. Ищет любой не-энергетический ресурс в терминале
 * 2. Берёт сколько влезет
 * 3. Несёт в storage
 * 4. Повторяет пока терминал не пуст
 * ===================================================
 */

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    if (!terminal || !storage) {
      creep.say("❌ нет структур");
      return;
    }

    // Переключение режима: пустой → собираем, полный → доставляем
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // Ищем любой не-энергетический ресурс в терминале
      const resource = Object.keys(terminal.store).find(
        r => r !== RESOURCE_ENERGY && terminal.store[r] > 0,
      );

      if (!resource) {
        creep.say("✅ пусто");
        return;
      }

      creep.memory.resource = resource;

      const amount = Math.min(
        terminal.store[resource],
        creep.store.getFreeCapacity(),
      );

      const result = creep.withdraw(terminal, resource, amount);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(terminal, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff8800" },
        });
      }
      if (result === OK) {
        creep.memory.working = true;
      }
    } else {
      // Несём в storage
      const result = creep.transfer(storage, creep.memory.resource);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#00ff00" },
        });
      }
      if (result === OK) {
        creep.memory.working = false;
        delete creep.memory.resource;
      }
    }
  },
};
