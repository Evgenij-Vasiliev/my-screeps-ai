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
 * Точка сбора в мирное время: Memory.empire.rally (default (39, 45) в E35S37)
 *
 * Автоматическая тревога через roomManager:
 *    Memory.attackAlert = { room: "E36S37", time: Game.time }
 * ===================================================
 */

const shardState = require("./shard.state");

module.exports = {
  run: function (creep) {
    // ── 1. ЛЕЧЕНИЕ ───────────────────────────────────────────────────────
    // Только при наличии HEAL-частей: у штатного тела атакующего
    // (CREEP_BODIES.attacker: heal = 0) их нет, поэтому creep.heal(creep)
    // возвращал ERR_NO_BODYPART — «мёртвый» интент на каждом тике.
    if (creep.hits < creep.hitsMax && creep.getActiveBodyparts(HEAL) > 0) {
      creep.heal(creep);
    }

    // Определяем текущую целевую комнату боевой задачи
    const targetRoom =
      Memory.rallyOverride ||
      (Memory.attackAlert ? Memory.attackAlert.room : null);

    // ── 2. САМОЗАЩИТА В ПУТИ ─────────────────────────────────────────────
    // Включается только если мы ЕЩЕ НЕ в целевой комнате (на автостраде или точке сбора)
    if (creep.room.name !== targetRoom) {
      // Глобальный кэш обороны (самопосборка после Global Reset).
      // Если комната ещё не сканировалась в этом тике (нет updatedAt) — врагов
      // смотрим напрямую: иначе после Global Reset самозащита молчит до
      // первого скана defense.manager. Известный пустой список (комната
      // просканирована, врагов нет) позволяет не тратить скан в остальные тики.
      if (!global._defenseCache) global._defenseCache = {};
      const cache = global._defenseCache[creep.room.name];
      const cacheKnown =
        cache &&
        Array.isArray(cache.hostileCreepIds) &&
        cache.updatedAt !== undefined;
      const hasKnownHostiles = cacheKnown && cache.hostileCreepIds.length > 0;

      if (!cacheKnown || hasKnownHostiles) {
        const attacker = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
          filter: c => c.pos.getRangeTo(creep) <= 4,
        });

        if (attacker) {
          this.attackTarget(creep, attacker, [attacker]);
          return;
        }
      }
    }
    // ── 3. РУЧНОЕ УПРАВЛЕНИЕ ──────────────────────────────────────────────
    if (Memory.rallyOverride) {
      this.respondToAlert(creep, Memory.rallyOverride);
      return;
    }

    // ── 4. АВТОМАТИЧЕСКАЯ ТРЕВОГА ─────────────────────────────────────────
    const alert = Memory.attackAlert;
    if (alert && alert.room) {
      this.respondToAlert(creep, alert.room);
    } else {
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
      creep.travelTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 5,
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
   * Движение на точку сбора (Memory.empire.rally, default (39,45) в E35S37).
   */
  goToRally: function (creep) {
    const rally = shardState.rally();

    if (creep.room.name !== rally.room) {
      creep.travelTo(new RoomPosition(25, 25, rally.room), {
        reusePath: 20,
      });
      return;
    }

    if (!creep.pos.inRangeTo(rally.x, rally.y, 2)) {
      creep.travelTo(new RoomPosition(rally.x, rally.y, creep.room.name), {
        reusePath: 20,
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
      creep.move(/** @type {DirectionConstant} */ (fleeDir));
    } else if (range > 3) {
      creep.moveTo(target, {
        reusePath: 3,
      });
    }
  },
};
