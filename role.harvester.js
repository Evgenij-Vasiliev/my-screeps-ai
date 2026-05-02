/**
 * ===================================================
 * ROLE.HARVESTER.JS — Заправщик спавна и расширений
 * ===================================================
 * Основная задача: Storage → Spawn/Extensions
 *
 * Аварийный режим (если Storage почти пуст):
 *   1. Сначала проверяем контейнеры у источников
 *   2. Если контейнеры пусты — копаем сами
 *   Это защита от deadlock когда майнеры умерли.
 *
 * Цепочка энергии в нормальном режиме:
 *   Miner → контейнер → Hauler → Storage → Harvester → Spawn/Extensions
 *
 * Память крипа (creep.memory):
 *   working     {boolean} — false = забор энергии, true = доставка
 *   sourceIndex {number}  — индекс "своего" источника (для аварийного копания)
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    // ── 1. ПЕРЕКЛЮЧЕНИЕ СОСТОЯНИЙ ──────────────────────────────────────────

    // Несли энергию — закончилась → идём за новой
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
      creep.memory.working = false;
      creep.say("🔄 storage");
    }

    // Набрали полный запас → идём доставлять
    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
      creep.say("🚚 spawn");
    }

    // ── 2. РЕЖИМ ЗАБОРА ЭНЕРГИИ ────────────────────────────────────────────

    if (!creep.memory.working) {
      const storage = creep.room.storage;

      /**
       * НОРМАЛЬНЫЙ РЕЖИМ: Storage есть и в нём достаточно энергии.
       *
       * ВАЖНО: порог 2000, а не 200!
       * При 200 крип считал Storage "пустым" даже при 5000 энергии
       * и уходил копать вместо того чтобы брать из хранилища.
       */
      if (storage && storage.store[RESOURCE_ENERGY] > 2000) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(storage, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#ffaa00" },
          });
        }
        return;
      }

      // ── АВАРИЙНЫЙ РЕЖИМ: Storage пуст или почти пуст ──────────────────
      // Это означает что хаулеры не успевают или майнеры умерли.
      // Защищаем спавн от остановки.
      creep.say("🆘 резерв!");

      /**
       * Приоритет 1: берём из контейнера у источника.
       * Это быстрее чем копать — контейнер уже заполнен майнером.
       * Используем кэш _sourceContainers из roomManager (бесплатно).
       */
      const containers = creep.room._sourceContainers || [];
      const myContainer = containers[creep.memory.sourceIndex] || null;

      // Ищем любой контейнер с энергией если "свой" пуст
      const fullContainer =
        (myContainer && myContainer.store[RESOURCE_ENERGY] > 100
          ? myContainer
          : null) || containers.find(c => c && c.store[RESOURCE_ENERGY] > 100);

      if (fullContainer) {
        if (
          creep.withdraw(fullContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE
        ) {
          creep.moveTo(fullContainer, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff4400" },
          });
        }
        return;
      }

      /**
       * Приоритет 2: копаем сами из источника.
       * Крайний случай — контейнеры тоже пусты (майнеры умерли).
       * Берём источник из кэша комнаты (бесплатно).
       */
      const sourceIds = creep.room.memory.sources || [];
      const sources = sourceIds
        .map(id => Game.getObjectById(id))
        .filter(Boolean);

      const source = sources[creep.memory.sourceIndex] || sources[0];

      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, {
            reusePath: 5,
            visualizePathStyle: { stroke: "#ff0000" },
          });
        }
      }

      return;
    }

    // ── 3. РЕЖИМ ДОСТАВКИ: Spawn и Extensions ─────────────────────────────
    // _energyTargets — кэш из roomManager.
    // Содержит только незаполненные спавны и расширения. Уже отфильтровано.

    const targets = creep.room._energyTargets;

    if (targets && targets.length > 0) {
      // Идём к ближайшей цели — экономим CPU на pathfinding
      const target = creep.pos.findClosestByRange(targets);
      if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            reusePath: 10,
            visualizePathStyle: { stroke: "#ffffff" },
          });
        }
        return;
      }
    }

    // Все расширения и спавны заполнены — ждём следующего тика

    // creep.say("✅ полно");
  },
};
