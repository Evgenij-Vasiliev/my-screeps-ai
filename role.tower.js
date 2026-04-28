/**
 * ===================================================
 * ROLE.TOWER.JS — Логика башни
 * ===================================================
 * Башня (Tower) действует автоматически каждый тик.
 * Приоритет действий:
 * 0. Принудительная цель из памяти комнаты (ручное управление)
 * 1. Атака врагов (самый слабый — чтобы гарантированно убить)
 * 2. Лечение раненых союзников
 * 3. Ремонт обычных структур (только при достаточной энергии)
 * 4. Ремонт стен и рампартов (постепенно повышаем порог)
 *
 * Настройка через память комнаты:
 * - room.memory.towerTargetId   — принудительная цель
 * - room.memory.wallThreshold   — текущий порог HP стен
 * - room.memory.wallThresholdMax — максимальный порог (не растём выше)
 * ===================================================
 */
module.exports = {
  run: function (tower) {
    if (!tower || !tower.room) return;

    const room = tower.room;
    const energy = tower.store[RESOURCE_ENERGY] || 0;
    const capacity = tower.store.getCapacity(RESOURCE_ENERGY) || 0;

    // Башня начинает ремонт только если заряжена больше чем на 70%.
    // Это гарантирует что на атаку и лечение всегда хватит энергии.
    const energyThreshold = capacity * 0.7;

    /**
     * 0. ПРИНУДИТЕЛЬНАЯ ЦЕЛЬ (ручное управление)
     *
     * Устанавливается через консоль:
     *   Memory.rooms["E37S37"].towerTargetId = "идентификатор_объекта"
     *
     * ИСПРАВЛЕНИЕ: заменили instanceof на проверку свойств объекта.
     * instanceof ненадёжен после глобального сброса движка Screeps.
     * my === false → враг. my === true → союзник. structureType → структура.
     */
    if (room.memory.towerTargetId) {
      const forced = Game.getObjectById(room.memory.towerTargetId);

      if (forced) {
        if (forced.my === false) {
          // Вражеский крип
          tower.attack(forced);
          return;
        }
        if (forced.my === true) {
          // Союзный крип — лечим
          tower.heal(forced);
          return;
        }
        if (forced.structureType && forced.hits < forced.hitsMax) {
          // Повреждённая структура — чиним
          tower.repair(forced);
          return;
        }
      } else {
        // Цель исчезла (убита/снесена) — очищаем память
        delete room.memory.towerTargetId;
      }
    }

    /**
     * 1. АТАКА ВРАГОВ
     *
     * ИСПРАВЛЕНИЕ: атакуем самого слабого (минимум hits), а не ближайшего.
     * Логика: лучше гарантированно убить одного чем ранить всех.
     * Башня наносит урон в зависимости от расстояния — это учитывается
     * самим движком при вызове tower.attack().
     */
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    if (hostiles.length > 0) {
      // Сортируем по hits (здоровью) — атакуем самого слабого
      hostiles.sort((a, b) => a.hits - b.hits);
      tower.attack(hostiles[0]);
      return;
    }

    /**
     * 2. ЛЕЧЕНИЕ СОЮЗНИКОВ
     *
     * findClosestByRange дешевле чем find + sort —
     * для лечения расстояние важно (башня лечит лучше вблизи).
     */
    const woundedAlly = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: c => c.hits < c.hitsMax,
    });

    if (woundedAlly) {
      tower.heal(woundedAlly);
      return;
    }

    /**
     * 3. РЕМОНТ ОБЫЧНЫХ СТРУКТУР
     *
     * Только если башня заряжена достаточно.
     * ИСПРАВЛЕНИЕ: один find() вместо двух — кэшируем результат.
     * Стены и рампарты исключаем — для них отдельный блок с порогом.
     */
    if (energy > energyThreshold) {
      const damaged = room.find(FIND_STRUCTURES, {
        filter: s =>
          s.hits < s.hitsMax &&
          s.structureType !== STRUCTURE_WALL &&
          s.structureType !== STRUCTURE_RAMPART,
      });

      if (damaged.length > 0) {
        // Чиним самую повреждённую структуру
        damaged.sort((a, b) => a.hits - b.hits);
        tower.repair(damaged[0]);
        return;
      }

      /**
       * 4. РЕМОНТ СТЕН И РАМПАРТОВ
       *
       * Стратегия постепенного повышения порога:
       * - Начинаем с wallThreshold (по умолчанию 1000 HP)
       * - Если все стены выше порога — поднимаем порог на 1000
       * - Но не выше wallThresholdMax (по умолчанию 300000)
       *
       * ИСПРАВЛЕНИЕ: добавили wallThresholdMax — раньше порог рос бесконечно.
       * После того как стены достигали нужного уровня и порог вырастал
       * выше реальных HP — башня переставала их чинить навсегда.
       *
       * Настройка через консоль:
       *   Memory.rooms["E37S37"].wallThreshold = 50000    // текущий порог
       *   Memory.rooms["E37S37"].wallThresholdMax = 500000 // максимум
       */
      const wallThreshold = room.memory.wallThreshold || 1000;
      const wallThresholdMax = room.memory.wallThresholdMax || 300000;

      const weakWalls = room.find(FIND_STRUCTURES, {
        filter: s =>
          (s.structureType === STRUCTURE_WALL ||
            s.structureType === STRUCTURE_RAMPART) &&
          s.hits < wallThreshold,
      });

      if (weakWalls.length > 0) {
        // Чиним самую слабую стену
        weakWalls.sort((a, b) => a.hits - b.hits);
        tower.repair(weakWalls[0]);
      } else {
        // Все стены выше порога — поднимаем планку, но не выше максимума
        if (wallThreshold < wallThresholdMax) {
          room.memory.wallThreshold = Math.min(
            wallThreshold + 1000,
            wallThresholdMax,
          );
        }
      }
    }
  },
};
