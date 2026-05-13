/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен и разгрузчик линка
 * ===================================================
 *
 * Приоритеты (исправлено):
 * 1. Линк у Storage имеет энергию → забираем в Storage (ПЕРВЫЙ ПРИОРИТЕТ)
 * 2. Башни ниже 50% → берём из Storage → заправляем башни
 * 3. Терминал ниже TERMINAL_ENERGY_MIN → заливаем энергию в терминал
 * 4. Всё в порядке → ждём
 *
 * Настройка линка через память комнаты:
 *   Memory.rooms['E37S38'].links.storage = 'ID линка у Storage'
 * ===================================================
 */

const TERMINAL_ENERGY_MIN = 100000;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const storage = creep.room.storage;
    const towers = creep.room._towers || [];
    const terminal = creep.room.terminal;

    // Получаем линк у Storage из памяти комнаты
    const linksConfig = creep.room.memory.links;
    const storageLink = linksConfig
      ? Game.getObjectById(linksConfig.storage)
      : null;

    // Переключение режима: пустой → собираем, полный → доставляем
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.memory.task = null;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      // === СБОР: определяем откуда брать ===

      // Приоритет 1: линк у Storage имеет энергию → разгружаем в Storage
      // Это главный приоритет — майнеры кладут энергию в линк,
      // крип должен немедленно её забрать чтобы линк освободился
      if (
        storageLink &&
        storageLink.store[RESOURCE_ENERGY] > 0 &&
        storage &&
        storage.store.getFreeCapacity() > 0
      ) {
        creep.memory.task = "unload_link";
        const result = creep.withdraw(storageLink, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storageLink, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        return;
      }

      // Приоритет 2: башня ниже 50% → берём из Storage
      const urgentTower = towers.find(
        t =>
          t.store[RESOURCE_ENERGY] < t.store.getCapacity(RESOURCE_ENERGY) * 0.5,
      );

      if (urgentTower) {
        // Нет энергии в Storage — ждём пока линк не разгрузится
        if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
          creep.say("⏳ нет энергии");
          return;
        }
        creep.memory.task = "towers";
        const result = creep.withdraw(storage, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Приоритет 3: терминал ниже минимума → берём из Storage
      if (
        terminal &&
        terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN &&
        terminal.store.getFreeCapacity() > 0 &&
        storage &&
        storage.store[RESOURCE_ENERGY] > 0
      ) {
        creep.memory.task = "terminal";
        const amount = Math.min(
          creep.store.getFreeCapacity(),
          TERMINAL_ENERGY_MIN - terminal.store[RESOURCE_ENERGY],
        );
        const result = creep.withdraw(storage, RESOURCE_ENERGY, amount);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        return;
      }

      // Нечего делать — ждём
      // creep.say("⏳ всё OK");
    } else {
      // === ДОСТАВКА: везём к цели ===

      // Разгружаем линк → кладём в Storage
      if (creep.memory.task === "unload_link") {
        if (!storage) return;
        const result = creep.transfer(storage, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        return;
      }

      // Везём в терминал
      if (creep.memory.task === "terminal" && terminal) {
        const result = creep.transfer(terminal, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ffff" },
          });
        }
        return;
      }

      // Везём в башню (task === "towers")
      const needyTowers = towers
        .filter(t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
        .sort((a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY]);

      if (needyTowers.length === 0) {
        // Башни полные — сбрасываем остаток в Storage
        if (storage && creep.store[RESOURCE_ENERGY] > 0) {
          if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
          }
        }
        return;
      }

      const target = needyTowers[0];
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    }
  },
};
