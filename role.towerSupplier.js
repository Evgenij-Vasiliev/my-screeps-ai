/**
 * ===================================================
 * ROLE.TOWERSUPPLIER.JS — Заправщик башен и переносчик ресурсов
 * ===================================================
 *
 * Приоритеты задач:
 * 1. "towers"          — один рейс энергии башням (самой пустой)
 * 2. "storage_energy"  — излишек энергии из Storage → Terminal
 *                        (если Storage > STORAGE_ENERGY_LIMIT)
 * 3. "mineral"         — минерал из Storage → Terminal (рейсами)
 * 4. "terminal_energy" — дозарядить Terminal до TERMINAL_ENERGY_MIN
 *
 * КЛЮЧЕВАЯ ЛОГИКА:
 * Каждая задача = ровно ОДИН рейс (взял → отдал → выбрал новую задачу).
 * Башни не монополизируют крипа — после одного рейса он смотрит
 * на следующий приоритет. Это позволяет чередовать все задачи.
 *
 * Настройки:
 * STORAGE_ENERGY_LIMIT — лимит Storage, излишек идёт в Terminal
 * TERMINAL_ENERGY_MIN  — минимум энергии в Terminal (задача 4)
 * MINERAL_BATCH        — объём одного минерального рейса
 * ===================================================
 */

