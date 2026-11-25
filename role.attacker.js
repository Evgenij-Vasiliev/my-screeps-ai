/**
 * ===================================================
 * ROLE.ATTACKER.JS — боевой крип (дальнобойный)
 * ===================================================
 * Перенесено из origin/Новая-Империя:defense.attacker.js (там роль названа
 * defense.attacker по имени файла; в текущей ветке карта ролей room.manager.js
 * ждёт role.*, поэтому имя role.attacker.js).
 *
 * Сохранено поведение рабочей версии:
 *   1) лечение только при наличии HEAL-частей: у тела attacker их нет
 *      (CREEP_BODIES.attacker, heal: 0), а creep.heal без HEAL возвращает
 *      ERR_NO_BODYPART — «мёртвый» интент на каждом тике;
 *   2) самозащита в пути — только если мы ещё НЕ в целевой комнате;
 *   3) ручное управление: Memory.rallyOverride = "E36S37" выводит всех в
 *      комнату, delete Memory.rallyOverride возвращает на точку сбора;
 *   4) автоматическая тревога: Memory.attackAlert = { room, time } —
 *      ставится defense.manager.js;
 *   5) приоритет целей: лекари → ближайший боевой → все остальные;
 *      если врагов нет — InvaderCore;
 *   6) кайтинг: держим дистанцию 3, вплотную отходим;
 *   7) RANGED_ATTACK 10 частей = 100 урона/тик на дистанции 1-3.
 *
 * АДАПТАЦИЯ ПОД ПРАВИЛА ТЕКУЩЕЙ ВЕТКИ:
 *   - движение между комнатами и к цели — creep.travelTo (Traveler), а не
 *     moveTo: в текущей ветке moveTo в рантайме не осталось, и
 *     tests/rules.test.js требует reusePath у каждого литерального moveTo;
 *   - в роли НЕТ room.find (tests/rules.test.js: «в ролях нет room.find»).
 *     Список врагов берётся из кэша defense.manager (global._defenseCache),
 *     который в этом же тике уже просканировал комнату; для страховки
 *     используется findClosestByRange — он не считается room.find;
 *   - heal/attack/move — тактические интенты, они под правило reusePath не
 *     попадают.
 * ===================================================
 */

const { DEFENSE } = require("./constants");

/**
 * Враги комнаты из кэша defense.manager (только живые и только в этой
 * комнате: крип мог выйти, а id ещё резолвится).
 * @param {string} roomName
 * @returns {Creep[]}
 */
function cachedHostiles(roomName) {
  const cache = global._defenseCache && global._defenseCache[roomName];
  const ids =
    cache && Array.isArray(cache.hostileCreepIds) ? cache.hostileCreepIds : null;
  if (!ids) return [];

  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const creep = Game.getObjectById(ids[i]);
    if (creep && creep.room && creep.room.name === roomName) out.push(creep);
  }
  return out;
}

/**
 * InvaderCore комнаты: из кэша defense.manager, иначе ближайший в комнате.
 * @param {Creep} creep
 * @returns {Structure|null}
 */
function findInvaderCore(creep) {
  const cache = global._defenseCache && global._defenseCache[creep.room.name];
  if (cache && cache.invaderCoreId) {
    const core = Game.getObjectById(cache.invaderCoreId);
    if (core) return core;
  }
  return creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
    filter: s => s.structureType === STRUCTURE_INVADER_CORE,
  });
}

