/**
 * ===================================================
 * ROLE.MINERALMINER.JS — Добытчик минералов
 * ===================================================
 * Стратегия: добывает минерал с помощью Extractor
 * и доставляет его в Terminal (приоритет) или Storage.
 *
 * ВАЖНО: в Screeps shard3 количество минерала хранится в поле
 * mineralAmount, а не amount. Используем только mineralAmount.
 *
 * Память крипа (creep.memory):
 * - working      {boolean}     — false = добыча, true = доставка
 * - mineralId    {string}      — ID минерала (из room.memory)
 * - extractorId  {string|null} — ID экстрактора (кэш навсегда)
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    if (!creep || !creep.room) return;

    /**
     * 1. ПОЛУЧЕНИЕ МИНЕРАЛА
     * mineralId берём из памяти крипа или памяти комнаты.
     */
    const mineralId = creep.memory.mineralId || creep.room.memory.mineralId;

    if (!mineralId) {
      const minerals = creep.room.find(FIND_MINERALS);
      if (minerals.length === 0) {
        creep.say("❌ нет минерала");
        return;
      }
      creep.memory.mineralId = minerals[0].id;
      creep.room.memory.mineralId = minerals[0].id;
    }

    const mineral = Game.getObjectById(mineralId);

    if (!mineral) {
      creep.say("❌ ошибка");
      return;
    }

    /**
     * 2. ПРОВЕРКА: МИНЕРАЛ ПУСТ?
     *
     * ИСПРАВЛЕНИЕ: используем mineral.mineralAmount вместо mineral.amount.
     * В Screeps shard3 поле amount всегда undefined.
     * Правильное поле — mineralAmount.
     *
     * Если минерал пуст — крип просто стоит и ждёт своего TTL (~1500 тиков).
     * Новые mineralMiner не спавнятся — roomManager проверяет mineralAmount
     * и выставляет count: 0 пока минерала нет.
     */
    if (!mineral.mineralAmount || mineral.mineralAmount === 0) {
      const ticks = mineral.ticksToRegeneration || "?";
      creep.say(`💤 ${ticks}т`);
      return;
    }

    /**
     * 3. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
     */
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
      creep.memory.working = false;
      creep.say("⛏️ добыча");
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 везу");
    }

    /**
     * 4. ВЫБОР ДЕЙСТВИЯ
     */
    if (creep.memory.working) {
      this.deliverMinerals(creep);
    } else {
      this.collectMinerals(creep, mineral);
    }
  },

  /**
   * collectMinerals — добыча минерала.
   * Extractor должен быть построен — без него harvest вернёт ошибку.
   */
  collectMinerals: function (creep, mineral) {
    // ИСПРАВЛЕНИЕ: проверяем mineralAmount, а не amount
    if (!mineral || !mineral.mineralAmount || mineral.mineralAmount === 0)
      return;

    if (creep.getActiveBodyparts(WORK) === 0) {
      creep.say("❌ нет WORK");
      return;
    }

    // Экстрактор кэшируем навсегда — строится один раз.
    if (!creep.memory.extractorId) {
      const extractor = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_EXTRACTOR,
      })[0];

      if (!extractor) {
        creep.say("⏳ нет экстрактора");
        return;
      }

      creep.memory.extractorId = extractor.id;
    }

    const extractor = Game.getObjectById(creep.memory.extractorId);
    if (!extractor) {
      delete creep.memory.extractorId;
      return;
    }

    // ERR_TIRED = экстрактор на cooldown — это нормально.
    const result = creep.harvest(mineral);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(mineral, {
        reusePath: 30,
        visualizePathStyle: { stroke: "#ffaa00" },
      });
    }
  },

  /**
   * deliverMinerals — доставка минерала в Terminal или Storage.
   * Приоритет: Terminal → Storage.
   */
  deliverMinerals: function (creep) {
    const room = creep.room;

    // Ищем любой ресурс в рюкзаке кроме энергии
    const resourceType = Object.keys(creep.store).find(
      r => r !== RESOURCE_ENERGY && creep.store[r] > 0,
    );

    if (!resourceType) {
      creep.memory.working = false;
      return;
    }

    let target = null;

    if (room.terminal && room.terminal.store.getFreeCapacity() > 0) {
      target = room.terminal;
    } else if (room.storage && room.storage.store.getFreeCapacity() > 0) {
      target = room.storage;
    }

    if (target) {
      if (creep.transfer(target, resourceType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          reusePath: 25,
          visualizePathStyle: { stroke: "#ffffff" },
        });
      }
    } else {
      creep.say("😴 всё полно");
    }
  },
};
