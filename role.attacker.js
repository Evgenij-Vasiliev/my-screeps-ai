/**
 * ===================================================
 * ROLE.ATTACKER.JS — Боевой крип (дальнобойный)
 * ===================================================
 * Тактика: кайтинг на дистанции 3 клетки.
 * - Держим дистанцию 3 от врага (оптимум для rangedAttack)
 * - При нескольких врагах рядом — rangedMassAttack
 * - Всегда лечим себя если ранены
 *
 * Управление через консоль (без перезаписи файла!):
 *   Memory.attackerConfig = {
 *     emergencyTarget: "E35S39",     // все летят сюда (null = по плану)
 *     battleZones: ["E35S38", "E36S37"] // зоны патруля
 *   }
 *   delete Memory.attackerConfig.emergencyTarget // снять экстренный приказ
 *
 * Память крипа (creep.memory):
 * - targetRoom {string} — текущая целевая комната
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    /**
     * 1. САМОЛЕЧЕНИЕ
     *
     * ИСПРАВЛЕНИЕ: лечим только если реально ранены.
     * Вызов heal() на полном крипе — лишняя трата API-вызова.
     * heal() на себя всегда в приоритете — даже во время боя.
     */
    if (creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }

    /**
     * 2. ОПРЕДЕЛЕНИЕ ЦЕЛЕВОЙ КОМНАТЫ
     *
     * ИСПРАВЛЕНИЕ: читаем конфиг из Memory — можно менять через консоль
     * без перезаписи файла кода. Это ключевой принцип управления в Screeps.
     *
     * Приоритет:
     * 1. emergencyTarget из Memory — экстренный приказ всем атакерам
     * 2. targetRoom в памяти крипа — уже назначенная зона
     * 3. battleZones из Memory — назначаем по хэшу имени крипа
     */
    const config = Memory.attackerConfig || {};
    const emergencyTarget = config.emergencyTarget || null;

    if (emergencyTarget) {
      // Экстренный приказ — перезаписываем цель у всех атакеров
      if (creep.memory.targetRoom !== emergencyTarget) {
        creep.memory.targetRoom = emergencyTarget;
      }
    } else if (!creep.memory.targetRoom) {
      // Назначаем зону патруля по хэшу имени — крипы распределяются равномерно.
      // Хэш имени стабилен: один крип всегда идёт в одну зону.
      const battleZones = config.battleZones || ["E35S38", "E36S37"];
      let hash = 0;
      for (let i = 0; i < creep.name.length; i++) {
        hash += creep.name.charCodeAt(i);
      }
      creep.memory.targetRoom = battleZones[hash % battleZones.length];
    }

    const targetRoom = creep.memory.targetRoom;

    /**
     * 3. ПЕРЕХОД В ЦЕЛЕВУЮ КОМНАТУ
     *
     * RoomPosition(25, 25, room) — центр комнаты.
     * reusePath: 50 — путь между комнатами не меняется, кэшируем надолго.
     */
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#ff0000" },
      });
      return;
    }

    /**
     * 4. БОЕВАЯ ЛОГИКА
     *
     * Приоритет целей:
     * 1. Вражеские крипы (опасны, атакуют нас)
     * 2. Invader Core (нейтрализует удалённую комнату)
     */
    const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS);

    // Ищем Invader Core только если нет живых врагов — экономим CPU
    let target = creep.pos.findClosestByRange(hostileCreeps);

    if (!target) {
      target = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE,
      });
    }

    if (target) {
      const range = creep.pos.getRangeTo(target);

      /**
       * ВЫБОР ТИПА АТАКИ
       *
       * rangedMassAttack — при 2+ врагах в радиусе 3 (бьёт всех сразу)
       * rangedAttack     — при одном враге в радиусе 3 (больше урона)
       */
      const nearbyHostiles = creep.pos.findInRange(hostileCreeps, 3);

      if (nearbyHostiles.length > 1) {
        creep.rangedMassAttack();
      } else if (range <= 3) {
        creep.rangedAttack(target);
      }

      /**
       * КАЙТИНГ — держим дистанцию ровно 3 клетки
       *
       * ИСПРАВЛЕНИЕ: убрали PathFinder.search с flee:true — это дорого.
       * Вместо этого двигаемся напрямую от врага через directionTo.
       *
       * Логика:
       * - Враг ближе 3 → отходим (двигаемся в обратном направлении)
       * - Враг дальше 3 → сближаемся
       * - Враг ровно 3 → стоим (оптимальная позиция)
       */
      if (range < 3) {
        // Находим направление К врагу, затем идём В ОБРАТНУЮ сторону
        const dirToTarget = creep.pos.getDirectionTo(target);
        // Обратное направление: +4 по кругу (8 направлений)
        const fleeDir = ((dirToTarget - 1 + 4) % 8) + 1;
        creep.move(fleeDir);
      } else if (range > 3) {
        creep.moveTo(target, {
          reusePath: 3, // малый кэш — цель движется
          visualizePathStyle: { stroke: "#ff0000" },
        });
      }
      // range === 3 → стоим, только стреляем
    } else {
      /**
       * 5. ПАТРУЛЬ / ОЖИДАНИЕ
       *
       * Если врагов нет — держимся в центре комнаты.
       * inRangeTo(x, y, range) — проверяет расстояние до координат.
       */
      if (!creep.pos.inRangeTo(25, 25, 5)) {
        creep.moveTo(25, 25, {
          reusePath: 50,
          visualizePathStyle: { stroke: "#ff0000" },
        });
      }
    }
  },
};
