/**
 * ===================================================
 * ROLE.DELIVERYWORKER.JS — Логистический исполнитель
 * ===================================================
 * VERSION: 1.4
 *
 * ПРОСТАЯ ЛОГИКА:
 * 1. Пустой и нет battery в store → иди в storage за energy
 * 2. Несёшь energy → иди в фабрику, сдай energy, сразу забери battery
 * 3. Несёшь battery → иди в storage, сдай battery
 * 4. Повтор
 * ===================================================
 */

const logisticsDirector = require("./logisticsDirector");

const MIN_STORAGE_ENERGY = 500;

const roleDeliveryWorker = {
  run: function (creep) {
    const stor = creep.room.storage;
    const factory = creep.room.find(FIND_MY_STRUCTURES, {
      filter: s => s.structureType === STRUCTURE_FACTORY,
    })[0];

    const hasEnergy = creep.store[RESOURCE_ENERGY] > 0;
    const hasBattery = creep.store[RESOURCE_BATTERY] > 0;
    const isEmpty = creep.store.getUsedCapacity() === 0;

    // ── ШАГ 3: несём battery → сдаём в storage ────────────────────────
    if (hasBattery) {
      if (!stor) return;
      const r = creep.transfer(stor, RESOURCE_BATTERY);
      if (r === ERR_NOT_IN_RANGE) {
        creep.moveTo(stor, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#aa00ff" },
        });
        creep.say("🏠 battery");
      }
      return;
    }

    // ── ШАГ 2: несём energy → сдаём в фабрику, берём battery ──────────
    if (hasEnergy) {
      if (!factory) {
        // Фабрики нет — сдаём energy обратно
        if (stor) {
          const r = creep.transfer(stor, RESOURCE_ENERGY);
          if (r === ERR_NOT_IN_RANGE) creep.moveTo(stor, { reusePath: 5 });
        }
        return;
      }

      // Сначала сдаём energy
      const r = creep.transfer(factory, RESOURCE_ENERGY);

      if (r === ERR_NOT_IN_RANGE) {
        creep.moveTo(factory, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ff8800" },
        });
        creep.say("🏭 energy");
        return;
      }

      if (r === OK || r === ERR_FULL) {
        // Сдали energy — завершаем delivery task
        const delivery = this._findMyDelivery(creep);
        if (delivery) {
          delivery.status = "completed";
          delivery.updatedAt = Game.time;
          delete creep.memory.deliveryTask;
        }
        // Сразу пробуем взять battery
        const battery = factory.store[RESOURCE_BATTERY] || 0;
        if (battery > 0) {
          const amount = Math.min(battery, creep.store.getFreeCapacity());
          const r2 = creep.withdraw(factory, RESOURCE_BATTERY, amount);
          if (r2 === ERR_NOT_IN_RANGE) {
            // Следующий тик подберём
          }
        }
        return;
      }
      return;
    }

    // ── ШАГ 1: пустой → берём energy из storage ───────────────────────
    if (isEmpty) {
      if (!factory) {
        creep.say("❌ фабрика");
        return;
      }
      if (!stor || (stor.store[RESOURCE_ENERGY] || 0) < MIN_STORAGE_ENERGY) {
        creep.say("⏳ жду");
        if (stor && creep.pos.getRangeTo(stor) > 3) {
          creep.moveTo(stor, {
            reusePath: 20,
            visualizePathStyle: { stroke: "#aaaaaa" },
          });
        }
        return;
      }

      // Берём delivery task
      const delivery = this._findOrTakeDelivery(creep);
      if (!delivery) {
        // Нет задачи — проверяем есть ли battery в фабрике для вывоза
        if (factory) {
          const battery = factory.store[RESOURCE_BATTERY] || 0;
          if (battery > 0) {
            const amount = Math.min(battery, creep.store.getFreeCapacity());
            const r = creep.withdraw(factory, RESOURCE_BATTERY, amount);
            if (r === ERR_NOT_IN_RANGE) {
              creep.moveTo(factory, {
                reusePath: 5,
                visualizePathStyle: { stroke: "#aa00ff" },
              });
              creep.say("🔄 battery");
            }
            return;
          }
        }
        creep.say("⏳ жду");
        if (stor && creep.pos.getRangeTo(stor) > 3) {
          creep.moveTo(stor, {
            reusePath: 20,
            visualizePathStyle: { stroke: "#aaaaaa" },
          });
        }
        return;
      }

      const amount = Math.min(delivery.amount, creep.store.getFreeCapacity());
      const r = creep.withdraw(stor, RESOURCE_ENERGY, amount);
      if (r === ERR_NOT_IN_RANGE) {
        creep.moveTo(stor, {
          reusePath: 5,
          visualizePathStyle: { stroke: "#ffaa00" },
        });
        creep.say("📦 energy");
      }
      if (r === OK) {
        delivery.status = "delivering";
        delivery.updatedAt = Game.time;
      }
    }
  },

  _findOrTakeDelivery: function (creep) {
    const existing = this._findMyDelivery(creep);
    if (existing) return existing;

    const deliveries = logisticsDirector.getDeliveries(creep.room.name);
    const delivery = deliveries.find(d => d.status === "queued") || null;
    if (!delivery) return null;

    delivery.status = "assigned";
    delivery.assignedTo = creep.name;
    delivery.updatedAt = Game.time;
    creep.memory.deliveryTask = {
      roomName: creep.room.name,
      createdAt: delivery.createdAt,
    };
    return delivery;
  },

  _findMyDelivery: function (creep) {
    if (!creep.memory.deliveryTask) return null;
    const ref = creep.memory.deliveryTask;
    const list =
      Memory.empire &&
      Memory.empire.logistics &&
      Memory.empire.logistics.deliveries &&
      Memory.empire.logistics.deliveries[ref.roomName];
    if (!list) {
      delete creep.memory.deliveryTask;
      return null;
    }
    const delivery = list.find(d => d.createdAt === ref.createdAt) || null;
    if (!delivery) {
      delete creep.memory.deliveryTask;
      return null;
    }
    if (delivery.status === "completed" || delivery.status === "cancelled") {
      delete creep.memory.deliveryTask;
      return null;
    }
    return delivery;
  },
};

module.exports = roleDeliveryWorker;