module.exports = {
  run: function (creep) {
    // Спавнящийся крип не может действовать: интенты всё равно отбросятся.
    if (creep.spawning) return;

    // ── 1. ЛЕЧЕНИЕ ───────────────────────────────────────────────────────
    if (
      creep.hits < creep.hitsMax &&
      creep.getActiveBodyparts(HEAL) > 0
    ) {
      creep.heal(creep);
    }

    // Целевая комната боевой задачи: ручной вывод важнее автотревоги.
    const targetRoom =
      Memory.rallyOverride ||
      (Memory.attackAlert ? Memory.attackAlert.room : null);

    // ── 2. САМОЗАЩИТА В ПУТИ ─────────────────────────────────────────────
    // Только пока мы НЕ в целевой комнате (на автостраде или точке сбора):
    // в целевой комнате целью занимается respondToAlert.
    if (creep.room.name !== targetRoom) {
      const attacker = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: c => c.pos.getRangeTo(creep) <= 4,
      });

      if (attacker) {
        this.attackTarget(creep, attacker, [attacker]);
        return;
      }
    }

    // ── 3. РУЧНОЕ УПРАВЛЕНИЕ ──────────────────────────────────────────────
    if (Memory.rallyOverride) {
      this.respondToAlert(creep, Memory.rallyOverride);
      return;
    }

    // ── 4. АВТОМАТИЧЕСКАЯ ТРЕВОГА ─────────────────────────────────────────
    if (Memory.attackAlert && Memory.attackAlert.room) {
      this.respondToAlert(creep, Memory.attackAlert.room);
      return;
    }

    this.goToRally(creep);
  },

  /**
   * Боевое реагирование — идём в комнату и атакуем врагов.
   * Работает и для своих комнат, и для комнат дальней добычи.
   * @param {Creep} creep
   * @param {string} targetRoom
   */
  respondToAlert: function (creep, targetRoom) {
    if (creep.room.name !== targetRoom) {
      creep.travelTo(new RoomPosition(25, 25, targetRoom));
      return;
    }

    // Сначала кэш defense.manager (один скан комнаты на тик), затем
    // findClosestByRange — он подхватит врага, появившегося между
    // сканом и приходом атакующего.
    const hostiles = cachedHostiles(creep.room.name);
    const nearest = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (nearest && hostiles.indexOf(nearest) === -1) hostiles.push(nearest);

    if (hostiles.length === 0) {
      const core = findInvaderCore(creep);
      if (core) this.attackTarget(creep, core, []);
      return;
    }

    // Приоритет: лекари → ближайший боевой → все остальные.
    const healers = hostiles.filter(c => c.getActiveBodyparts(HEAL) > 0);
    const target = healers.length
      ? creep.pos.findClosestByRange(healers)
      : nearest || creep.pos.findClosestByRange(hostiles);

    this.attackTarget(creep, target, hostiles);
  },

  /**
   * Мирное время — точка сбора DEFENSE.RALLY.
   * @param {Creep} creep
   */
  goToRally: function (creep) {
    const rally = DEFENSE.RALLY;

    if (creep.room.name !== rally.room) {
      creep.travelTo(new RoomPosition(25, 25, rally.room));
      return;
    }

    if (!creep.pos.inRangeTo(rally.x, rally.y, 2)) {
      creep.travelTo(new RoomPosition(rally.x, rally.y, creep.room.name));
    }
  },

  /**
   * Логика боя: кайтинг + выбор типа атаки.
   * @param {Creep} creep
   * @param {Creep|Structure} target
   * @param {Creep[]} hostileCreeps
   */
  attackTarget: function (creep, target, hostileCreeps) {
    if (!target) return;

    const range = creep.pos.getRangeTo(target);
    const nearbyHostiles = (hostileCreeps || []).filter(
      c => creep.pos.getRangeTo(c) <= 3,
    );

    // Несколько врагов в радиусе 3 — массовая атака эффективнее.
    if (nearbyHostiles.length > 1) {
      creep.rangedMassAttack();
    } else if (range <= 3) {
      creep.rangedAttack(target);
    }

    // Кайтинг: держим дистанцию 3 клетки.
    if (range < 3) {
      const dirToTarget = creep.pos.getDirectionTo(target);
      const fleeDir = (dirToTarget + 3) % 8 + 1;
      creep.move(fleeDir);
    } else if (range > 3) {
      creep.travelTo(target);
    }
  },
};
