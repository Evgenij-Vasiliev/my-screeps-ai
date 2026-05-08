/**
 * ===================================================
 * ROLE.ATTACKER.JS — Боевой крип (дальнобойный)
 * ===================================================
 * ИСПРАВЛЕНО v2:
 * 1. Приоритет целей: лекари → боевые → Invader Core
 * 2. Исправлен кайтинг — правильное обратное направление
 *
 * Управление через консоль:
 *   Memory.attackerConfig = {
 *     emergencyTarget: "E35S39",
 *     battleZones: ["E35S38", "E36S37"]
 *   }
 * ===================================================
 */
module.exports = {
  run: function (creep) {
    // ── 1. САМОЛЕЧЕНИЕ ────────────────────────────────────────────────────
    if (creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }

    // ── 2. ЦЕЛЕВАЯ КОМНАТА ────────────────────────────────────────────────
    const config = Memory.attackerConfig || {};
    const emergencyTarget = config.emergencyTarget || null;

    if (emergencyTarget) {
      creep.memory.targetRoom = emergencyTarget;
    } else if (!creep.memory.targetRoom) {
      const battleZones = config.battleZones || ["E35S38", "E36S37"];
      let hash = 0;
      for (let i = 0; i < creep.name.length; i++)
        hash += creep.name.charCodeAt(i);
      creep.memory.targetRoom = battleZones[hash % battleZones.length];
    }

    const targetRoom = creep.memory.targetRoom;

    // ── 3. ПЕРЕХОД В КОМНАТУ ──────────────────────────────────────────────
    if (creep.room.name !== targetRoom) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50,
        visualizePathStyle: { stroke: "#ff0000" },
      });
      return;
    }

    // ── 4. ВЫБОР ЦЕЛИ ─────────────────────────────────────────────────────
    const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS);

    let target = null;

    if (hostileCreeps.length > 0) {
      // ИСПРАВЛЕНИЕ: сначала ищем лекарей — они опасны тем что лечат других
      const healers = hostileCreeps.filter(c =>
        c.body.some(b => b.type === HEAL),
      );

      if (healers.length > 0) {
        // Атакуем ближайшего лекаря
        target = creep.pos.findClosestByRange(healers);
      } else {
        // Лекарей нет — атакуем ближайшего боевого
        target = creep.pos.findClosestByRange(hostileCreeps);
      }
    }

    // Нет крипов — ищем Invader Core
    if (!target) {
      target = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_INVADER_CORE,
      });
    }

    // ── 5. БОЙ ───────────────────────────────────────────────────────────
    if (target) {
      const range = creep.pos.getRangeTo(target);
      const nearbyHostiles = creep.pos.findInRange(hostileCreeps, 3);

      // Выбор типа атаки
      if (nearbyHostiles.length > 1) {
        creep.rangedMassAttack();
      } else if (range <= 3) {
        creep.rangedAttack(target);
      }

      // ИСПРАВЛЕНИЕ: правильный кайтинг
      // Обратное направление = направление + 4 (по кругу из 8 направлений)
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
    } else {
      // ── 6. ПАТРУЛЬ ───────────────────────────────────────────────────────
      if (!creep.pos.inRangeTo(25, 25, 5)) {
        creep.moveTo(25, 25, {
          reusePath: 50,
          visualizePathStyle: { stroke: "#ff0000" },
        });
      }
    }
  },
};
