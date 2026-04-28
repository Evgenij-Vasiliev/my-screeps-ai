/**
 * ===================================================
 * ROLE.MINERALMINER.JS — Добытчик минералов
 * ===================================================
 * Стратегия: добывает минерал с помощью Extractor
 * и доставляет его в Terminal (приоритет) или Storage.
 *
 * Требования:
 * - RCL6+ (нужен Extractor и Terminal)
 * - Extractor должен быть построен на минерале
 * - Mineral должен быть не пуст (regenerates ~50000 тиков)
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
     *
     * ИСПРАВЛЕНИЕ: берём mineralId из room.memory — он уже кэширован
     * там с момента спавна крипа (factory.js записал при создании).
     * Не нужно делать find() каждые 1000 тиков.
     */
    const mineralId = creep.memory.mineralId || creep.room.memory.mineralId;

    if (!mineralId) {
      // Крайний случай: ни у крипа ни у комнаты нет mineralId
      // Ищем и сохраняем в оба места
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
     * Минерал пуст — ждём регенерации.
     * mineralId остаётся в памяти — не нужно искать заново.
     * ticksToRegeneration показывает сколько тиков до восстановления.
     */
    if (mineral.amount === 0) {
      const ticks = mineral.ticksToRegeneration || "?";
      creep.say(`💤 ${ticks}т`);
      return;
    }

    /**
     * 2. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ
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
     * 3. ВЫБОР ДЕЙСТВИЯ
     */
    if (creep.memory.working) {
      this.deliverMinerals(creep);
    } else {
      this.collectMinerals(creep, mineral);
    }
  },

  /**
   * collectMinerals — добыча минерала.
   * Крип должен стоять на клетке минерала и иметь части WORK.
   * Extractor должен быть построен — без него harvest вернёт ошибку.
   */
  collectMinerals: function (creep, mineral) {
    if (!mineral || mineral.amount === 0) return;

    if (creep.getActiveBodyparts(WORK) === 0) {
      creep.say("❌ нет WORK");
      return;
    }

    /**
     * Экстрактор кэшируем навсегда — он строится один раз
     * и никуда не переносится. Game.time % 200 был лишним.
     *
     * ИСПРАВЛЕНИЕ: кэш только один раз при первом запуске.
     */
    if (!creep.memory.extractorId) {
      const extractor = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: s => s.structureType === STRUCTURE_EXTRACTOR,
      })[0];

      // Если экстрактора нет — ждём пока его построят
      if (!extractor) {
        creep.say("⏳ нет экстрактора");
        return;
      }

      creep.memory.extractorId = extractor.id;
    }

    // Проверяем что экстрактор ещё существует
    const extractor = Game.getObjectById(creep.memory.extractorId);
    if (!extractor) {
      delete creep.memory.extractorId; // сбросим — найдём в следующем тике
      return;
    }

    // Добываем. ERR_TIRED означает что экстрактор на cooldown — это нормально.
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
   *
   * ИСПРАВЛЕНИЕ: убрали кэш terminalId и storageId в памяти крипа.
   * room.terminal и room.storage — это прямые ссылки, они всегда актуальны.
   * Кэшировать их ID избыточно и только запутывает код.
   *
   * ИСПРАВЛЕНИЕ: заменили _.find(Object.keys(...)) на стандартный JS.
   */
  deliverMinerals: function (creep) {
    const room = creep.room;

    // Ищем любой ресурс в рюкзаке кроме энергии
    // Object.keys(creep.store) возвращает список всех ресурсов в рюкзаке
    const resourceType = Object.keys(creep.store).find(
      r => r !== RESOURCE_ENERGY && creep.store[r] > 0,
    );

    if (!resourceType) {
      // В рюкзаке нет минералов — переключаемся обратно
      creep.memory.working = false;
      return;
    }

    /**
     * Приоритет доставки:
     * 1. Terminal — основное место хранения минералов для торговли
     * 2. Storage — если terminal полон или не построен
     *
     * Terminal появляется на RCL6 вместе с возможностью добычи минералов.
     */
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
      // Некуда сдать — ждём
      creep.say("😴 всё полно");
    }
  },
};
