/**
 * ===================================================
 * ROLE.LABWORKER.JS — Крип для обслуживания лаборатории
 * ===================================================
 * Задачи:
 * 1. Загружает реагенты из Terminal/Storage в Лаб1 и Лаб2
 * 2. Выгружает готовый продукт из реактора в Terminal/Storage
 *
 * Конфиг в памяти комнаты:
 *   Memory.rooms['E35S37'].labs = {
 *     lab1: 'ID',      — лаба с реагентом1
 *     lab2: 'ID',      — лаба с реагентом2
 *     reactor: 'ID',   — реактор (производит продукт)
 *     reagent1: 'Z',   — что заливаем в lab1
 *     reagent2: 'K',   — что заливаем в lab2
 *     product: 'ZK'    — что получаем на выходе
 *   }
 *
 * Память крипа:
 * - task     {string} — текущая задача
 * - resource {string} — текущий ресурс
 * - amount   {number} — сколько взять из источника
 * ===================================================
 */

const LAB_CAPACITY = 3000;

module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    const config = creep.room.memory.labs;
    if (!config) {
      creep.say("❌ нет конфига");
      return;
    }

    const lab1 = Game.getObjectById(config.lab1);
    const lab2 = Game.getObjectById(config.lab2);
    const reactor = Game.getObjectById(config.reactor);
    const terminal = creep.room.terminal;
    const storage = creep.room.storage;

    if (!lab1 || !lab2 || !reactor) {
      creep.say("❌ нет лаб");
      return;
    }

    const source = terminal || storage;
    if (!source) {
      creep.say("❌ нет хранилища");
      return;
    }

    if (creep.store.getUsedCapacity() === 0) {
      creep.memory.task = null;
      delete creep.memory.resource;
      delete creep.memory.amount;
    }

    if (!creep.memory.task) {
      if (reactor.store[config.product] > 0) {
        creep.memory.task = "unload_reactor";
        creep.memory.resource = config.product;
      } else if (lab1.store[config.reagent1] < LAB_CAPACITY) {
        const needed = LAB_CAPACITY - lab1.store[config.reagent1];
        const available = source.store[config.reagent1] || 0;
        if (available > 0) {
          creep.memory.task = "load_lab1";
          creep.memory.resource = config.reagent1;
          creep.memory.amount = Math.min(
            needed,
            available,
            creep.store.getFreeCapacity(),
          );
        }
      } else if (lab2.store[config.reagent2] < LAB_CAPACITY) {
        const needed = LAB_CAPACITY - lab2.store[config.reagent2];
        const available = source.store[config.reagent2] || 0;
        if (available > 0) {
          creep.memory.task = "load_lab2";
          creep.memory.resource = config.reagent2;
          creep.memory.amount = Math.min(
            needed,
            available,
            creep.store.getFreeCapacity(),
          );
        }
      } else {
        creep.say("✅ всё ок");
        return;
      }
    }

    if (creep.memory.task === "unload_reactor") {
      if (creep.store[config.product] === 0) {
        const result = creep.withdraw(reactor, config.product);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(reactor, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
      } else {
        const result = creep.transfer(source, config.product);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#00ff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }

    if (creep.memory.task === "load_lab1") {
      if (creep.store[config.reagent1] === 0) {
        const result = creep.withdraw(
          source,
          config.reagent1,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) delete creep.memory.amount;
      } else {
        const result = creep.transfer(lab1, config.reagent1);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(lab1, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }

    if (creep.memory.task === "load_lab2") {
      if (creep.store[config.reagent2] === 0) {
        const result = creep.withdraw(
          source,
          config.reagent2,
          creep.memory.amount,
        );
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) delete creep.memory.amount;
      } else {
        const result = creep.transfer(lab2, config.reagent2);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(lab2, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ffff00" },
          });
        }
        if (result === OK) creep.memory.task = null;
      }
      return;
    }
  },
};
