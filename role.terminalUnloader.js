/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Двусторонний логист терминала
 * ===================================================
 * Спавнится автоматически через roomManager когда в терминале
 * накапливается более 5000 не-энергетических ресурсов суммарно.
 *
 * Логика (в порядке приоритета):
 *
 * 1. STORAGE → ТЕРМИНАЛ (загрузка для отправки):
 *    terminalManager пишет в память комнаты очередь запросов:
 *    room.memory.terminalNeeds = [
 *      { resource: 'O',  amount: 5000, toRoom: 'E37S38' },
 *      { resource: 'OH', amount: 5000, toRoom: 'E36S38' },
 *    ]
 *    Крип берёт первый запрос из очереди, несёт ресурс из
 *    storage в терминал. После доставки запрос удаляется.
 *
 * 2. ТЕРМИНАЛ → STORAGE (разгрузка):
 *    Если очередь пуста — ищем не-энергетические ресурсы
 *    в терминале и несём в storage.
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

    // Переключение режима: пустой → ищем задачу, полный → доставляем
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      delete creep.memory.resource;
      delete creep.memory.task;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // ── ПРИОРИТЕТ 1: STORAGE → ТЕРМИНАЛ ──────────────────────────────
      // Читаем очередь запросов от terminalManager
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        // Берём первый запрос из очереди
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        if (inStorage > 0) {
          const amount = Math.min(
            need.amount,
            inStorage,
            creep.store.getFreeCapacity(),
          );
          creep.memory.resource = need.resource;
          creep.memory.task = "load_terminal";
          creep.memory.needIdx = 0; // индекс запроса в очереди

          const result = creep.withdraw(storage, need.resource, amount);
          if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, {
              reusePath: 5,
              visualizePathStyle: { stroke: "#00ffff" },
            });
          }
          if (result === OK) {
            creep.memory.working = true;
          }
          return;
        } else {
          // Ресурса нет в storage — удаляем запрос из очереди
          console.log(
            `[TerminalUnloader ${creep.room.name}] ` +
              `Нет ${need.resource} в storage — удаляем запрос`,
          );
          creep.room.memory.terminalNeeds = needs.slice(1);
        }
      }

      // ── ПРИОРИТЕТ 2: ТЕРМИНАЛ → STORAGE ──────────────────────────────
      // Ищем любой не-энергетический ресурс в терминале
      const resource = Object.keys(terminal.store).find(
        r => r !== RESOURCE_ENERGY && terminal.store[r] > 0,
      );

      if (!resource) {
        // creep.say('✅ пусто');
        return;
      }

      creep.memory.resource = resource;
      creep.memory.task = "unload_terminal";

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
      // ── ДОСТАВКА ──────────────────────────────────────────────────────

      // Storage → Терминал
      if (creep.memory.task === "load_terminal") {
        const result = creep.transfer(terminal, creep.memory.resource);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        if (result === OK) {
          // Удаляем выполненный запрос из очереди
          const needs = creep.room.memory.terminalNeeds;
          if (needs && needs.length > 0) {
            // Удаляем первый запрос на этот ресурс
            const idx = needs.findIndex(
              n => n.resource === creep.memory.resource,
            );
            if (idx !== -1) {
              creep.room.memory.terminalNeeds = [
                ...needs.slice(0, idx),
                ...needs.slice(idx + 1),
              ];
            }
          }
          console.log(
            `[TerminalUnloader ${creep.room.name}] ✅ ` +
              `${creep.memory.resource} перенесён в терминал`,
          );
          creep.memory.working = false;
          delete creep.memory.resource;
          delete creep.memory.task;
          delete creep.memory.needIdx;
        }
        return;
      }

      // Терминал → Storage
      if (creep.memory.task === "unload_terminal") {
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
          delete creep.memory.task;
        }
      }
    }
  },
};
