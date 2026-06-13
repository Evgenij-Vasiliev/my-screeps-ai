/**
 * ===================================================
 * ROLE.ATTACKER.JS — Боевой крип (дальнобойный)
 * ===================================================
 * ИСПРАВЛЕНО v4:
 * 1. Самозащита — если крипа атакуют, он немедленно отвечает
 *    независимо от текущей задачи и комнаты
 * 2. Сканер врагов включает комнаты дальней добычи
 *    E36S37 и E35S38 — не только наши комнаты
 * 3. Ручное управление из консоли:
 *    - Отправить в комнату: Memory.rallyOverride = "E36S37"
 *    - Сбросить (вернуть на базу): delete Memory.rallyOverride
 *
 * Точка сбора в мирное время: (39, 45) в E35S37
 *
 * Автоматическая тревога через roomManager:
 *    Memory.attackAlert = { room: "E36S37", time: Game.time }
 * ===================================================
 */

// Точка сбора в мирное время
const RALLY_ROOM = "E35S37";
const RALLY_X = 39;
const RALLY_Y = 45;

module.exports = {
  run: function (creep) {
    // ── 1. САМОЗАЩИТА — ВЫСШИЙ ПРИОРИТЕТ ─────────────────────────────────
    // Если крипа атакуют — немедленно лечимся и атакуем обидчика.
    // Работает в ЛЮБОЙ комнате, независимо от текущей задачи.
    if (creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }

    // Ищем того кто нас атакует прямо сейчас (в радиусе 4 клеток)
    const attacker = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
      filter: c => c.pos.getRangeTo(creep) <= 4,
    });

    if (attacker) {
      // Нас атакуют — немедленно отвечаем не глядя на задачу
      this.attackTarget(creep, attacker, [attacker]);

      return;
    }

    // ── 2. РУЧНОЕ УПРАВЛЕНИЕ ──────────────────────────────────────────────
    // Memory.rallyOverride = "E36S37" — отправить всех аттакеров в комнату
    // delete Memory.rallyOverride     — вернуть на точку сбора
    if (Memory.rallyOverride) {
      this.respondToAlert(creep, Memory.rallyOverride);

      return;
    }

    // ── 3. АВТОМАТИЧЕСКАЯ ТРЕВОГА ─────────────────────────────────────────
    // Memory.attackAlert устанавливается в roomManager когда
    // обнаружены враги в наших комнатах или комнатах добычи.
    const alert = Memory.attackAlert;

    if (alert && alert.room) {
      this.respondToAlert(creep, alert.room);
    } else {
      // Нет тревоги — идём на точку сбора
      this.goToRally(creep);
    }
  },

  /**
   * Боевое реагирование — летим в комнату и атакуем всех врагов.
   * Работает и для наших комнат и для комнат дальней добычи.
   */
  respondToAlert: function (creep, targetRoom) {
    // Переход в целевую комнату
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 5,
        visualizePathStyle: { stroke: "#ff0000" },
      });
      return;
    }

    // Мы в целевой комнате — ищем всех врагов
    const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS);

    if (hostileCreeps.length === 0) {
      // Крипов нет — ищем Invader Core
      const core = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE,
      });
      if (core) {
        this.attackTarget(creep, core, []);
      }
      return;
    }

    // Приоритет целей: лекари → боевые → все остальные
    const healers = hostileCreeps.filter(c =>
      c.body.some(b => b.type === HEAL),
    );

    const target =
      healers.length > 0
        ? creep.pos.findClosestByRange(healers)
        : creep.pos.findClosestByRange(hostileCreeps);

    this.attackTarget(creep, target, hostileCreeps);
  },

  /**
   * Движение на точку сбора (39,45) в E35S37.
   */
  goToRally: function (creep) {
    if (creep.room.name !== RALLY_ROOM) {
      creep.moveTo(new RoomPosition(25, 25, RALLY_ROOM), {
        reusePath: 20,
        visualizePathStyle: { stroke: "#00ff00" },
      });
      return;
    }

    if (!creep.pos.inRangeTo(RALLY_X, RALLY_Y, 2)) {
      creep.moveTo(RALLY_X, RALLY_Y, {
        reusePath: 20,
        visualizePathStyle: { stroke: "#00ff00" },
      });
    }
  },

  /**
   * Логика боя: кайтинг + выбор типа атаки.
   * @param {Creep} creep — наш боевой крип
   * @param {Creep|Structure} target — цель атаки
   * @param {Creep[]} hostileCreeps — все враги рядом (для massAttack)
   */
  attackTarget: function (creep, target, hostileCreeps) {
    if (!target) return;

    const range = creep.pos.getRangeTo(target);
    const nearbyHostiles = creep.pos.findInRange(hostileCreeps, 3);

    // Выбор типа атаки
    if (nearbyHostiles.length > 1) {
      // Несколько врагов рядом — массовая атака эффективнее
      creep.rangedMassAttack();
    } else if (range <= 3) {
      creep.rangedAttack(target);
    }

    // Кайтинг: держим дистанцию 3 клетки
    if (range < 3) {
      const dirToTarget = creep.pos.getDirectionTo(target);
      const fleeDir = ((dirToTarget + 3) % 8) + 1;
      creep.move(fleeDir);
    } else if (range > 3) {
      creep.moveTo(target, {
        reusePath: 3,
        visualizePathStyle: { stroke: "#ff0000" },
      });
    }
  },
};
