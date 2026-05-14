/**
 * ===================================================
 * ROLE.TERMINALUNLOADER.JS — Двусторонний логист терминала
 * ===================================================
 * Спавнится автоматически через roomManager когда в терминале
 * накапливается более 5000 не-энергетических ресурсов суммарно,
 * или когда есть очередь запросов terminalNeeds.
 *
 * Логика (в порядке приоритета):
 *
 * 1. STORAGE → ТЕРМИНАЛ (загрузка для отправки):
 *    terminalManager/balancer пишет в память комнаты очередь:
 *    room.memory.terminalNeeds = [
 *      { resource: 'O',  amount: 10000, toRoom: 'E36S38' },
 *    ]
 *    Крип берёт первый запрос, МНОГОКРАТНО ходит storage→terminal
 *    пока не перенесёт всё нужное количество.
 *    Только после этого удаляет запрос из очереди.
 *
 * 2. ТЕРМИНАЛ → STORAGE (разгрузка):
 *    Если очередь пуста — ищем не-энергетические ресурсы
 *    в терминале и несём в storage.
 *
 * ИСПРАВЛЕНО v2:
 * - Запрос из terminalNeeds НЕ удаляется после одной ходки.
 *   Крип запоминает сколько уже перенёс (memory.transferred)
 *   и продолжает пока transferred < need.amount.
 *   Раньше запрос удалялся сразу после первого transfer → крип
 *   переносил 1000-2000 единиц и бросал задачу.
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
      const needs = creep.room.memory.terminalNeeds;
      if (needs && needs.length > 0) {
        const need = needs[0];
        const inStorage = storage.store[need.resource] || 0;

        // Сколько уже перенесено в терминал по этому запросу
        if (!creep.memory.transferred) creep.memory.transferred = 0;

        // Сколько ещё нужно перенести
        const remaining = need.amount - creep.memory.transferred;

        if (remaining <= 0) {
          // Весь объём перенесён — удаляем запрос
          console.log(
            `[TerminalUnloader ${creep.room.name}] ✅ ` +
              `${need.resource} перенесён в терминал (${need.amount} ед.)`,
          );
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          delete creep.memory.resource;
          delete creep.memory.task;
          return;
        }

        if (inStorage === 0) {
          // Ресурса нет в storage — удаляем запрос
          console.log(
            `[TerminalUnloader ${creep.room.name}] ` +
              `Нет ${need.resource} в storage — удаляем запрос`,
          );
          creep.room.memory.terminalNeeds = needs.slice(1);
          delete creep.memory.transferred;
          return;
        }

        // Берём сколько влезет, но не больше чем осталось перенести
        const amount = Math.min(
          remaining,
          inStorage,
          creep.store.getFreeCapacity(),
        );

        creep.memory.resource = need.resource;
        creep.memory.task = "load_terminal";

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
      }

      // ── ПРИОРИТЕТ 2: ТЕРМИНАЛ → STORAGE ──────────────────────────────
      const resource = Object.keys(terminal.store).find(
        r => r !== RESOURCE_ENERGY && terminal.store[r] > 0,
      );

      if (!resource) return;

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
          // Считаем сколько перенесли — НЕ удаляем запрос
          // Крип вернётся за следующей порцией пока remaining > 0
          const delivered =
            creep.store[creep.memory.resource] || creep.store.getUsedCapacity();
          creep.memory.transferred =
            (creep.memory.transferred || 0) + delivered;
          creep.memory.working = false;
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