const STORAGE_ENERGY_LIMIT = 400000; // излишек сверх этого → Terminal
const TERMINAL_ENERGY_MIN = 20000; // минимум Terminal (задача 4)
const MINERAL_BATCH = 500; // объём одного минерального рейса

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const storage = creep.room.storage;
    const terminal = creep.room.terminal;
    const towers = creep.room._towers || [];

    // ── 1. СБРОС: рюкзак пуст → выбираем новую задачу ────────────────────
    // Каждая задача = один рейс. Как только рюкзак опустел — сброс.
    if (creep.store.getUsedCapacity() === 0) {
      creep.memory.task = null;
      creep.memory.working = false;
      creep.memory.mineralResource = null;
    }

    // ── 2. ВЫБОР ЗАДАЧИ (только когда task = null) ────────────────────────
    if (!creep.memory.task) {
      // Приоритет 1: башни — берём ТОЛЬКО если башня < 50% заряда
      // Это предотвращает монополизацию: крип не гоняется за башнями
      // которые заряжены на 90% — это не срочно.
      const urgentTowers = towers.filter(
        t =>
          t.store[RESOURCE_ENERGY] < t.store.getCapacity(RESOURCE_ENERGY) * 0.5,
      );
      if (
        urgentTowers.length > 0 &&
        storage &&
        storage.store[RESOURCE_ENERGY] > 0
      ) {
        creep.memory.task = "towers";
        creep.say("⚡ башни");
      }

      // Приоритет 2: излишек энергии Storage → Terminal
      if (
        !creep.memory.task &&
        storage &&
        terminal &&
        storage.store[RESOURCE_ENERGY] > STORAGE_ENERGY_LIMIT &&
        terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        creep.memory.task = "storage_energy";
        creep.say("💰→💱");
      }

      // Приоритет 3: минерал из Storage → Terminal
      if (!creep.memory.task && storage && terminal) {
        const mineralResource = Object.keys(storage.store).find(
          r => r !== RESOURCE_ENERGY && storage.store[r] > 0,
        );
        if (
          mineralResource &&
          terminal.store.getFreeCapacity() > MINERAL_BATCH
        ) {
          creep.memory.task = "mineral";
          creep.memory.mineralResource = mineralResource;
          creep.say("💎 минерал");
        }
      }

      // Приоритет 4: Terminal нуждается в минимуме энергии
      if (
        !creep.memory.task &&
        storage &&
        terminal &&
        terminal.store[RESOURCE_ENERGY] < TERMINAL_ENERGY_MIN &&
        storage.store[RESOURCE_ENERGY] > 0
      ) {
        creep.memory.task = "terminal_energy";
        creep.say("💱 терминал");
      }

      // Нечего делать
      if (!creep.memory.task) {
        // Башни не срочные но неполные — дозаряжаем в свободное время
        const anyTower = towers.find(
          t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        );
        if (anyTower && storage && storage.store[RESOURCE_ENERGY] > 0) {
          creep.memory.task = "towers";
          creep.say("⚡ башни(д)");
        } else {
          creep.say("💤 нечего делать");
          return;
        }
      }
    }

    // ── 3. ВЫПОЛНЕНИЕ ЗАДАЧИ ──────────────────────────────────────────────
    if (creep.memory.task === "towers") {
      this.doTowersTask(creep, storage, towers);
    } else if (creep.memory.task === "storage_energy") {
      this.doStorageEnergyTask(creep, storage, terminal);
    } else if (creep.memory.task === "mineral") {
      this.doMineralTask(creep, storage, terminal);
    } else if (creep.memory.task === "terminal_energy") {
      this.doTerminalEnergyTask(creep, storage, terminal);
    }
  },

  // ── ЗАДАЧА 1: БАШНИ ───────────────────────────────────────────────────────
  // Один рейс — заряжаем самую пустую башню. Потом сброс задачи.
  doTowersTask: function (creep, storage, towers) {
    // Фаза сбора
    if (!creep.memory.working) {
      if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
        creep.memory.task = null;
        return;
      }
      const result = creep.withdraw(storage, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffff00" },
        });
      } else if (result === OK) {
        creep.memory.working = true;
      }
      return;
    }

    // Фаза доставки — самая пустая башня
    const needyTowers = towers.filter(
      t => t.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    );
    if (needyTowers.length === 0) {
      // Башни полные — рюкзак опустеет и task сбросится автоматически
      // Но если остаток — выгружаем в storage
      if (storage && creep.store[RESOURCE_ENERGY] > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, { reusePath: 5 });
        }
      }
      return;
    }
    needyTowers.sort(
      (a, b) => a.store[RESOURCE_ENERGY] - b.store[RESOURCE_ENERGY],
    );
    const target = needyTowers[0];
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ffffff" },
      });
    }
  },

  // ── ЗАДАЧА 2: ИЗЛИШЕК ЭНЕРГИИ Storage → Terminal ──────────────────────────
  doStorageEnergyTask: function (creep, storage, terminal) {
    if (!creep.memory.working) {
      if (!storage || storage.store[RESOURCE_ENERGY] <= STORAGE_ENERGY_LIMIT) {
        creep.memory.task = null;
        return;
      }
      const surplus = storage.store[RESOURCE_ENERGY] - STORAGE_ENERGY_LIMIT;
      const amount = Math.min(surplus, creep.store.getFreeCapacity());
      const result = creep.withdraw(storage, RESOURCE_ENERGY, amount);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffff00" },
        });
      } else if (result === OK) {
        creep.memory.working = true;
      }
      return;
    }
    if (!terminal || terminal.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.task = null;
      creep.memory.working = false;
      return;
    }
    if (creep.transfer(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(terminal, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00ffff" },
      });
    }
  },

  // ── ЗАДАЧА 3: МИНЕРАЛ Storage → Terminal ──────────────────────────────────
  doMineralTask: function (creep, storage, terminal) {
    const resource = creep.memory.mineralResource;
    if (!resource) {
      creep.memory.task = null;
      return;
    }
    if (!creep.memory.working) {
      if (
        !storage ||
        !storage.store[resource] ||
        storage.store[resource] === 0
      ) {
        creep.memory.task = null;
        creep.memory.mineralResource = null;
        return;
      }
      const amount = Math.min(
        MINERAL_BATCH,
        creep.store.getFreeCapacity(),
        storage.store[resource],
      );
      const result = creep.withdraw(storage, resource, amount);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff8800" },
        });
      } else if (result === OK) {
        creep.memory.working = true;
      }
      return;
    }
    if (!terminal || terminal.store.getFreeCapacity() === 0) {
      creep.memory.task = null;
      creep.memory.working = false;
      return;
    }
    if (creep.transfer(terminal, resource) === ERR_NOT_IN_RANGE) {
      creep.moveTo(terminal, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ff8800" },
      });
    }
  },

  // ── ЗАДАЧА 4: МИНИМУМ ЭНЕРГИИ В Terminal ──────────────────────────────────
  doTerminalEnergyTask: function (creep, storage, terminal) {
    if (!creep.memory.working) {
      if (!storage || storage.store[RESOURCE_ENERGY] === 0) {
        creep.memory.task = null;
        return;
      }
      const result = creep.withdraw(storage, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffff00" },
        });
      } else if (result === OK) {
        creep.memory.working = true;
      }
      return;
    }
    if (!terminal || terminal.store[RESOURCE_ENERGY] >= TERMINAL_ENERGY_MIN) {
      creep.memory.task = null;
      creep.memory.working = false;
      return;
    }
    if (creep.transfer(terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(terminal, {
        reusePath: 5,
        visualizePathStyle: { stroke: "#00ffff" },
      });
    }
  },
};
